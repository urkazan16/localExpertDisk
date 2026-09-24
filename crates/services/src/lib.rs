use domain::{AppError, AppInfo};
use filesystem::PlatformProvider;
use storage::StorageStatus;

pub fn get_app_info(
    storage: &impl StorageStatus,
    platform: &impl PlatformProvider,
) -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        platform: platform.platform(),
        schema_version: storage.schema_version()?,
        capabilities: platform.capabilities(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::ErrorCode;
    use filesystem::LocalPlatform;
    use storage::SqliteStorage;

    #[test]
    fn reports_migrated_storage_without_advertising_unimplemented_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        let storage = SqliteStorage::open(&dir.path().join("test.db")).unwrap();
        let info = get_app_info(&storage, &LocalPlatform).unwrap();
        assert_eq!(info.schema_version, 4);
        assert_eq!(info.capabilities, Default::default());
    }

    #[test]
    fn storage_failure_is_not_reported_as_ready() {
        struct BrokenStorage;
        impl StorageStatus for BrokenStorage {
            fn schema_version(&self) -> Result<u32, AppError> {
                Err(AppError {
                    code: ErrorCode::StorageUnavailable,
                    user_message_key: "errors.storage_unavailable".into(),
                    recoverable: true,
                })
            }
        }
        assert_eq!(
            get_app_info(&BrokenStorage, &LocalPlatform)
                .unwrap_err()
                .code,
            ErrorCode::StorageUnavailable
        );
    }
}

pub mod scans;
