use crate::{storage_error, SqliteStorage};
use analyzer::Totals;
use domain::{
    AppError, DuplicateGroup, DuplicateGroupPage, EntryPage, ErrorCode, IndexedEntry,
    IndexedEntryKind, OldFile, OldFileCriterion, OldFilePage, ScanComparison, ScanHistoryPage,
    ScanIssue, ScanIssuePage, ScanSession, ScanState,
};
use filesystem::native::{decode_path, encode_path, EntryKind, EntryMetadata};
use rusqlite::{params, Connection, OptionalExtension};
use scanner::{DirectoryTask, EntryDraft};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

fn internal() -> AppError {
    AppError::new(ErrorCode::InvalidSchema)
}
fn timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
fn state_name(state: ScanState) -> Result<String, AppError> {
    serde_json::to_value(state)
        .map_err(|_| internal())?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(internal)
}
pub fn parse_id(id: &str) -> Result<i64, AppError> {
    id.parse::<i64>()
        .ok()
        .filter(|value| *value > 0 && value.to_string() == id)
        .ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))
}
#[derive(Debug, Clone)]
pub struct OperationTarget {
    pub root_path: std::path::PathBuf,
    pub path: std::path::PathBuf,
    pub kind: EntryKind,
    pub logical_size: u64,
    pub identity: Option<String>,
    pub modified_at_ms: Option<i64>,
}
#[derive(Debug, Clone)]
pub struct HashCandidate {
    pub id: i64,
    pub path: std::path::PathBuf,
    pub size: u64,
    pub identity: Option<String>,
    pub modified_at_ms: Option<i64>,
}
fn integer(value: u64) -> Result<i64, AppError> {
    i64::try_from(value).map_err(|_| AppError::new(ErrorCode::SizeOverflow))
}
fn read_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScanSession> {
    let state: String = row.get(2)?;
    let state = serde_json::from_value(serde_json::Value::String(state)).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let failure: Option<String> = row.get(12)?;
    let failure = failure
        .map(|text| serde_json::from_str(&text))
        .transpose()
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e))
        })?;
    Ok(ScanSession {
        id: row.get::<_, i64>(0)?.to_string(),
        root_path: row.get(1)?,
        state,
        files_count: row.get::<_, i64>(3)?.to_string(),
        directories_count: row.get::<_, i64>(4)?.to_string(),
        symlinks_count: row.get::<_, i64>(5)?.to_string(),
        skipped_count: row.get::<_, i64>(6)?.to_string(),
        logical_size: row.get::<_, i64>(7)?.to_string(),
        allocated_size: row.get::<_, Option<i64>>(8)?.map(|value| value.to_string()),
        errors_count: row.get::<_, i64>(9)?.to_string(),
        started_at_ms: row.get::<_, i64>(10)?.to_string(),
        finished_at_ms: row.get::<_, Option<i64>>(11)?.map(|n| n.to_string()),
        failure,
    })
}

fn read_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<IndexedEntry> {
    let kind = match row.get::<_, String>(4)?.as_str() {
        "file" => IndexedEntryKind::File,
        "directory" => IndexedEntryKind::Directory,
        "symlink" => IndexedEntryKind::Symlink,
        "other" => IndexedEntryKind::Other,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    let path = decode_path(row.get(3)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Blob, Box::new(error))
    })?;
    Ok(IndexedEntry {
        id: row.get::<_, i64>(0)?.to_string(),
        parent_id: row.get::<_, Option<i64>>(1)?.map(|id| id.to_string()),
        name: row.get(2)?,
        path: path.to_string_lossy().into_owned(),
        kind,
        logical_size: row.get::<_, i64>(5)?.to_string(),
        aggregate_size: row.get::<_, i64>(6)?.to_string(),
    })
}

fn parse_large_cursor(cursor: Option<&str>) -> Result<(i64, i64), AppError> {
    let Some(cursor) = cursor else {
        return Ok((i64::MAX, 0));
    };
    let Some((size, id)) = cursor.split_once(':') else {
        return Err(AppError::new(ErrorCode::ScanNotFound));
    };
    let size = size.parse::<i64>().ok().filter(|value| *value >= 0);
    let id = id.parse::<i64>().ok().filter(|value| *value > 0);
    size.zip(id)
        .ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))
}
fn parse_old_files_cursor(cursor: Option<&str>) -> Result<(i64, i64), AppError> {
    let Some(cursor) = cursor else {
        return Ok((i64::MIN, 0));
    };
    let Some((modified_at_ms, id)) = cursor.split_once(':') else {
        return Err(AppError::new(ErrorCode::ScanNotFound));
    };
    let modified_at_ms = modified_at_ms.parse::<i64>().ok();
    let id = id.parse::<i64>().ok().filter(|value| *value > 0);
    modified_at_ms
        .zip(id)
        .ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))
}
const SELECT_SESSION: &str = "SELECT id,root_display,state,files_count,directories_count,symlinks_count,skipped_count,logical_size,allocated_size,errors_count,started_at_ms,finished_at_ms,failure FROM scan_sessions";

fn aggregate(connection: &Connection, id: i64) -> Result<Totals, AppError> {
    connection
        .query_row(
            "SELECT files_count,directories_count,logical_size,allocated_size FROM directory_aggregates WHERE entry_id=?1",
            [id],
            |row| {
                Ok(Totals {
                    files: row.get(0)?,
                    directories: row.get(1)?,
                    logical: row.get(2)?,
                    allocated: row.get(3)?,
                    ..Default::default()
                })
            },
        )
        .map_err(storage_error)
}
fn update_aggregate(connection: &Connection, id: i64, totals: Totals) -> Result<(), AppError> {
    connection.execute("UPDATE directory_aggregates SET files_count=?2,directories_count=?3,logical_size=?4,allocated_size=?5 WHERE entry_id=?1", params![id, integer(totals.files)?, integer(totals.directories)?, integer(totals.logical)?, totals.allocated.map(integer).transpose()?]).map_err(storage_error)?;
    Ok(())
}

impl SqliteStorage {
    fn ensure_queryable(&self, scan_id: i64) -> Result<(), AppError> {
        match self.get_scan(scan_id)?.state {
            ScanState::Completed | ScanState::Partial | ScanState::Cancelled => Ok(()),
            _ => Err(AppError::new(ErrorCode::ScanNotReady)),
        }
    }
    /// Caller must hold the process-wide OS lock before recovery.
    pub fn recover_scans(&mut self) -> Result<(), AppError> {
        let tx = self.connection.transaction().map_err(storage_error)?;
        tx.execute("UPDATE scan_sessions SET state='interrupted',finished_at_ms=?1 WHERE finished_at_ms IS NULL", [timestamp()]).map_err(storage_error)?;
        tx.execute("DELETE FROM directory_queue", [])
            .map_err(storage_error)?;
        tx.commit().map_err(storage_error)
    }
    pub fn create_scan(&mut self, root: &Path) -> Result<ScanSession, AppError> {
        let active: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM scan_sessions WHERE finished_at_ms IS NULL)",
                [],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        if active {
            return Err(AppError::new(ErrorCode::ScanBusy));
        }
        self.connection.execute("INSERT INTO scan_sessions(root_path,root_display,state,started_at_ms) VALUES (?1,?2,'created',?3)", params![encode_path(root),root.to_string_lossy(),timestamp()]).map_err(storage_error)?;
        self.get_scan(self.connection.last_insert_rowid())
    }
    pub fn get_scan(&self, id: i64) -> Result<ScanSession, AppError> {
        self.connection
            .query_row(&format!("{SELECT_SESSION} WHERE id=?1"), [id], read_session)
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))
    }
    pub fn latest_scan(&self) -> Result<Option<ScanSession>, AppError> {
        self.connection
            .query_row(
                &format!("{SELECT_SESSION} ORDER BY id DESC LIMIT 1"),
                [],
                read_session,
            )
            .optional()
            .map_err(storage_error)
    }
    fn latest_queryable_scan(&self) -> Result<Option<ScanSession>, AppError> {
        self.connection
            .query_row(
                &format!("{SELECT_SESSION} WHERE state IN ('completed','partial','cancelled') ORDER BY id DESC LIMIT 1"),
                [],
                read_session,
            )
            .optional()
            .map_err(storage_error)
    }
    pub fn scan_history(&self, after: i64) -> Result<ScanHistoryPage, AppError> {
        let mut statement = self
            .connection
            .prepare(&format!(
                "{SELECT_SESSION} WHERE id<?1 ORDER BY id DESC LIMIT 51"
            ))
            .map_err(storage_error)?;
        let mut rows = statement
            .query_map([if after == 0 { i64::MAX } else { after }], read_session)
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let next_cursor = if rows.len() > 50 {
            rows.pop();
            rows.last().map(|scan| scan.id.clone())
        } else {
            None
        };
        Ok(ScanHistoryPage {
            items: rows,
            next_cursor,
        })
    }
    pub fn compare_scans(&self, newer: i64, older: i64) -> Result<ScanComparison, AppError> {
        let newer = self.get_scan(newer)?;
        let older = self.get_scan(older)?;
        self.ensure_queryable(parse_id(&newer.id)?)?;
        self.ensure_queryable(parse_id(&older.id)?)?;
        if newer.root_path != older.root_path {
            return Err(AppError::new(ErrorCode::IncompatibleScans));
        }
        let delta = |a: &str, b: &str| -> Result<String, AppError> {
            Ok((a.parse::<i64>().map_err(|_| internal())?
                - b.parse::<i64>().map_err(|_| internal())?)
            .to_string())
        };
        let counts: (i64, i64, i64, i64) = self.connection.query_row(
            "SELECT
                (SELECT COUNT(*) FROM entries n WHERE n.scan_id=?1 AND n.parent_id IS NOT NULL AND n.kind='file' AND NOT EXISTS (SELECT 1 FROM entries o WHERE o.scan_id=?2 AND o.kind='file' AND ((n.identity IS NOT NULL AND n.identity=o.identity) OR (n.identity IS NULL AND o.identity IS NULL AND n.path=o.path)))),
                (SELECT COUNT(*) FROM entries o WHERE o.scan_id=?2 AND o.parent_id IS NOT NULL AND o.kind='file' AND NOT EXISTS (SELECT 1 FROM entries n WHERE n.scan_id=?1 AND n.kind='file' AND ((n.identity IS NOT NULL AND n.identity=o.identity) OR (n.identity IS NULL AND o.identity IS NULL AND n.path=o.path)))),
                (SELECT COUNT(*) FROM entries n JOIN entries o ON o.scan_id=?2 AND o.kind='file' AND ((n.identity IS NOT NULL AND n.identity=o.identity) OR (n.identity IS NULL AND o.identity IS NULL AND n.path=o.path)) WHERE n.scan_id=?1 AND n.parent_id IS NOT NULL AND n.kind='file' AND (n.logical_size<>o.logical_size OR n.modified_at_ms IS NOT o.modified_at_ms)),
                (SELECT COUNT(*) FROM entries n JOIN entries o ON o.scan_id=?2 AND n.identity IS NOT NULL AND n.identity=o.identity WHERE n.scan_id=?1 AND n.parent_id IS NOT NULL AND n.kind='file' AND n.path<>o.path)",
            params![parse_id(&newer.id)?, parse_id(&older.id)?],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).map_err(storage_error)?;
        Ok(ScanComparison {
            newer_scan_id: newer.id,
            older_scan_id: older.id,
            files_delta: delta(&newer.files_count, &older.files_count)?,
            directories_delta: delta(&newer.directories_count, &older.directories_count)?,
            logical_size_delta: delta(&newer.logical_size, &older.logical_size)?,
            added_files_count: counts.0.to_string(),
            removed_files_count: counts.1.to_string(),
            modified_files_count: counts.2.to_string(),
            moved_files_count: counts.3.to_string(),
        })
    }
    pub fn delete_scan_history(&mut self, scan_id: i64) -> Result<(), AppError> {
        self.ensure_queryable(scan_id)?;
        let tx = self.connection.transaction().map_err(storage_error)?;
        let mut statement = tx.prepare(
            "WITH RECURSIVE subtree(id,depth) AS (
                SELECT id,0 FROM entries WHERE scan_id=?1 AND parent_id IS NULL
                UNION ALL SELECT e.id,s.depth+1 FROM entries e JOIN subtree s ON e.parent_id=s.id WHERE e.scan_id=?1
            ) SELECT id,depth FROM subtree",
        ).map_err(storage_error)?;
        let mut entries = statement
            .query_map([scan_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        drop(statement);
        entries.sort_by_key(|(_, depth)| std::cmp::Reverse(*depth));
        for (entry_id, _) in &entries {
            tx.execute("DELETE FROM directory_queue WHERE entry_id=?1", [entry_id])
                .map_err(storage_error)?;
            tx.execute(
                "DELETE FROM directory_aggregates WHERE entry_id=?1",
                [entry_id],
            )
            .map_err(storage_error)?;
        }
        for (entry_id, _) in entries {
            tx.execute("DELETE FROM entries WHERE id=?1", [entry_id])
                .map_err(storage_error)?;
        }
        tx.execute("DELETE FROM scan_errors WHERE scan_id=?1", [scan_id])
            .map_err(storage_error)?;
        tx.execute("DELETE FROM scan_sessions WHERE id=?1", [scan_id])
            .map_err(storage_error)?;
        tx.commit().map_err(storage_error)
    }
    pub fn transition(
        &mut self,
        id: i64,
        next: ScanState,
        error: Option<&AppError>,
    ) -> Result<ScanSession, AppError> {
        let current = self.get_scan(id)?;
        if !current.state.can_transition(next) {
            return Err(AppError::new(ErrorCode::InvalidTransition));
        }
        let tx = self.connection.transaction().map_err(storage_error)?;
        let failure = error
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| internal())?;
        tx.execute(
            "UPDATE scan_sessions SET state=?2,finished_at_ms=?3,failure=?4 WHERE id=?1",
            params![
                id,
                state_name(next)?,
                next.is_terminal().then(timestamp),
                failure
            ],
        )
        .map_err(storage_error)?;
        if next.is_terminal() {
            tx.execute("DELETE FROM directory_queue WHERE entry_id IN (SELECT id FROM entries WHERE scan_id=?1)", [id]).map_err(storage_error)?;
        }
        tx.commit().map_err(storage_error)?;
        self.get_scan(id)
    }
    pub fn seed_root(
        &mut self,
        scan_id: i64,
        path: &Path,
        metadata: &EntryMetadata,
    ) -> Result<(), AppError> {
        let tx = self.connection.transaction().map_err(storage_error)?;
        tx.execute("INSERT INTO entries(scan_id,parent_id,path,name,kind,logical_size,allocated_size,created_at_ms,modified_at_ms,accessed_at_ms,identity) VALUES (?1,NULL,?2,?3,'directory',0,NULL,?4,?5,?6,?7)", params![scan_id,encode_path(path),path.to_string_lossy(),metadata.created_at_ms,metadata.modified_at_ms,metadata.accessed_at_ms,metadata.identity]).map_err(storage_error)?;
        let id = tx.last_insert_rowid();
        tx.execute("INSERT INTO directory_queue(entry_id) VALUES (?1)", [id])
            .map_err(storage_error)?;
        tx.execute(
            "INSERT INTO directory_aggregates(entry_id,allocated_size) VALUES (?1,?2)",
            params![id, cfg!(unix).then_some(0_i64)],
        )
        .map_err(storage_error)?;
        tx.execute(
            "UPDATE scan_sessions SET directories_count=1 WHERE id=?1",
            [scan_id],
        )
        .map_err(storage_error)?;
        tx.commit().map_err(storage_error)
    }
    pub fn next_directory(&self, scan_id: i64) -> Result<Option<DirectoryTask>, AppError> {
        let value = self.connection.query_row("SELECT e.id,e.path,e.identity,e.parent_id IS NULL FROM directory_queue q JOIN entries e ON e.id=q.entry_id WHERE e.scan_id=?1 ORDER BY e.id LIMIT 1", [scan_id], |row| Ok((row.get::<_,i64>(0)?, row.get::<_,Vec<u8>>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,bool>(3)?))).optional().map_err(storage_error)?;
        value
            .map(|(id, path, identity, is_root)| {
                Ok(DirectoryTask {
                    id,
                    path: decode_path(path).map_err(|_| internal())?,
                    identity,
                    is_root,
                })
            })
            .transpose()
    }
    pub fn write_scan_batch(
        &mut self,
        scan_id: i64,
        parent: i64,
        entries: &[EntryDraft],
        issues: &[ScanIssue],
        totals: Totals,
    ) -> Result<(), AppError> {
        let tx = self.connection.transaction().map_err(storage_error)?;
        let mut direct = aggregate(&tx, parent)?;
        for entry in entries {
            let m = &entry.metadata;
            tx.execute("INSERT INTO entries(scan_id,parent_id,path,name,kind,logical_size,allocated_size,created_at_ms,modified_at_ms,accessed_at_ms,identity) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)", params![scan_id,parent,encode_path(&entry.path),entry.path.file_name().unwrap_or_default().to_string_lossy(),m.kind.as_str(),integer(m.logical_size)?,m.allocated_size.map(integer).transpose()?,m.created_at_ms,m.modified_at_ms,m.accessed_at_ms,m.identity]).map_err(storage_error)?;
            if m.kind == EntryKind::Directory {
                let id = tx.last_insert_rowid();
                tx.execute("INSERT INTO directory_queue(entry_id) VALUES (?1)", [id])
                    .map_err(storage_error)?;
                tx.execute(
                    "INSERT INTO directory_aggregates(entry_id,allocated_size) VALUES (?1,?2)",
                    params![id, cfg!(unix).then_some(0_i64)],
                )
                .map_err(storage_error)?;
                tx.execute("UPDATE directory_aggregates SET pending_children=pending_children+1 WHERE entry_id=?1", [parent]).map_err(storage_error)?;
            }
            direct = direct.merge(Totals {
                files: u64::from(m.kind == EntryKind::File),
                directories: u64::from(m.kind == EntryKind::Directory),
                logical: m.logical_size,
                allocated: if m.kind == EntryKind::File {
                    m.allocated_size
                } else {
                    cfg!(unix).then_some(0)
                },
                ..Default::default()
            })?;
        }
        update_aggregate(&tx, parent, direct)?;
        for issue in issues {
            tx.execute(
                "INSERT INTO scan_errors(scan_id,path,code,operation) VALUES (?1,?2,?3,?4)",
                params![scan_id, issue.path, issue.code, issue.operation],
            )
            .map_err(storage_error)?;
        }
        let allocated_size = totals.allocated.map(integer).transpose()?;
        tx.execute("UPDATE scan_sessions SET files_count=?2,directories_count=?3,symlinks_count=?4,skipped_count=?5,logical_size=?6,allocated_size=?7,errors_count=?8 WHERE id=?1", params![scan_id,integer(totals.files)?,integer(totals.directories)?,integer(totals.symlinks)?,integer(totals.skipped)?,integer(totals.logical)?,allocated_size,integer(totals.errors)?]).map_err(storage_error)?;
        tx.commit().map_err(storage_error)
    }
    pub fn finish_directory(&mut self, id: i64) -> Result<(), AppError> {
        let tx = self.connection.transaction().map_err(storage_error)?;
        tx.execute("DELETE FROM directory_queue WHERE entry_id=?1", [id])
            .map_err(storage_error)?;
        tx.execute(
            "UPDATE directory_aggregates SET enumerated=1 WHERE entry_id=?1",
            [id],
        )
        .map_err(storage_error)?;
        let mut current = Some(id);
        while let Some(id) = current {
            let ready: bool = tx.query_row("SELECT enumerated=1 AND pending_children=0 AND finalized=0 FROM directory_aggregates WHERE entry_id=?1", [id], |row| row.get(0)).map_err(storage_error)?;
            if !ready {
                break;
            }
            tx.execute(
                "UPDATE directory_aggregates SET finalized=1 WHERE entry_id=?1",
                [id],
            )
            .map_err(storage_error)?;
            let parent: Option<i64> = tx
                .query_row("SELECT parent_id FROM entries WHERE id=?1", [id], |row| {
                    row.get(0)
                })
                .map_err(storage_error)?;
            if let Some(parent) = parent {
                let totals = aggregate(&tx, parent)?.merge(aggregate(&tx, id)?)?;
                update_aggregate(&tx, parent, totals)?;
                tx.execute("UPDATE directory_aggregates SET pending_children=pending_children-1 WHERE entry_id=?1", [parent]).map_err(storage_error)?;
            }
            current = parent;
        }
        tx.commit().map_err(storage_error)
    }
    pub fn scan_issues(&self, scan_id: i64, after: i64) -> Result<ScanIssuePage, AppError> {
        self.get_scan(scan_id)?;
        let mut statement = self.connection.prepare("SELECT id,path,code,operation FROM scan_errors WHERE scan_id=?1 AND id>?2 ORDER BY id LIMIT 101").map_err(storage_error)?;
        let rows = statement
            .query_map([scan_id, after], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    ScanIssue {
                        path: row.get(1)?,
                        code: row.get(2)?,
                        operation: row.get(3)?,
                    },
                ))
            })
            .map_err(storage_error)?;
        let mut rows: Vec<_> = rows.collect::<Result<_, _>>().map_err(storage_error)?;
        let next_cursor = if rows.len() > 100 {
            rows.pop();
            rows.last().map(|(id, _)| id.to_string())
        } else {
            None
        };
        Ok(ScanIssuePage {
            items: rows.into_iter().map(|(_, issue)| issue).collect(),
            next_cursor,
        })
    }

    pub fn scan_root(&self, scan_id: i64) -> Result<IndexedEntry, AppError> {
        self.ensure_queryable(scan_id)?;
        self.connection
            .query_row(
                "SELECT e.id,e.parent_id,e.name,e.path,e.kind,e.logical_size,
                 COALESCE(a.logical_size,e.logical_size) FROM entries e
                 LEFT JOIN directory_aggregates a ON a.entry_id=e.id
                 WHERE e.scan_id=?1 AND e.parent_id IS NULL",
                [scan_id],
                read_entry,
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| AppError::new(ErrorCode::ScanNotReady))
    }

    pub fn children(
        &self,
        scan_id: i64,
        directory_id: i64,
        after: i64,
    ) -> Result<EntryPage, AppError> {
        self.ensure_queryable(scan_id)?;
        let mut statement = self
            .connection
            .prepare(
                "SELECT e.id,e.parent_id,e.name,e.path,e.kind,e.logical_size,
             COALESCE(a.logical_size,e.logical_size) FROM entries e
             LEFT JOIN directory_aggregates a ON a.entry_id=e.id
             WHERE e.scan_id=?1 AND e.parent_id=?2 AND e.id>?3 ORDER BY e.id LIMIT 101",
            )
            .map_err(storage_error)?;
        let mut rows = statement
            .query_map(params![scan_id, directory_id, after], read_entry)
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let next_cursor = if rows.len() > 100 {
            rows.pop();
            rows.last().map(|entry| entry.id.clone())
        } else {
            None
        };
        Ok(EntryPage {
            items: rows,
            next_cursor,
        })
    }

    pub fn large_files(&self, scan_id: i64, cursor: Option<&str>) -> Result<EntryPage, AppError> {
        self.ensure_queryable(scan_id)?;
        let (size, id) = parse_large_cursor(cursor)?;
        let mut statement = self.connection.prepare(
            "SELECT e.id,e.parent_id,e.name,e.path,e.kind,e.logical_size,e.logical_size FROM entries e
             WHERE e.scan_id=?1 AND e.kind='file'
             AND (e.logical_size<?2 OR (e.logical_size=?2 AND e.id>?3))
             ORDER BY e.logical_size DESC,e.id LIMIT 101",
        ).map_err(storage_error)?;
        let mut rows = statement
            .query_map(params![scan_id, size, id], read_entry)
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let next_cursor = if rows.len() > 100 {
            rows.pop();
            rows.last()
                .map(|entry| format!("{}:{}", entry.logical_size, entry.id))
        } else {
            None
        };
        Ok(EntryPage {
            items: rows,
            next_cursor,
        })
    }

    pub fn old_files(
        &self,
        scan_id: i64,
        criterion: OldFileCriterion,
        older_than_ms: i64,
        min_size: i64,
        cursor: Option<&str>,
    ) -> Result<OldFilePage, AppError> {
        self.ensure_queryable(scan_id)?;
        let (modified_at_ms, id) = parse_old_files_cursor(cursor)?;
        let column = match criterion {
            OldFileCriterion::Modified => "modified_at_ms",
            OldFileCriterion::Created => "created_at_ms",
            OldFileCriterion::Accessed => "accessed_at_ms",
        };
        let query = format!(
            "SELECT e.id,e.parent_id,e.name,e.path,e.kind,e.logical_size,e.logical_size,e.{column}
             FROM entries e
             WHERE e.scan_id=?1 AND e.kind='file' AND e.{column} IS NOT NULL
             AND e.{column}<?2
             AND e.logical_size>=?3
             AND (e.{column}>?4 OR (e.{column}=?4 AND e.id>?5))
             ORDER BY e.{column},e.id LIMIT 101",
        );
        let mut statement = self.connection.prepare(&query).map_err(storage_error)?;
        let mut rows = statement
            .query_map(
                params![scan_id, older_than_ms, min_size, modified_at_ms, id],
                |row| {
                    Ok(OldFile {
                        entry: read_entry(row)?,
                        timestamp_ms: row.get::<_, i64>(7)?.to_string(),
                    })
                },
            )
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let next_cursor = if rows.len() > 100 {
            rows.pop();
            rows.last()
                .map(|file| format!("{}:{}", file.timestamp_ms, file.entry.id))
        } else {
            None
        };
        Ok(OldFilePage {
            items: rows,
            next_cursor,
        })
    }

    pub fn search(&self, scan_id: i64, text: &str, after: i64) -> Result<EntryPage, AppError> {
        self.ensure_queryable(scan_id)?;
        let mut statement = self
            .connection
            .prepare(
                "SELECT e.id,e.parent_id,e.name,e.path,e.kind,e.logical_size,
             COALESCE(a.logical_size,e.logical_size) FROM entries e
             LEFT JOIN directory_aggregates a ON a.entry_id=e.id
             WHERE e.scan_id=?1 AND e.id>?2 AND instr(lower(e.name),lower(?3))>0
             ORDER BY e.id LIMIT 101",
            )
            .map_err(storage_error)?;
        let mut rows = statement
            .query_map(params![scan_id, after, text], read_entry)
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let next_cursor = if rows.len() > 100 {
            rows.pop();
            rows.last().map(|entry| entry.id.clone())
        } else {
            None
        };
        Ok(EntryPage {
            items: rows,
            next_cursor,
        })
    }

    pub fn entry_path(&self, scan_id: i64, entry_id: i64) -> Result<std::path::PathBuf, AppError> {
        self.ensure_queryable(scan_id)?;
        let path = self
            .connection
            .query_row(
                "SELECT path FROM entries WHERE scan_id=?1 AND id=?2",
                params![scan_id, entry_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))?;
        decode_path(path).map_err(|_| AppError::new(ErrorCode::InvalidSchema))
    }
    pub fn operation_target(
        &self,
        scan_id: i64,
        entry_id: i64,
    ) -> Result<OperationTarget, AppError> {
        self.ensure_queryable(scan_id)?;
        let root: Vec<u8> = self
            .connection
            .query_row(
                "SELECT path FROM entries WHERE scan_id=?1 AND parent_id IS NULL",
                [scan_id],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        let (path, kind, logical_size, identity, modified_at_ms): (Vec<u8>, String, i64, Option<String>, Option<i64>) = self.connection.query_row(
            "SELECT path,kind,logical_size,identity,modified_at_ms FROM entries WHERE scan_id=?1 AND id=?2 AND parent_id IS NOT NULL",
            params![scan_id, entry_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional().map_err(storage_error)?.ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))?;
        let kind = match kind.as_str() {
            "file" => EntryKind::File,
            "directory" => EntryKind::Directory,
            "symlink" => EntryKind::Symlink,
            "other" => EntryKind::Other,
            _ => return Err(internal()),
        };
        Ok(OperationTarget {
            root_path: decode_path(root).map_err(|_| internal())?,
            path: decode_path(path).map_err(|_| internal())?,
            kind,
            logical_size: u64::try_from(logical_size).map_err(|_| internal())?,
            identity,
            modified_at_ms,
        })
    }
    pub fn reconcile_removed_entry(&mut self, scan_id: i64, entry_id: i64) -> Result<(), AppError> {
        self.ensure_queryable(scan_id)?;
        let tx = self.connection.transaction().map_err(storage_error)?;
        let parent: i64 = tx
            .query_row(
                "SELECT parent_id FROM entries WHERE scan_id=?1 AND id=?2",
                params![scan_id, entry_id],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        let mut statement = tx.prepare(
            "WITH RECURSIVE subtree(id,depth) AS (
                 SELECT ?2,0 UNION ALL SELECT e.id,s.depth+1 FROM entries e JOIN subtree s ON e.parent_id=s.id WHERE e.scan_id=?1
             ) SELECT e.id,e.kind,e.logical_size,e.allocated_size,s.depth FROM entries e JOIN subtree s ON e.id=s.id",
        ).map_err(storage_error)?;
        let mut rows = statement
            .query_map(params![scan_id, entry_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        drop(statement);
        if rows.is_empty() {
            return Err(AppError::new(ErrorCode::ScanNotFound));
        }
        let files = rows
            .iter()
            .filter(|(_, kind, _, _, _)| kind == "file")
            .count() as i64;
        let directories = rows
            .iter()
            .filter(|(_, kind, _, _, _)| kind == "directory")
            .count() as i64;
        let symlinks = rows
            .iter()
            .filter(|(_, kind, _, _, _)| kind == "symlink")
            .count() as i64;
        let logical = rows.iter().try_fold(0_i64, |total, (_, _, size, _, _)| {
            total.checked_add(*size).ok_or_else(internal)
        })?;
        let allocated = rows
            .iter()
            .try_fold(Some(0_i64), |total, (_, _, _, size, _)| {
                match (total, size) {
                    (Some(total), Some(size)) => {
                        total.checked_add(*size).ok_or_else(internal).map(Some)
                    }
                    _ => Ok(None),
                }
            })?;
        let ids: Vec<i64> = rows.iter().map(|(id, _, _, _, _)| *id).collect();
        for id in &ids {
            tx.execute("DELETE FROM directory_queue WHERE entry_id=?1", [id])
                .map_err(storage_error)?;
            tx.execute("DELETE FROM directory_aggregates WHERE entry_id=?1", [id])
                .map_err(storage_error)?;
        }
        let mut ancestor = Some(parent);
        while let Some(id) = ancestor {
            tx.execute(
                "UPDATE directory_aggregates SET files_count=files_count-?2,directories_count=directories_count-?3,logical_size=logical_size-?4,allocated_size=CASE WHEN allocated_size IS NULL OR ?5 IS NULL THEN NULL ELSE allocated_size-?5 END WHERE entry_id=?1",
                params![id, files, directories, logical, allocated],
            ).map_err(storage_error)?;
            ancestor = tx
                .query_row("SELECT parent_id FROM entries WHERE id=?1", [id], |row| {
                    row.get::<_, Option<i64>>(0)
                })
                .optional()
                .map_err(storage_error)?
                .flatten();
        }
        rows.sort_by_key(|(_, _, _, _, depth)| std::cmp::Reverse(*depth));
        for (id, _, _, _, _) in rows {
            tx.execute("DELETE FROM entries WHERE id=?1", [id])
                .map_err(storage_error)?;
        }
        tx.execute(
            "UPDATE scan_sessions SET files_count=files_count-?2,directories_count=directories_count-?3,symlinks_count=symlinks_count-?4,logical_size=logical_size-?5,allocated_size=CASE WHEN allocated_size IS NULL OR ?6 IS NULL THEN NULL ELSE allocated_size-?6 END WHERE id=?1",
            params![scan_id, files, directories, symlinks, logical, allocated],
        ).map_err(storage_error)?;
        tx.commit().map_err(storage_error)
    }
    pub fn duplicate_candidates(
        &self,
        after_size: Option<i64>,
    ) -> Result<DuplicateGroupPage, AppError> {
        let Some(scan) = self.latest_queryable_scan()? else {
            return Ok(DuplicateGroupPage {
                items: vec![],
                next_cursor: None,
            });
        };
        let after = after_size.unwrap_or(i64::MAX);
        let mut statement = self.connection.prepare("SELECT logical_size,COUNT(*) FROM entries WHERE scan_id=?1 AND kind='file' AND logical_size<?2 GROUP BY logical_size HAVING COUNT(*)>1 ORDER BY logical_size DESC LIMIT 51").map_err(storage_error)?;
        let mut rows = statement
            .query_map(params![scan.id, after], |row| {
                let size: i64 = row.get(0)?;
                let count: i64 = row.get(1)?;
                let reclaimable = size
                    .checked_mul(count.saturating_sub(1))
                    .ok_or(rusqlite::Error::IntegralValueOutOfRange(0, i64::MAX))?;
                Ok(DuplicateGroup {
                    size: size.to_string(),
                    files_count: count.to_string(),
                    reclaimable_size: reclaimable.to_string(),
                })
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let next_cursor = if rows.len() > 50 {
            rows.pop();
            rows.last().map(|group| group.size.clone())
        } else {
            None
        };
        Ok(DuplicateGroupPage {
            items: rows,
            next_cursor,
        })
    }
    pub fn duplicate_hash_candidates(&self) -> Result<(i64, Vec<HashCandidate>), AppError> {
        let scan = self
            .latest_queryable_scan()?
            .ok_or_else(|| AppError::new(ErrorCode::ScanNotReady))?;
        let mut statement = self.connection.prepare(
            "SELECT e.id,e.path,e.logical_size,e.identity,e.modified_at_ms FROM entries e
             WHERE e.scan_id=?1 AND e.kind='file' AND e.logical_size IN (
               SELECT logical_size FROM entries WHERE scan_id=?1 AND kind='file' GROUP BY logical_size HAVING COUNT(*)>1
             ) ORDER BY e.logical_size,e.id",
        ).map_err(storage_error)?;
        let items = statement
            .query_map([parse_id(&scan.id)?], |row| {
                let size: i64 = row.get(2)?;
                Ok(HashCandidate {
                    id: row.get(0)?,
                    path: decode_path(row.get(1)?).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Blob,
                            Box::new(error),
                        )
                    })?,
                    size: u64::try_from(size)
                        .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(2, size))?,
                    identity: row.get(3)?,
                    modified_at_ms: row.get(4)?,
                })
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        Ok((parse_id(&scan.id)?, items))
    }
    pub fn record_content_hash(
        &mut self,
        scan_id: i64,
        entry_id: i64,
        hash: &str,
    ) -> Result<(), AppError> {
        self.connection
            .execute(
                "UPDATE entries SET content_hash=?3 WHERE scan_id=?1 AND id=?2",
                params![scan_id, entry_id, hash],
            )
            .map_err(storage_error)?;
        Ok(())
    }
    pub fn confirmed_duplicates(
        &self,
        after_size: Option<i64>,
    ) -> Result<DuplicateGroupPage, AppError> {
        let Some(scan) = self.latest_queryable_scan()? else {
            return Ok(DuplicateGroupPage {
                items: vec![],
                next_cursor: None,
            });
        };
        let after = after_size.unwrap_or(i64::MAX);
        let mut statement = self.connection.prepare("SELECT logical_size,COUNT(*) FROM entries WHERE scan_id=?1 AND kind='file' AND content_hash IS NOT NULL AND logical_size<?2 GROUP BY logical_size,content_hash HAVING COUNT(*)>1 ORDER BY logical_size DESC,content_hash LIMIT 51").map_err(storage_error)?;
        let mut rows = statement
            .query_map(params![scan.id, after], |row| {
                let size: i64 = row.get(0)?;
                let count: i64 = row.get(1)?;
                Ok(DuplicateGroup {
                    size: size.to_string(),
                    files_count: count.to_string(),
                    reclaimable_size: size
                        .checked_mul(count.saturating_sub(1))
                        .ok_or(rusqlite::Error::IntegralValueOutOfRange(0, i64::MAX))?
                        .to_string(),
                })
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let next_cursor = if rows.len() > 50 {
            rows.pop();
            rows.last().map(|group| group.size.clone())
        } else {
            None
        };
        Ok(DuplicateGroupPage {
            items: rows,
            next_cursor,
        })
    }
}
