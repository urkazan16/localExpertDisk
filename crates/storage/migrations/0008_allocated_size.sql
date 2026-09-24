ALTER TABLE scan_sessions ADD COLUMN allocated_size INTEGER CHECK(allocated_size >= 0);
