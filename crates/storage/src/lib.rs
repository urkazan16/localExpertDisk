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
];

pub trait StorageStatus {
    fn schema_version(&self) -> Result<u32, AppError>;
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_database_migrates_and_reopens_without_losing_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let db = SqliteStorage::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), 4);
        db.connection
            .execute_batch(
                "CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('preserved');",
            )
            .unwrap();
        drop(db);
        let db = SqliteStorage::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), 4);
        let marker: String = db
            .connection
            .query_row("SELECT value FROM marker", [], |row| row.get(0))
            .unwrap();
        assert_eq!(marker, "preserved");
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
        migrate(&mut connection, MIGRATIONS).unwrap();
        let migrations = [
            MIGRATIONS[0],
            MIGRATIONS[1],
            ("broken", "CREATE TABLE partial(value TEXT); INVALID SQL;"),
        ];
        assert!(migrate(&mut connection, &migrations).is_err());
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 4);
        assert!(connection.prepare("SELECT * FROM partial").is_err());
        let count: u32 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 4);
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
}

pub mod scans;
