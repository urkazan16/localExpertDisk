//! A single worker with bounded batches and an external directory queue.
use analyzer::Totals;
use domain::{AppError, ErrorCode, ScanIssue, ScanState};
use filesystem::native::{EntryKind, EntryMetadata, FileSystemProvider};
use std::{
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

pub const BATCH_SIZE: usize = 256;
#[derive(Debug)]
pub struct DirectoryTask {
    pub id: i64,
    pub path: PathBuf,
    pub identity: Option<String>,
    pub is_root: bool,
}
#[derive(Debug)]
pub struct EntryDraft {
    pub path: PathBuf,
    pub metadata: EntryMetadata,
}

/// The implementation owns queue persistence, atomic batches and aggregates.
pub trait ScanSink {
    fn next_directory(&mut self) -> Result<Option<DirectoryTask>, AppError>;
    fn write_batch(
        &mut self,
        parent: i64,
        entries: &[EntryDraft],
        issues: &[ScanIssue],
        totals: Totals,
    ) -> Result<(), AppError>;
    fn finish_directory(&mut self, id: i64) -> Result<(), AppError>;
}

fn issue(path: &Path, operation: &str, kind: io::ErrorKind) -> ScanIssue {
    let code = match kind {
        io::ErrorKind::PermissionDenied => "permission_denied",
        io::ErrorKind::NotFound => "file_disappeared",
        _ => "metadata_unavailable",
    };
    ScanIssue {
        path: path.to_string_lossy().into_owned(),
        code: code.into(),
        operation: operation.into(),
    }
}

/// Only committed batches appear in progress. Cancellation drops the uncommitted tail.
pub fn scan(
    fs: &dyn FileSystemProvider,
    sink: &mut dyn ScanSink,
    cancel: &AtomicBool,
    excluded: &Path,
    mut progress: impl FnMut(),
) -> Result<ScanState, AppError> {
    let mut totals = Totals {
        directories: 1,
        ..Default::default()
    };
    while !cancel.load(Ordering::Acquire) {
        let Some(task) = sink.next_directory()? else {
            return Ok(if totals.errors > 0 || totals.skipped > 0 {
                ScanState::Partial
            } else {
                ScanState::Completed
            });
        };
        let mut entries = Vec::with_capacity(BATCH_SIZE);
        let mut issues = Vec::new();
        let mut delta = Totals::default();
        let metadata = fs.metadata(&task.path);
        let valid = metadata.as_ref().is_ok_and(|current| {
            current.kind == EntryKind::Directory
                && (task.identity.is_none() || current.identity == task.identity)
        });
        let listing = if valid {
            fs.read_directory(&task.path)
        } else {
            Err(io::Error::new(
                metadata
                    .err()
                    .map(|e| e.kind())
                    .unwrap_or(io::ErrorKind::NotFound),
                "Directory changed",
            ))
        };
        match listing {
            Err(error) => {
                if task.is_root {
                    return Err(AppError::new(ErrorCode::InvalidTarget));
                }
                issues.push(issue(&task.path, "read_directory", error.kind()));
                delta.errors += 1;
            }
            Ok(mut listing) => loop {
                if cancel.load(Ordering::Acquire) {
                    return Ok(ScanState::Cancelled);
                }
                let Some(item) = listing.next() else {
                    break;
                };
                match item {
                    Err(error) => {
                        issues.push(issue(&task.path, "read_entry", error.kind()));
                        delta.errors += 1;
                    }
                    Ok(path) if path.starts_with(excluded) => {
                        delta.skipped += 1;
                    }
                    Ok(path) => match fs.metadata(&path) {
                        Err(error) => {
                            issues.push(issue(&path, "metadata", error.kind()));
                            delta.errors += 1;
                        }
                        Ok(metadata) => {
                            let extra = match metadata.kind {
                                EntryKind::File => Totals {
                                    files: 1,
                                    logical: metadata.logical_size,
                                    ..Default::default()
                                },
                                EntryKind::Directory => Totals {
                                    directories: 1,
                                    ..Default::default()
                                },
                                EntryKind::Symlink => Totals {
                                    symlinks: 1,
                                    ..Default::default()
                                },
                                EntryKind::Other => Totals {
                                    skipped: 1,
                                    ..Default::default()
                                },
                            };
                            delta = delta.merge(extra)?;
                            entries.push(EntryDraft { path, metadata });
                        }
                    },
                }
                if entries.len() + issues.len() >= BATCH_SIZE {
                    if cancel.load(Ordering::Acquire) {
                        return Ok(ScanState::Cancelled);
                    }
                    let next = totals.merge(delta)?;
                    sink.write_batch(task.id, &entries, &issues, next)?;
                    totals = next;
                    entries.clear();
                    issues.clear();
                    delta = Totals::default();
                    progress();
                }
            },
        }
        if cancel.load(Ordering::Acquire) {
            return Ok(ScanState::Cancelled);
        }
        totals = totals.merge(delta)?;
        sink.write_batch(task.id, &entries, &issues, totals)?;
        sink.finish_directory(task.id)?;
        progress();
    }
    Ok(ScanState::Cancelled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use filesystem::native::DirectoryEntries;
    struct Synthetic;
    impl FileSystemProvider for Synthetic {
        fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
            let directory = path == Path::new("root");
            Ok(EntryMetadata {
                kind: if directory {
                    EntryKind::Directory
                } else {
                    EntryKind::File
                },
                logical_size: if directory { 0 } else { 3 },
                identity: None,
            })
        }
        fn read_directory(&self, _: &Path) -> io::Result<DirectoryEntries> {
            Ok(Box::new(
                (0..10_000).map(|i| Ok(PathBuf::from(format!("root/file-{i}")))),
            ))
        }
    }
    struct Sink {
        queued: bool,
        total: Totals,
        max_batch: usize,
        writes: usize,
    }
    impl ScanSink for Sink {
        fn next_directory(&mut self) -> Result<Option<DirectoryTask>, AppError> {
            Ok(self.queued.then(|| DirectoryTask {
                id: 1,
                path: PathBuf::from("root"),
                identity: None,
                is_root: true,
            }))
        }
        fn write_batch(
            &mut self,
            _: i64,
            entries: &[EntryDraft],
            issues: &[ScanIssue],
            total: Totals,
        ) -> Result<(), AppError> {
            self.max_batch = self.max_batch.max(entries.len() + issues.len());
            self.total = total;
            self.writes += 1;
            Ok(())
        }
        fn finish_directory(&mut self, _: i64) -> Result<(), AppError> {
            self.queued = false;
            Ok(())
        }
    }
    #[test]
    fn wide_directory_is_delivered_in_bounded_batches() {
        let mut sink = Sink {
            queued: true,
            total: Totals::default(),
            max_batch: 0,
            writes: 0,
        };
        let result = scan(
            &Synthetic,
            &mut sink,
            &AtomicBool::new(false),
            Path::new("excluded"),
            || {},
        )
        .unwrap();
        assert_eq!(result, ScanState::Completed);
        assert!(sink.max_batch <= BATCH_SIZE);
        assert!(sink.writes > 1);
        assert_eq!(sink.total.files, 10_000);
        assert_eq!(sink.total.logical, 30_000);
    }
    #[test]
    fn pre_cancelled_scan_does_not_touch_filesystem_or_sink() {
        let mut sink = Sink {
            queued: true,
            total: Totals::default(),
            max_batch: 0,
            writes: 0,
        };
        assert_eq!(
            scan(
                &Synthetic,
                &mut sink,
                &AtomicBool::new(true),
                Path::new("excluded"),
                || {}
            )
            .unwrap(),
            ScanState::Cancelled
        );
        assert_eq!(sink.writes, 0);
    }
}
