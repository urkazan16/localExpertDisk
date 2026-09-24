CREATE INDEX entries_scan_identity ON entries(scan_id, identity) WHERE identity IS NOT NULL;
