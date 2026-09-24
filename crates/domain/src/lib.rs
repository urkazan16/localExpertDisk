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
