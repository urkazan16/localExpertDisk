//! Deterministic filesystem fault injection for scanner tests and controlled profiles.
use crate::native::{DirectoryEntries, EntryMetadata, FileSystemProvider};
use std::{
    io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultOperation {
    Metadata,
    ReadDirectory,
    ReadEntry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileSystemFault {
    PermissionDenied,
    FileDisappeared,
    ReadFailure,
    VolumeDisconnected,
    MetadataChanged,
}

#[derive(Debug, Clone)]
pub struct FaultRule {
    pub path: PathBuf,
    pub operation: FaultOperation,
    /// One-based matching call number.
    pub occurrence: u64,
    pub fault: FileSystemFault,
}

impl FaultRule {
    pub fn new(
        path: impl Into<PathBuf>,
        operation: FaultOperation,
        occurrence: u64,
        fault: FileSystemFault,
    ) -> Self {
        Self {
            path: path.into(),
            operation,
            occurrence: occurrence.max(1),
            fault,
        }
    }
}

struct RuleState {
    rule: FaultRule,
    calls: u64,
    fired: bool,
}

#[derive(Default)]
struct State {
    rules: Vec<RuleState>,
    disconnected: bool,
}

/// Wraps a real or synthetic provider. Each rule fires once, deterministically.
pub struct FaultInjectingFileSystem {
    inner: Arc<dyn FileSystemProvider>,
    state: Arc<Mutex<State>>,
}

impl FaultInjectingFileSystem {
    pub fn new(inner: Arc<dyn FileSystemProvider>, rules: Vec<FaultRule>) -> Self {
        Self {
            inner,
            state: Arc::new(Mutex::new(State {
                rules: rules
                    .into_iter()
                    .map(|rule| RuleState {
                        rule,
                        calls: 0,
                        fired: false,
                    })
                    .collect(),
                disconnected: false,
            })),
        }
    }

    fn take_fault(
        &self,
        path: &Path,
        operation: FaultOperation,
    ) -> io::Result<Option<FileSystemFault>> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("fault injector lock poisoned"))?;
        if state.disconnected {
            return Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "volume disconnected",
            ));
        }
        let fault = state.rules.iter_mut().find_map(|state| {
            if !state.fired && state.rule.path == path && state.rule.operation == operation {
                state.calls += 1;
                if state.calls == state.rule.occurrence {
                    state.fired = true;
                    return Some(state.rule.fault);
                }
            }
            None
        });
        if fault == Some(FileSystemFault::VolumeDisconnected) {
            state.disconnected = true;
        }
        Ok(fault)
    }
}

fn fault_error(fault: FileSystemFault) -> Option<io::Error> {
    let kind = match fault {
        FileSystemFault::PermissionDenied => io::ErrorKind::PermissionDenied,
        FileSystemFault::FileDisappeared => io::ErrorKind::NotFound,
        FileSystemFault::ReadFailure => io::ErrorKind::Other,
        FileSystemFault::VolumeDisconnected => io::ErrorKind::NotConnected,
        FileSystemFault::MetadataChanged => return None,
    };
    Some(io::Error::new(kind, "injected filesystem fault"))
}

impl FileSystemProvider for FaultInjectingFileSystem {
    fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
        let fault = self.take_fault(path, FaultOperation::Metadata)?;
        if let Some(error) = fault.and_then(fault_error) {
            return Err(error);
        }
        let mut metadata = self.inner.metadata(path)?;
        if fault == Some(FileSystemFault::MetadataChanged) {
            metadata.identity = Some(format!("fault-changed:{}", path.display()));
            metadata.modified_at_ms = Some(
                metadata
                    .modified_at_ms
                    .unwrap_or_default()
                    .saturating_add(1),
            );
        }
        Ok(metadata)
    }

    fn read_directory(&self, path: &Path) -> io::Result<DirectoryEntries> {
        if let Some(error) = self
            .take_fault(path, FaultOperation::ReadDirectory)?
            .and_then(fault_error)
        {
            return Err(error);
        }
        let entries = self.inner.read_directory(path)?;
        let entry_fault = self.take_fault(path, FaultOperation::ReadEntry)?;
        if let Some(fault) = entry_fault {
            if let Some(error) = fault_error(fault) {
                return Ok(Box::new(std::iter::once(Err(error)).chain(entries)));
            }
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::NativeFileSystem;

    #[test]
    fn rules_are_one_shot_and_disconnect_is_sticky() {
        let temporary = tempfile::tempdir().unwrap();
        let file = temporary.path().join("file");
        std::fs::write(&file, b"x").unwrap();
        let injected = FaultInjectingFileSystem::new(
            Arc::new(NativeFileSystem),
            vec![
                FaultRule::new(
                    &file,
                    FaultOperation::Metadata,
                    2,
                    FileSystemFault::FileDisappeared,
                ),
                FaultRule::new(
                    temporary.path(),
                    FaultOperation::ReadDirectory,
                    1,
                    FileSystemFault::VolumeDisconnected,
                ),
            ],
        );
        assert!(injected.metadata(&file).is_ok());
        assert_eq!(
            injected.metadata(&file).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
        let error = match injected.read_directory(temporary.path()) {
            Ok(_) => panic!("disconnect must fail directory reads"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), io::ErrorKind::NotConnected);
        assert_eq!(
            injected.metadata(&file).unwrap_err().kind(),
            io::ErrorKind::NotConnected
        );
    }

    #[test]
    fn metadata_and_entry_failures_are_observable() {
        let temporary = tempfile::tempdir().unwrap();
        let file = temporary.path().join("file");
        std::fs::write(&file, b"x").unwrap();
        let changed = FaultInjectingFileSystem::new(
            Arc::new(NativeFileSystem),
            vec![FaultRule::new(
                &file,
                FaultOperation::Metadata,
                1,
                FileSystemFault::MetadataChanged,
            )],
        );
        assert!(changed
            .metadata(&file)
            .unwrap()
            .identity
            .unwrap()
            .starts_with("fault-changed:"));

        let failed = FaultInjectingFileSystem::new(
            Arc::new(NativeFileSystem),
            vec![FaultRule::new(
                temporary.path(),
                FaultOperation::ReadEntry,
                1,
                FileSystemFault::ReadFailure,
            )],
        );
        assert_eq!(
            failed
                .read_directory(temporary.path())
                .unwrap()
                .next()
                .unwrap()
                .unwrap_err()
                .kind(),
            io::ErrorKind::Other
        );

        let denied = FaultInjectingFileSystem::new(
            Arc::new(NativeFileSystem),
            vec![FaultRule::new(
                &file,
                FaultOperation::Metadata,
                1,
                FileSystemFault::PermissionDenied,
            )],
        );
        assert_eq!(
            denied.metadata(&file).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
    }
}
