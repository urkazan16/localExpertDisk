ALTER TABLE entries ADD COLUMN allocated_size INTEGER CHECK(allocated_size >= 0);
ALTER TABLE directory_aggregates ADD COLUMN allocated_size INTEGER CHECK(allocated_size >= 0);
