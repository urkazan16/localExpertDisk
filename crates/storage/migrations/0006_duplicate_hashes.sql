ALTER TABLE entries ADD COLUMN content_hash TEXT;
CREATE INDEX entries_confirmed_duplicates ON entries(scan_id, content_hash) WHERE content_hash IS NOT NULL;
