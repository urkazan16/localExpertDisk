//! Shared IPC models. No dependency on a desktop runtime or storage engine.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    StorageUnavailable,
    UnsupportedSchema,
    InvalidSchema,
    Internal,
    InvalidTarget,
    ScanBusy,
    ScanNotFound,
    InvalidTransition,
    SizeOverflow,
    ScanNotReady,
    LaunchFailed,
    PermissionDenied,
    IncompatibleScans,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct AppError {
    pub code: ErrorCode,
    pub user_message_key: String,
    pub recoverable: bool,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.user_message_key)
    }
}
impl std::error::Error for AppError {}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Macos,
    Windows,
    Linux,
    Unsupported,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct Capabilities {
    pub trash: bool,
    pub permanent_delete: bool,
    pub watcher: bool,
    pub snapshots: bool,
    pub filesystem_details: bool,
    pub allocated_size: bool,
    pub last_access_reliable: bool,
    pub duplicate_hashing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct AppInfo {
    pub version: String,
    pub platform: Platform,
    pub schema_version: u32,
    pub capabilities: Capabilities,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_errors_are_stable_and_do_not_contain_technical_details() {
        let error = AppError {
            code: ErrorCode::UnsupportedSchema,
            user_message_key: "errors.unsupported_schema".into(),
            recoverable: false,
        };
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "code": "unsupported_schema",
                "user_message_key": "errors.unsupported_schema",
                "recoverable": false
            })
        );
    }
}

impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        let key = match code {
            ErrorCode::StorageUnavailable => "storage_unavailable",
            ErrorCode::UnsupportedSchema => "unsupported_schema",
            ErrorCode::InvalidSchema => "invalid_schema",
            ErrorCode::Internal => "internal",
            ErrorCode::InvalidTarget => "invalid_target",
            ErrorCode::ScanBusy => "scan_busy",
            ErrorCode::ScanNotFound => "scan_not_found",
            ErrorCode::InvalidTransition => "invalid_transition",
            ErrorCode::SizeOverflow => "size_overflow",
            ErrorCode::ScanNotReady => "scan_not_ready",
            ErrorCode::LaunchFailed => "launch_failed",
            ErrorCode::PermissionDenied => "permission_denied",
            ErrorCode::IncompatibleScans => "incompatible_scans",
        };
        Self {
            code,
            user_message_key: format!("errors.{key}"),
            recoverable: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct VolumeInfo {
    pub name: String,
    /// None means the native mount point cannot be represented in the path input.
    pub mount_point: Option<String>,
    pub filesystem: String,
    pub total_bytes: String,
    pub available_bytes: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScanState {
    Created,
    Preparing,
    Scanning,
    Finalizing,
    Completed,
    Partial,
    Cancelling,
    Cancelled,
    Failed,
    Interrupted,
}

impl ScanState {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Partial | Self::Cancelled | Self::Failed | Self::Interrupted
        )
    }
    pub fn can_transition(self, next: Self) -> bool {
        use ScanState::*;
        matches!(
            (self, next),
            (Created, Preparing)
                | (Preparing, Scanning)
                | (Scanning, Finalizing)
                | (Finalizing, Completed | Partial)
                | (Created | Preparing | Scanning | Finalizing, Cancelling)
                | (Cancelling, Cancelled)
        ) || (!self.is_terminal() && matches!(next, Failed | Interrupted))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ScanSession {
    pub id: String,
    pub root_path: String,
    pub state: ScanState,
    pub files_count: String,
    /// Includes the selected root directory.
    pub directories_count: String,
    pub symlinks_count: String,
    pub skipped_count: String,
    pub logical_size: String,
    /// Unknown until native allocated-size providers are implemented.
    pub allocated_size: Option<String>,
    pub errors_count: String,
    pub started_at_ms: String,
    pub finished_at_ms: Option<String>,
    pub failure: Option<AppError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct StartScanRequest {
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ScanIssue {
    pub path: String,
    pub code: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ScanIssuePage {
    pub items: Vec<ScanIssue>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IndexedEntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct IndexedEntry {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub path: String,
    pub kind: IndexedEntryKind,
    pub logical_size: String,
    /// The complete descendant size for directories, otherwise the file size.
    pub aggregate_size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct EntryPage {
    pub items: Vec<IndexedEntry>,
    pub next_cursor: Option<String>,
}

/// A file selected from the local index by its last known modification time.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct OldFile {
    pub entry: IndexedEntry,
    pub modified_at_ms: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct OldFilePage {
    pub items: Vec<OldFile>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ScanHistoryPage {
    pub items: Vec<ScanSession>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ScanComparison {
    pub newer_scan_id: String,
    pub older_scan_id: String,
    pub files_delta: String,
    pub directories_delta: String,
    pub logical_size_delta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct DuplicateGroup {
    pub size: String,
    pub files_count: String,
    pub reclaimable_size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct DuplicateGroupPage {
    pub items: Vec<DuplicateGroup>,
    pub next_cursor: Option<String>,
}

#[cfg(test)]
mod scan_tests {
    use super::*;
    #[test]
    fn terminal_sessions_cannot_be_restarted() {
        for state in [
            ScanState::Completed,
            ScanState::Partial,
            ScanState::Cancelled,
            ScanState::Failed,
            ScanState::Interrupted,
        ] {
            assert!(!state.can_transition(ScanState::Scanning));
            assert!(!state.can_transition(ScanState::Cancelling));
        }
        assert!(ScanState::Scanning.can_transition(ScanState::Cancelling));
        assert!(ScanState::Cancelling.can_transition(ScanState::Cancelled));
    }
    #[test]
    fn counters_above_javascript_safe_integer_are_lossless_strings() {
        let volume = VolumeInfo {
            name: "disk".into(),
            mount_point: Some("/".into()),
            filesystem: "test".into(),
            total_bytes: u64::MAX.to_string(),
            available_bytes: "0".into(),
        };
        let json = serde_json::to_value(volume).unwrap();
        assert_eq!(json["total_bytes"], "18446744073709551615");
    }
}
