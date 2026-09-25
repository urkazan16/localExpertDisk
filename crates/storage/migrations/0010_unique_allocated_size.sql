ALTER TABLE scan_sessions ADD COLUMN unique_allocated_size INTEGER CHECK(unique_allocated_size >= 0);
CREATE TABLE scan_file_identities (
    scan_id INTEGER NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
    identity TEXT NOT NULL,
    allocated_size INTEGER NOT NULL CHECK(allocated_size >= 0),
    PRIMARY KEY(scan_id, identity)
) STRICT;
