//! Foundation contract for stage 5 platform watchers.
use domain::AppError;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSystemChange {
    pub path: String,
    pub kind: FileSystemChangeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileSystemChangeKind {
    Created,
    Modified,
    Removed,
    RescanRequired,
}

/// Platform adapters normalize native events before the core sees them.
/// No adapter is advertised until it can preserve a reliable checkpoint.
pub trait FileSystemWatcher: Send + Sync {
    fn watch(
        &self,
        root: &Path,
    ) -> Result<Box<dyn Iterator<Item = FileSystemChange> + Send>, AppError>;
}
