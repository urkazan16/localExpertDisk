CREATE INDEX entries_children_page ON entries(scan_id, parent_id, id);
CREATE INDEX entries_large_files_page ON entries(scan_id, logical_size DESC, id) WHERE kind = 'file';
CREATE INDEX entries_search_page ON entries(scan_id, id, name);
