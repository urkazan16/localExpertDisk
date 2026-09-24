ALTER TABLE entries ADD COLUMN modified_at_ms INTEGER;
CREATE INDEX entries_old_files_page ON entries(scan_id, modified_at_ms, id) WHERE kind = 'file';
