//! All SQLite access stays here. Migrations are atomic and forward-only.
use domain::{AppError, ErrorCode};
use rusqlite::{Connection, TransactionBehavior};
use std::{path::Path, time::Duration};

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "schema_migrations",
        include_str!("../migrations/0001_schema_migrations.sql"),
    ),
    ("scans", include_str!("../migrations/0002_scans.sql")),
    (
        "entry_query_indexes",
        include_str!("../migrations/0003_entry_query_indexes.sql"),
    ),
    (
        "entry_timestamps",
        include_str!("../migrations/0004_entry_timestamps.sql"),
    ),
    (
        "history_comparison",
        include_str!("../migrations/0005_history_comparison.sql"),
    ),
    (
        "duplicate_hashes",
        include_str!("../migrations/0006_duplicate_hashes.sql"),
    ),
    (
        "entry_lifecycle_timestamps",
        include_str!("../migrations/0007_entry_lifecycle_timestamps.sql"),
    ),
    (
        "allocated_size",
        include_str!("../migrations/0008_allocated_size.sql"),
    ),
    (
        "entry_allocated_size",
        include_str!("../migrations/0009_entry_allocated_size.sql"),
    ),
    (
        "unique_allocated_size",
        include_str!("../migrations/0010_unique_allocated_size.sql"),
    ),
    (
        "identity_owner",
        include_str!("../migrations/0011_identity_owner.sql"),
    ),
    (
        "duplicate_fingerprint_cache",
        include_str!("../migrations/0012_duplicate_fingerprint_cache.sql"),
    ),
    (
        "entry_category",
        include_str!("../migrations/0013_entry_category.sql"),
    ),
    (
        "history_duplicates",
        include_str!("../migrations/0014_history_duplicates.sql"),
    ),
];

pub trait StorageStatus {
    fn schema_version(&self) -> Result<u32, AppError>;
}

/// Foundation boundary for services that persist scan state.
/// Concrete scan queries remain on `SqliteStorage` until a second store exists.
pub trait ScanStore: StorageStatus {}

pub struct SqliteStorage {
    connection: Connection,
}

fn storage_error(error: rusqlite::Error) -> AppError {
    // Log the category only: SQLite diagnostics can contain filesystem paths.
    tracing::error!(component = "storage", operation = "sqlite", code = ?error.sqlite_error_code(), "Database operation failed");
    AppError {
        code: ErrorCode::StorageUnavailable,
        user_message_key: "errors.storage_unavailable".into(),
        recoverable: true,
    }
}

fn schema_error(code: ErrorCode, key: &str) -> AppError {
    AppError {
        code,
        user_message_key: key.into(),
        recoverable: false,
    }
}

fn migrate(connection: &mut Connection, migrations: &[(&str, &str)]) -> Result<(), AppError> {
    // Read the version under the same write lock as the migration itself.
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage_error)?;
    let version: u32 = transaction
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(storage_error)?;
    if version as usize > migrations.len() {
        return Err(schema_error(
            ErrorCode::UnsupportedSchema,
            "errors.unsupported_schema",
        ));
    }
    if version > 0 {
        let recorded: Vec<(u32, String)> = {
            let mut statement = transaction
                .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
                .map_err(storage_error)?;
            let rows = statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(storage_error)?;
            rows.collect::<Result<_, _>>().map_err(storage_error)?
        };
        let expected: Vec<_> = migrations
            .iter()
            .take(version as usize)
            .enumerate()
            .map(|(i, (name, _))| ((i + 1) as u32, (*name).to_owned()))
            .collect();
        if recorded != expected {
            return Err(schema_error(
                ErrorCode::InvalidSchema,
                "errors.invalid_schema",
            ));
        }
    }
    for (index, (name, sql)) in migrations.iter().enumerate().skip(version as usize) {
        transaction.execute_batch(sql).map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                ((index + 1) as u32, name),
            )
            .map_err(storage_error)?;
        transaction
            .pragma_update(None, "user_version", (index + 1) as u32)
            .map_err(storage_error)?;
        tracing::info!(
            component = "storage",
            operation = "migration",
            version = index + 1
        );
    }
    transaction.commit().map_err(storage_error)
}

impl SqliteStorage {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let mut connection = Connection::open(path).map_err(storage_error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(storage_error)?;
        // Scan data is reconstructible. WAL keeps batch commits atomic while NORMAL avoids
        // a full filesystem sync for every bounded scanner batch.
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(storage_error)?;
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(storage_error)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(storage_error)?;
        migrate(&mut connection, MIGRATIONS)?;
        Ok(Self { connection })
    }
}

impl StorageStatus for SqliteStorage {
    fn schema_version(&self) -> Result<u32, AppError> {
        self.connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(storage_error)
    }
}

impl ScanStore for SqliteStorage {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_database_migrates_and_reopens_without_losing_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let db = SqliteStorage::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), 14);
        db.connection
            .execute_batch(
                "CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('preserved');",
            )
            .unwrap();
        drop(db);
        let db = SqliteStorage::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), 14);
        let marker: String = db
            .connection
            .query_row("SELECT value FROM marker", [], |row| row.get(0))
            .unwrap();
        assert_eq!(marker, "preserved");
    }

    #[test]
    fn identity_owner_migration_backfills_the_first_hardlink_entry() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection, &MIGRATIONS[..10]).unwrap();
        connection
            .execute_batch(
                "INSERT INTO scan_sessions(root_path,root_display,state,started_at_ms,finished_at_ms)
                   VALUES (X'2F','/','completed',1,2);
                 INSERT INTO entries(scan_id,parent_id,path,name,kind,logical_size,allocated_size,identity)
                   VALUES (1,NULL,X'2F','/','directory',0,NULL,NULL);
                 INSERT INTO entries(scan_id,parent_id,path,name,kind,logical_size,allocated_size,identity)
                   VALUES (1,1,X'2F61','a','file',10,4096,'device:inode');
                 INSERT INTO entries(scan_id,parent_id,path,name,kind,logical_size,allocated_size,identity)
                   VALUES (1,1,X'2F62','b','file',10,4096,'device:inode');
                 INSERT INTO scan_file_identities(scan_id,identity,allocated_size)
                   VALUES (1,'device:inode',4096);",
            )
            .unwrap();
        migrate(&mut connection, MIGRATIONS).unwrap();
        let owner: i64 = connection
            .query_row(
                "SELECT owner_entry_id FROM scan_file_identities WHERE scan_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, 2);
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .unwrap(),
            14
        );
    }

    #[test]
    fn newer_database_is_rejected_without_downgrading() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", 999).unwrap();
        assert_eq!(
            migrate(&mut connection, MIGRATIONS).unwrap_err().code,
            ErrorCode::UnsupportedSchema
        );
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 999);
    }

    #[test]
    fn failed_migration_rolls_back_ddl_and_version() {
        let mut connection = Connection::open_in_memory().unwrap();
        let migrations = [
            MIGRATIONS[0],
            MIGRATIONS[1],
            ("broken", "CREATE TABLE partial(value TEXT); INVALID SQL;"),
        ];
        assert!(migrate(&mut connection, &migrations).is_err());
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 0);
        assert!(connection.prepare("SELECT * FROM partial").is_err());
        assert!(connection
            .prepare("SELECT COUNT(*) FROM schema_migrations")
            .is_err());
    }

    #[test]
    fn inconsistent_migration_history_is_rejected() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection, MIGRATIONS).unwrap();
        connection
            .execute("UPDATE schema_migrations SET name = 'unexpected'", [])
            .unwrap();
        assert_eq!(
            migrate(&mut connection, MIGRATIONS).unwrap_err().code,
            ErrorCode::InvalidSchema
        );
    }

    #[test]
    fn corrupted_database_is_rejected_without_creating_schema_tables() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("corrupted.db");
        std::fs::write(&path, b"not a sqlite database").unwrap();
        let error = match SqliteStorage::open(&path) {
            Ok(_) => panic!("corrupted database must be rejected"),
            Err(error) => error,
        };
        assert_eq!(error.code, ErrorCode::StorageUnavailable);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes, b"not a sqlite database");
    }

    #[test]
    fn failed_batch_commit_rolls_back_and_restart_marks_scan_interrupted() {
        use analyzer::Totals;
        use filesystem::native::{EntryKind, EntryMetadata};
        use scanner::EntryDraft;

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("commit.db");
        let root = directory.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let file = root.join("file");
        std::fs::write(&file, b"payload").unwrap();
        let root_metadata = EntryMetadata {
            kind: EntryKind::Directory,
            logical_size: 0,
            allocated_size: None,
            created_at_ms: None,
            modified_at_ms: None,
            accessed_at_ms: None,
            identity: Some("root".into()),
            link_count: None,
        };
        let file_metadata = EntryMetadata {
            kind: EntryKind::File,
            logical_size: 7,
            allocated_size: Some(4096),
            created_at_ms: None,
            modified_at_ms: None,
            accessed_at_ms: None,
            identity: Some("file".into()),
            link_count: Some(1),
        };
        let mut storage = SqliteStorage::open(&database).unwrap();
        let scan = storage.create_scan(&root).unwrap();
        let scan_id = scans::parse_id(&scan.id).unwrap();
        storage
            .transition(scan_id, domain::ScanState::Preparing, None)
            .unwrap();
        storage.seed_root(scan_id, &root, &root_metadata).unwrap();
        storage
            .transition(scan_id, domain::ScanState::Scanning, None)
            .unwrap();
        let parent = storage.next_directory(scan_id).unwrap().unwrap().id;
        storage
            .connection
            .execute_batch(
                "CREATE TRIGGER interrupt_batch BEFORE UPDATE OF files_count ON scan_sessions
                 BEGIN SELECT RAISE(ABORT, 'injected commit interruption'); END;",
            )
            .unwrap();
        assert!(storage
            .write_scan_batch(
                scan_id,
                parent,
                &[EntryDraft {
                    path: file,
                    metadata: file_metadata,
                }],
                &[],
                Totals {
                    files: 1,
                    directories: 1,
                    logical: 7,
                    allocated: Some(4096),
                    ..Default::default()
                },
            )
            .is_err());
        let entries: i64 = storage
            .connection
            .query_row(
                "SELECT COUNT(*) FROM entries WHERE scan_id=?1",
                [scan_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(entries, 1, "the entire failed batch must roll back");
        storage
            .connection
            .execute_batch("DROP TRIGGER interrupt_batch")
            .unwrap();
        drop(storage);

        let mut reopened = SqliteStorage::open(&database).unwrap();
        reopened.recover_scans().unwrap();
        let recovered = reopened.get_scan(scan_id).unwrap();
        assert_eq!(recovered.state, domain::ScanState::Interrupted);
        assert_eq!(recovered.files_count, "0");
        assert_eq!(
            recovered.unique_allocated_size.as_deref(),
            cfg!(unix).then_some("0")
        );
    }
}

pub mod scans;
