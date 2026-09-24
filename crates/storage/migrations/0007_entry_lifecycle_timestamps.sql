ALTER TABLE entries ADD COLUMN created_at_ms INTEGER;
ALTER TABLE entries ADD COLUMN accessed_at_ms INTEGER;
CREATE INDEX entries_old_files_created_page ON entries(scan_id, created_at_ms, id) WHERE kind = 'file';
CREATE INDEX entries_old_files_accessed_page ON entries(scan_id, accessed_at_ms, id) WHERE kind = 'file';
