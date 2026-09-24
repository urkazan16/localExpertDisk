CREATE TABLE scan_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_path BLOB NOT NULL,
    root_display TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('created','preparing','scanning','finalizing','completed','partial','cancelling','cancelled','failed','interrupted')),
    files_count INTEGER NOT NULL DEFAULT 0 CHECK(files_count >= 0),
    directories_count INTEGER NOT NULL DEFAULT 0 CHECK(directories_count >= 0),
    symlinks_count INTEGER NOT NULL DEFAULT 0 CHECK(symlinks_count >= 0),
    skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0),
    logical_size INTEGER NOT NULL DEFAULT 0 CHECK(logical_size >= 0),
    errors_count INTEGER NOT NULL DEFAULT 0 CHECK(errors_count >= 0),
    started_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER,
    failure TEXT
) STRICT;
CREATE UNIQUE INDEX one_active_scan ON scan_sessions((1)) WHERE finished_at_ms IS NULL;
CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id INTEGER NOT NULL REFERENCES scan_sessions(id),
    parent_id INTEGER,
    path BLOB NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('file','directory','symlink','other')),
    logical_size INTEGER NOT NULL CHECK(logical_size >= 0),
    identity TEXT,
    UNIQUE(scan_id, id),
    FOREIGN KEY(scan_id, parent_id) REFERENCES entries(scan_id, id)
) STRICT;
CREATE INDEX entries_parent ON entries(scan_id, parent_id);
CREATE TABLE directory_queue (
    entry_id INTEGER PRIMARY KEY REFERENCES entries(id)
) STRICT;
CREATE TABLE directory_aggregates (
    entry_id INTEGER PRIMARY KEY REFERENCES entries(id),
    files_count INTEGER NOT NULL DEFAULT 0,
    directories_count INTEGER NOT NULL DEFAULT 0,
    logical_size INTEGER NOT NULL DEFAULT 0,
    pending_children INTEGER NOT NULL DEFAULT 0 CHECK(pending_children >= 0),
    enumerated INTEGER NOT NULL DEFAULT 0 CHECK(enumerated IN (0,1)),
    finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1))
) STRICT;
CREATE TABLE scan_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id INTEGER NOT NULL REFERENCES scan_sessions(id),
    path TEXT NOT NULL,
    code TEXT NOT NULL,
    operation TEXT NOT NULL
) STRICT;
CREATE INDEX scan_errors_page ON scan_errors(scan_id, id);
