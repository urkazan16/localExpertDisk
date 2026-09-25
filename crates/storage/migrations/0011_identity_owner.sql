ALTER TABLE scan_file_identities
ADD COLUMN owner_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL;

CREATE TABLE identity_owner_backfill (
    scan_id INTEGER NOT NULL,
    identity TEXT NOT NULL,
    owner_entry_id INTEGER NOT NULL,
    PRIMARY KEY (scan_id, identity)
) STRICT;

INSERT INTO identity_owner_backfill(scan_id, identity, owner_entry_id)
SELECT scan_id, identity, MIN(id)
FROM entries
WHERE kind = 'file' AND identity IS NOT NULL
GROUP BY scan_id, identity;

UPDATE scan_file_identities
SET owner_entry_id = (
    SELECT owner_entry_id
    FROM identity_owner_backfill owners
    WHERE owners.scan_id = scan_file_identities.scan_id
      AND owners.identity = scan_file_identities.identity
);

DROP TABLE identity_owner_backfill;
