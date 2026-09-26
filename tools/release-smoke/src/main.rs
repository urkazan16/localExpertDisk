use rusqlite::Connection;
use std::{env, path::Path};
use storage::{SqliteStorage, StorageStatus};

const RETENTION_MARKER: u16 = 37;

fn open_and_check(path: &Path) -> Result<(u32, u16), String> {
    let storage = SqliteStorage::open(path).map_err(|error| format!("{:?}", error.code))?;
    let schema = storage
        .schema_version()
        .map_err(|error| format!("{:?}", error.code))?;
    let retention = storage
        .retention_policy()
        .map_err(|error| format!("{:?}", error.code))?
        .keep_latest;
    drop(storage);
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if schema == 0 || integrity != "ok" {
        return Err(format!(
            "release database is not ready (schema={schema}, integrity={integrity})"
        ));
    }
    Ok((schema, retention))
}

fn mark(path: &Path) -> Result<(), String> {
    let mut storage = SqliteStorage::open(path).map_err(|error| format!("{:?}", error.code))?;
    storage
        .set_retention_policy(RETENTION_MARKER)
        .map_err(|error| format!("{:?}", error.code))?;
    Ok(())
}

fn verify(path: &Path) -> Result<(), String> {
    let (schema, retention) = open_and_check(path)?;
    if retention != RETENTION_MARKER {
        return Err(format!(
            "release database marker was not preserved (schema={schema}, retention={})",
            retention
        ));
    }
    Ok(())
}

fn run(arguments: impl IntoIterator<Item = String>) -> Result<(), String> {
    let mut arguments = arguments.into_iter();
    let operation = arguments
        .next()
        .ok_or_else(|| "expected probe, mark or verify operation".to_owned())?;
    let database = arguments
        .next()
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "expected SQLite path".to_owned())?;
    if arguments.next().is_some() || !database.is_absolute() {
        return Err("expected one absolute SQLite path".to_owned());
    }
    match operation.as_str() {
        "probe" => open_and_check(&database).map(|_| ()),
        "mark" => mark(&database),
        "verify" => verify(&database),
        _ => Err("expected probe, mark or verify operation".to_owned()),
    }
}

fn main() {
    if let Err(error) = run(env::args().skip(1)) {
        eprintln!("release smoke failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_survives_reopen_and_integrity_check() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("index.db");
        mark(&database).unwrap();
        open_and_check(&database).unwrap();
        verify(&database).unwrap();
    }

    #[test]
    fn verify_rejects_an_unmarked_database() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("index.db");
        SqliteStorage::open(&database).unwrap();
        assert!(verify(&database).unwrap_err().contains("not preserved"));
    }
}
