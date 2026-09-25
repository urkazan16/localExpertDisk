CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
) STRICT;

INSERT INTO app_settings(key, value) VALUES ('scan_retention_keep_latest', 10);

ALTER TABLE entries ADD COLUMN hash_metadata_signature TEXT;
