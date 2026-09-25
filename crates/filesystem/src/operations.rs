use domain::{AppError, ErrorCode};
use std::path::Path;

pub trait TrashProvider: Send + Sync {
    fn move_to_trash(&self, path: &Path) -> Result<(), AppError>;
}

pub struct NativeTrash;

impl TrashProvider for NativeTrash {
    fn move_to_trash(&self, path: &Path) -> Result<(), AppError> {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            trash::delete(path).map_err(|error| AppError::new(trash_error_code(&error)))
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = path;
            Err(AppError::new(ErrorCode::TrashUnavailable))
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn trash_error_code(error: &trash::Error) -> ErrorCode {
    #[cfg(target_os = "linux")]
    if let trash::Error::FileSystem { source, .. } = error {
        if source.kind() == std::io::ErrorKind::PermissionDenied {
            return ErrorCode::PermissionDenied;
        }
    }
    if let trash::Error::Os { code, .. } = error {
        // Windows ERROR_ACCESS_DENIED, Unix EPERM/EACCES and Cocoa file-write denial.
        if matches!(*code, 1 | 5 | 13 | 513) {
            return ErrorCode::PermissionDenied;
        }
    }
    ErrorCode::TrashUnavailable
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    #[test]
    fn native_permission_errors_are_not_reported_as_generic_trash_failures() {
        let error = trash::Error::Os {
            code: 5,
            description: "access denied".into(),
        };
        assert_eq!(trash_error_code(&error), ErrorCode::PermissionDenied);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn freedesktop_filesystem_permission_errors_are_preserved() {
        let error = trash::Error::FileSystem {
            path: "/protected".into(),
            source: std::io::ErrorKind::PermissionDenied.into(),
        };
        assert_eq!(trash_error_code(&error), ErrorCode::PermissionDenied);
    }
}
