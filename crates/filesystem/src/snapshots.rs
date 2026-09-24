//! Foundation contract for stage 9 filesystem snapshot providers.
use domain::{AppError, SnapshotInfo};

/// Providers expose read-only metadata only; snapshot creation and deletion are out of scope.
pub trait SnapshotProvider: Send + Sync {
    fn list_snapshots(&self, mount_point: &str) -> Result<Vec<SnapshotInfo>, AppError>;
}
