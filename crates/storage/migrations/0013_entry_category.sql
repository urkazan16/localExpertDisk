ALTER TABLE entries ADD COLUMN category TEXT GENERATED ALWAYS AS (
  CASE
    WHEN lower(name) GLOB '*.mp4' OR lower(name) GLOB '*.mkv' OR lower(name) GLOB '*.mov' OR lower(name) GLOB '*.avi' OR lower(name) GLOB '*.webm' THEN 'video'
    WHEN lower(name) GLOB '*.jpg' OR lower(name) GLOB '*.jpeg' OR lower(name) GLOB '*.png' OR lower(name) GLOB '*.gif' OR lower(name) GLOB '*.heic' OR lower(name) GLOB '*.webp' THEN 'images'
    WHEN lower(name) GLOB '*.mp3' OR lower(name) GLOB '*.m4a' OR lower(name) GLOB '*.wav' OR lower(name) GLOB '*.flac' OR lower(name) GLOB '*.aac' THEN 'audio'
    WHEN lower(name) GLOB '*.pdf' OR lower(name) GLOB '*.doc' OR lower(name) GLOB '*.docx' OR lower(name) GLOB '*.xls' OR lower(name) GLOB '*.xlsx' OR lower(name) GLOB '*.pptx' OR lower(name) GLOB '*.txt' THEN 'documents'
    WHEN lower(name) GLOB '*.zip' OR lower(name) GLOB '*.tar' OR lower(name) GLOB '*.gz' OR lower(name) GLOB '*.7z' OR lower(name) GLOB '*.rar' THEN 'archives'
    WHEN lower(name) GLOB '*.app' OR lower(name) GLOB '*.exe' OR lower(name) GLOB '*.dmg' THEN 'applications'
    WHEN lower(name) GLOB '*.rs' OR lower(name) GLOB '*.ts' OR lower(name) GLOB '*.tsx' OR lower(name) GLOB '*.js' OR lower(name) GLOB '*.py' OR lower(name) GLOB '*.java' THEN 'development'
    WHEN lower(name) GLOB '*.iso' OR lower(name) GLOB '*.img' THEN 'disk_images'
    WHEN lower(name) GLOB '*.sqlite' OR lower(name) GLOB '*.db' OR lower(name) GLOB '*.sql' THEN 'databases'
    ELSE 'other'
  END
) VIRTUAL;

CREATE INDEX entries_category_page
ON entries(scan_id, category, id)
WHERE kind = 'file';
