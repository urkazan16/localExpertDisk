use domain::{AppError, ErrorCode};
use std::{path::Path, process::Command};

pub trait TrashProvider: Send + Sync {
    fn move_to_trash(&self, path: &Path) -> Result<(), AppError>;
}

pub struct NativeTrash;

impl TrashProvider for NativeTrash {
    fn move_to_trash(&self, path: &Path) -> Result<(), AppError> {
        #[cfg(target_os = "macos")]
        {
            // The path is an argv value, never interpolated into AppleScript source.
            let script = "on run argv\n tell application \"Finder\" to delete POSIX file (item 1 of argv)\nend run";
            Command::new("osascript")
                .args(["-e", script])
                .arg(path)
                .status()
                .ok()
                .filter(|status| status.success())
                .map(|_| ())
                .ok_or_else(|| AppError::new(ErrorCode::TrashUnavailable))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = path;
            Err(AppError::new(ErrorCode::TrashUnavailable))
        }
    }
}
