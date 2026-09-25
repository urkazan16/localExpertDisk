use super::*;
use domain::DirectoryMapRemainder;
use filesystem::{
    native::{DirectoryEntries, EntryMetadata},
    operations::TrashProvider,
};
use rusqlite::Connection;
use std::{fs, io, sync::mpsc};

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    db: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("input");
        let state = temp.path().join("state");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&state).unwrap();
        Self {
            root,
            db: state.join("test.db"),
            _temp: temp,
        }
    }
    fn service(&self) -> ScanService {
        ScanService::open(&self.db).unwrap()
    }
    fn request(&self) -> StartScanRequest {
        StartScanRequest {
            root_path: self.root.to_str().unwrap().into(),
        }
    }
}
fn wait_terminal(receiver: &mpsc::Receiver<ScanSession>) -> ScanSession {
    loop {
        let update = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("scan must terminate");
        if update.state.is_terminal() {
            return update;
        }
    }
}
fn run_fixture(fixture: &Fixture, fs: Arc<dyn FileSystemProvider>) -> ScanSession {
    let service = fixture.service();
    let (tx, rx) = mpsc::channel();
    service
        .start_with(fixture.request(), fs, move |update| tx.send(update).is_ok())
        .unwrap();
    let result = wait_terminal(&rx);
    service.shutdown().unwrap();
    result
}

#[test]
fn nested_tree_counts_sizes_parent_relations_and_aggregates_survive_restart() {
    let f = Fixture::new();
    fs::create_dir_all(f.root.join("a/b")).unwrap();
    fs::create_dir(f.root.join("empty")).unwrap();
    fs::write(f.root.join("a/one.bin"), [0; 10]).unwrap();
    fs::write(f.root.join("a/b/два.bin"), [0; 20]).unwrap();
    fs::write(f.root.join("zero.bin"), []).unwrap();
    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    assert_eq!(result.state, ScanState::Completed);
    assert_eq!(result.allocated_size.is_some(), cfg!(unix));
    assert_eq!(
        (
            &result.files_count,
            &result.directories_count,
            &result.logical_size
        ),
        (&"3".into(), &"4".into(), &"30".into())
    );
    let connection = Connection::open(&f.db).unwrap();
    let aggregate: (i64,i64,i64) = connection.query_row("SELECT a.files_count,a.directories_count,a.logical_size FROM directory_aggregates a JOIN entries e ON e.id=a.entry_id WHERE e.parent_id IS NULL",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
    assert_eq!(aggregate, (3, 3, 30));
    let root_allocated: Option<i64> = connection
        .query_row(
            "SELECT a.allocated_size FROM directory_aggregates a JOIN entries e ON e.id=a.entry_id WHERE e.parent_id IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        root_allocated.map(|value| value.to_string()),
        result.allocated_size
    );
    let parent: String = connection.query_row("SELECT p.name FROM entries child JOIN entries p ON p.id=child.parent_id WHERE child.name='два.bin'",[],|row|row.get(0)).unwrap();
    assert_eq!(parent, "b");
    assert_eq!(
        connection
            .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    let reopened = f.service();
    assert_eq!(
        reopened.get_scan(Some(&result.id)).unwrap().unwrap(),
        result
    );
    let (tx, rx) = mpsc::channel();
    let second = reopened
        .start(f.request(), move |s| tx.send(s).is_ok())
        .unwrap();
    assert_ne!(second.id, result.id);
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);
    reopened.shutdown().unwrap();
}

#[test]
fn completed_scan_exposes_bounded_folder_large_file_and_search_pages() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("nested")).unwrap();
    fs::write(f.root.join("small.txt"), [0; 2]).unwrap();
    fs::write(f.root.join("nested/large.log"), [0; 20]).unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);

    let root = service.root(&session.id).unwrap();
    assert_eq!(root.aggregate_size, "22");
    let children = service.children(&session.id, &root.id, None).unwrap();
    assert_eq!(children.items.len(), 2);
    let nested = children
        .items
        .iter()
        .find(|entry| entry.name == "nested")
        .unwrap();
    assert_eq!(nested.aggregate_size, "20");
    assert_eq!(
        service
            .children(&session.id, &nested.id, None)
            .unwrap()
            .items[0]
            .name,
        "large.log"
    );
    assert_eq!(
        service.large_files(&session.id, None).unwrap().items[0].name,
        "large.log"
    );
    assert_eq!(
        service.search(&session.id, "small", None).unwrap().items[0].name,
        "small.txt"
    );
    let old_files = service
        .old_files(
            &session.id,
            OldFileCriterion::Modified,
            &i64::MAX.to_string(),
            None,
            None,
        )
        .unwrap();
    assert_eq!(old_files.items.len(), 2);
    assert!(old_files
        .items
        .iter()
        .all(|file| !file.timestamp_ms.is_empty()));
    service.shutdown().unwrap();
}

#[test]
fn directory_map_returns_ranked_multilevel_nodes_and_exact_remainder() {
    let f = Fixture::new();
    fs::create_dir_all(f.root.join("large/nested")).unwrap();
    fs::write(f.root.join("large/nested/deep.bin"), [0; 50]).unwrap();
    fs::write(f.root.join("medium.bin"), [0; 30]).unwrap();
    fs::write(f.root.join("small.bin"), [0; 20]).unwrap();
    fs::write(f.root.join("tiny.bin"), [0; 10]).unwrap();
    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    let service = f.service();
    let root = service.root(&result.id).unwrap();
    let map = service
        .directory_map(&result.id, &root.id, DirectoryMapMetric::Logical, 3, 2)
        .unwrap();

    assert_eq!(map.root.size, "110");
    assert_eq!(map.root.children.len(), 2);
    assert_eq!(map.root.children[0].entry.name, "large");
    assert_eq!(map.root.children[0].children[0].entry.name, "nested");
    assert_eq!(
        map.root.children[0].children[0].children[0].entry.name,
        "deep.bin"
    );
    assert_eq!(
        map.root.remainder,
        Some(DirectoryMapRemainder {
            objects_count: "2".into(),
            size: "30".into(),
        })
    );
    assert_eq!(
        service
            .directory_map(&result.id, &root.id, DirectoryMapMetric::Logical, 4, 2)
            .unwrap_err()
            .code,
        ErrorCode::InvalidTarget
    );
    service.shutdown().unwrap();
}

#[test]
fn wide_directory_map_is_independent_from_the_explorer_page_limit() {
    let f = Fixture::new();
    for index in 0..250 {
        fs::write(f.root.join(format!("file-{index:03}.bin")), [0]).unwrap();
    }
    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    let service = f.service();
    let root = service.root(&result.id).unwrap();
    assert_eq!(
        service
            .children(&result.id, &root.id, None)
            .unwrap()
            .items
            .len(),
        100
    );
    let map = service
        .directory_map(&result.id, &root.id, DirectoryMapMetric::Logical, 1, 8)
        .unwrap();
    assert_eq!(map.root.children.len(), 8);
    assert_eq!(
        map.root.remainder,
        Some(DirectoryMapRemainder {
            objects_count: "242".into(),
            size: "242".into(),
        })
    );
    service.shutdown().unwrap();
}

#[cfg(unix)]
#[test]
fn unique_allocated_directory_map_assigns_a_hardlink_to_one_branch() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("a")).unwrap();
    fs::create_dir(f.root.join("b")).unwrap();
    let original = f.root.join("a/original.bin");
    fs::write(&original, [0; 64]).unwrap();
    fs::hard_link(&original, f.root.join("b/link.bin")).unwrap();
    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    let service = f.service();
    let root = service.root(&result.id).unwrap();
    let map = service
        .directory_map(
            &result.id,
            &root.id,
            DirectoryMapMetric::UniqueAllocated,
            2,
            8,
        )
        .unwrap();
    let sizes = map
        .root
        .children
        .iter()
        .map(|node| node.size.parse::<u64>().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(sizes.iter().sum::<u64>().to_string(), map.root.size);
    assert_eq!(map.root.size, result.unique_allocated_size.unwrap());
    assert_eq!(sizes.iter().filter(|size| **size > 0).count(), 1);
    service.shutdown().unwrap();
}

#[test]
fn categories_are_aggregated_from_indexed_files() {
    let f = Fixture::new();
    fs::write(f.root.join("photo.JPG"), [0; 7]).unwrap();
    fs::write(f.root.join("notes.txt"), [0; 3]).unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);
    let categories = service.categories(&session.id).unwrap();
    assert!(categories
        .iter()
        .any(|item| item.category == domain::FileCategory::Images && item.logical_size == "7"));
    assert!(categories
        .iter()
        .any(|item| item.category == domain::FileCategory::Documents && item.logical_size == "3"));
    let filtered = service
        .filtered_large_files(
            &session.id,
            "5",
            Some(domain::FileCategory::Images),
            domain::FileSort::SizeDesc,
            None,
        )
        .unwrap();
    assert_eq!(filtered.items.len(), 1);
    assert_eq!(filtered.items[0].name, "photo.JPG");
    service.shutdown().unwrap();
}

#[test]
fn filtered_large_files_are_keyset_paginated_for_every_sort() {
    let f = Fixture::new();
    for index in 0..205 {
        fs::write(
            f.root.join(format!("file-{index:03}.bin")),
            vec![0; index % 17],
        )
        .unwrap();
    }
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);

    for sort in [
        domain::FileSort::SizeDesc,
        domain::FileSort::ModifiedDesc,
        domain::FileSort::NameAsc,
    ] {
        let mut cursor = None;
        let mut ids = std::collections::HashSet::new();
        loop {
            let page = service
                .filtered_large_files(&session.id, "0", None, sort, cursor.as_deref())
                .unwrap();
            assert!(page.items.len() <= 100);
            for entry in page.items {
                assert!(ids.insert(entry.id));
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(ids.len(), 205);
    }

    assert_eq!(
        service
            .filtered_large_files(
                &session.id,
                "0",
                None,
                domain::FileSort::NameAsc,
                Some("invalid"),
            )
            .unwrap_err()
            .code,
        ErrorCode::ScanNotFound
    );
    service.shutdown().unwrap();
}

#[test]
fn old_files_are_keyset_paginated_and_reject_invalid_cutoffs() {
    let f = Fixture::new();
    for index in 0..101 {
        fs::write(f.root.join(format!("old-{index:03}")), b"x").unwrap();
    }
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);
    let first = service
        .old_files(
            &session.id,
            OldFileCriterion::Modified,
            &i64::MAX.to_string(),
            None,
            None,
        )
        .unwrap();
    assert_eq!(first.items.len(), 100);
    let second = service
        .old_files(
            &session.id,
            OldFileCriterion::Modified,
            &i64::MAX.to_string(),
            None,
            first.next_cursor.as_deref(),
        )
        .unwrap();
    assert_eq!(second.items.len(), 1);
    assert_ne!(
        first.items.last().unwrap().entry.id,
        second.items[0].entry.id
    );
    assert_eq!(
        service
            .old_files(&session.id, OldFileCriterion::Modified, "-1", None, None)
            .unwrap_err()
            .code,
        ErrorCode::InvalidTarget
    );
    service.shutdown().unwrap();
}

#[test]
fn old_files_filter_by_selected_timestamp_and_minimum_size() {
    let f = Fixture::new();
    fs::write(f.root.join("small.bin"), [0; 2]).unwrap();
    fs::write(f.root.join("large.bin"), [0; 20]).unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);

    let connection = Connection::open(&f.db).unwrap();
    connection
        .execute(
            "UPDATE entries SET created_at_ms=100,accessed_at_ms=200 WHERE scan_id=?1 AND kind='file'",
            [session.id.parse::<i64>().unwrap()],
        )
        .unwrap();
    drop(connection);

    let created = service
        .old_files(
            &session.id,
            OldFileCriterion::Created,
            "101",
            Some("10"),
            None,
        )
        .unwrap();
    assert_eq!(created.items.len(), 1);
    assert_eq!(created.items[0].entry.name, "large.bin");
    assert_eq!(created.items[0].timestamp_ms, "100");

    let accessed = service
        .old_files(&session.id, OldFileCriterion::Accessed, "201", None, None)
        .unwrap();
    assert_eq!(accessed.items.len(), 2);
    assert!(accessed.items.iter().all(|file| file.timestamp_ms == "200"));
    assert_eq!(
        service
            .old_files(
                &session.id,
                OldFileCriterion::Modified,
                "101",
                Some("-1"),
                None,
            )
            .unwrap_err()
            .code,
        ErrorCode::InvalidTarget
    );
    service.shutdown().unwrap();
}

#[test]
fn explorer_waits_for_a_terminal_scan() {
    let f = Fixture::new();
    let service = f.service();
    let session = {
        let mut storage = SqliteStorage::open(&f.db).unwrap();
        storage.create_scan(&f.root).unwrap()
    };
    assert_eq!(
        service.root(&session.id).unwrap_err().code,
        ErrorCode::ScanNotReady
    );
    service.shutdown().unwrap();
}

struct RecordingLauncher {
    calls: Mutex<Vec<(PathBuf, bool)>>,
}

struct RecordingTrash {
    paths: Mutex<Vec<PathBuf>>,
}
impl TrashProvider for RecordingTrash {
    fn move_to_trash(&self, path: &Path) -> Result<(), AppError> {
        self.paths.lock().unwrap().push(path.to_owned());
        Ok(())
    }
}

struct SelectiveTrash {
    rejected_name: &'static str,
    paths: Mutex<Vec<PathBuf>>,
}
impl TrashProvider for SelectiveTrash {
    fn move_to_trash(&self, path: &Path) -> Result<(), AppError> {
        self.paths.lock().unwrap().push(path.to_owned());
        if path
            .file_name()
            .is_some_and(|name| name == self.rejected_name)
        {
            Err(AppError::new(ErrorCode::PermissionDenied))
        } else {
            Ok(())
        }
    }
}

struct MetadataDeniedFileSystem {
    denied: PathBuf,
}
impl FileSystemProvider for MetadataDeniedFileSystem {
    fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
        if path == self.denied {
            Err(io::ErrorKind::PermissionDenied.into())
        } else {
            NativeFileSystem.metadata(path)
        }
    }

    fn read_directory(&self, path: &Path) -> io::Result<DirectoryEntries> {
        NativeFileSystem.read_directory(path)
    }
}
impl EntryLauncher for RecordingLauncher {
    fn launch(&self, path: &Path, reveal: bool) -> Result<(), AppError> {
        self.calls.lock().unwrap().push((path.to_owned(), reveal));
        Ok(())
    }
}

#[test]
fn system_actions_use_only_indexed_existing_entries() {
    let f = Fixture::new();
    let file = f.root.join("open-me.txt");
    fs::write(&file, b"safe").unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    wait_terminal(&rx);
    let root = service.root(&session.id).unwrap();
    let entry = service
        .children(&session.id, &root.id, None)
        .unwrap()
        .items
        .remove(0);
    let launcher = RecordingLauncher {
        calls: Mutex::new(vec![]),
    };
    service
        .launch_entry_with(&session.id, &entry.id, true, &launcher)
        .unwrap();
    assert_eq!(
        launcher.calls.lock().unwrap().as_slice(),
        &[(file.canonicalize().unwrap(), true)]
    );
    fs::remove_file(f.root.join("open-me.txt")).unwrap();
    assert_eq!(
        service
            .launch_entry_with(&session.id, &entry.id, false, &launcher)
            .unwrap_err()
            .code,
        ErrorCode::InvalidTarget
    );
    service.shutdown().unwrap();
}

#[test]
fn trash_rechecks_metadata_and_reconciles_the_index() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("folder")).unwrap();
    fs::write(f.root.join("folder/child"), [0; 5]).unwrap();
    fs::write(f.root.join("keep"), [0; 2]).unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);
    let root = service.root(&session.id).unwrap();
    let folder = service
        .children(&session.id, &root.id, None)
        .unwrap()
        .items
        .into_iter()
        .find(|entry| entry.name == "folder")
        .unwrap();
    let trash = RecordingTrash {
        paths: Mutex::new(vec![]),
    };
    service
        .move_to_trash_with(&session.id, &folder.id, &trash, &NativeFileSystem)
        .unwrap();
    assert_eq!(
        trash.paths.lock().unwrap().as_slice(),
        &[f.root.join("folder").canonicalize().unwrap()]
    );
    let remaining = service.children(&session.id, &root.id, None).unwrap();
    assert_eq!(remaining.items.len(), 1);
    assert_eq!(remaining.items[0].name, "keep");
    assert_eq!(
        service
            .get_scan(Some(&session.id))
            .unwrap()
            .unwrap()
            .logical_size,
        "2"
    );
    assert_eq!(
        service
            .get_scan(Some(&session.id))
            .unwrap()
            .unwrap()
            .directories_count,
        "1"
    );
    service.shutdown().unwrap();
}

#[test]
fn trash_refuses_changed_and_protected_entries() {
    let f = Fixture::new();
    let file = f.root.join("changed");
    fs::write(&file, [0; 2]).unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    wait_terminal(&rx);
    let root = service.root(&session.id).unwrap();
    let entry = service
        .children(&session.id, &root.id, None)
        .unwrap()
        .items
        .remove(0);
    fs::write(&file, [0; 3]).unwrap();
    let trash = RecordingTrash {
        paths: Mutex::new(vec![]),
    };
    assert_eq!(
        service
            .move_to_trash_with(&session.id, &entry.id, &trash, &NativeFileSystem)
            .unwrap_err()
            .code,
        ErrorCode::EntryChanged
    );
    assert_eq!(
        ProtectedPathPolicy::allows(
            &f.root,
            &f.root,
            &f.db.parent().unwrap().canonicalize().unwrap()
        )
        .unwrap_err()
        .code,
        ErrorCode::ProtectedPath
    );
    assert!(trash.paths.lock().unwrap().is_empty());
    service.shutdown().unwrap();
}

#[test]
fn trash_refuses_disappeared_and_permission_denied_entries_without_calling_provider() {
    let f = Fixture::new();
    let disappeared = f.root.join("disappeared");
    let denied = f.root.join("denied");
    fs::write(&disappeared, b"gone").unwrap();
    fs::write(&denied, b"private").unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    wait_terminal(&rx);
    let root = service.root(&session.id).unwrap();
    let entries = service.children(&session.id, &root.id, None).unwrap().items;
    let disappeared_id = entries
        .iter()
        .find(|entry| entry.name == "disappeared")
        .unwrap()
        .id
        .clone();
    let denied_id = entries
        .iter()
        .find(|entry| entry.name == "denied")
        .unwrap()
        .id
        .clone();
    fs::remove_file(&disappeared).unwrap();
    let trash = RecordingTrash {
        paths: Mutex::new(vec![]),
    };

    assert_eq!(
        service
            .move_to_trash_with(&session.id, &disappeared_id, &trash, &NativeFileSystem,)
            .unwrap_err()
            .code,
        ErrorCode::EntryChanged
    );
    assert_eq!(
        service
            .move_to_trash_with(
                &session.id,
                &denied_id,
                &trash,
                &MetadataDeniedFileSystem {
                    denied: denied.canonicalize().unwrap(),
                },
            )
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert!(trash.paths.lock().unwrap().is_empty());
    service.shutdown().unwrap();
}

#[test]
fn protected_path_policy_is_platform_specific_and_covers_mounts_and_app_data() {
    let no_mounts = Vec::new();
    assert_eq!(
        ProtectedPathPolicy::allows_with(
            ProtectedPlatform::Macos,
            Path::new("/"),
            Path::new("/System/Library/kernel"),
            Path::new("/Users/me/Library/Application Support/App"),
            &no_mounts,
            &ProtectedPathPolicy::system_paths(ProtectedPlatform::Macos),
        )
        .unwrap_err()
        .code,
        ErrorCode::ProtectedPath
    );
    assert_eq!(
        ProtectedPathPolicy::allows_with(
            ProtectedPlatform::Linux,
            Path::new("/"),
            Path::new("/etc/passwd"),
            Path::new("/home/me/.local/share/app"),
            &no_mounts,
            &ProtectedPathPolicy::system_paths(ProtectedPlatform::Linux),
        )
        .unwrap_err()
        .code,
        ErrorCode::ProtectedPath
    );
    assert_eq!(
        ProtectedPathPolicy::allows_with(
            ProtectedPlatform::Windows,
            Path::new(r"c:\"),
            Path::new(r"C:\WINDOWS\System32"),
            Path::new(r"C:\Users\me\AppData\Local\App"),
            &no_mounts,
            &ProtectedPathPolicy::system_paths(ProtectedPlatform::Windows),
        )
        .unwrap_err()
        .code,
        ErrorCode::ProtectedPath
    );
    assert_eq!(
        ProtectedPathPolicy::allows_with(
            ProtectedPlatform::Macos,
            Path::new("/"),
            Path::new("/Volumes/External"),
            Path::new("/Users/me/Library/Application Support/App"),
            &[PathBuf::from("/Volumes/External")],
            &[],
        )
        .unwrap_err()
        .code,
        ErrorCode::ProtectedPath
    );
    assert_eq!(
        ProtectedPathPolicy::allows_with(
            ProtectedPlatform::Linux,
            Path::new("/home/me"),
            Path::new("/home/me/.local/share"),
            Path::new("/home/me/.local/share/app/state"),
            &no_mounts,
            &[],
        )
        .unwrap_err()
        .code,
        ErrorCode::ProtectedPath
    );
    assert!(ProtectedPathPolicy::allows_with(
        ProtectedPlatform::Linux,
        Path::new("/home/me"),
        Path::new("/home/me/Downloads/file"),
        Path::new("/home/me/.local/share/app"),
        &no_mounts,
        &ProtectedPathPolicy::system_paths(ProtectedPlatform::Linux),
    )
    .is_ok());
}

#[test]
fn batch_trash_reports_partial_failure_and_reconciles_only_successes() {
    let f = Fixture::new();
    fs::write(f.root.join("accepted"), b"one").unwrap();
    fs::write(f.root.join("rejected"), b"two").unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    let session = service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    wait_terminal(&rx);
    let root = service.root(&session.id).unwrap();
    let entries = service.children(&session.id, &root.id, None).unwrap().items;
    let ids = entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    let trash = SelectiveTrash {
        rejected_name: "rejected",
        paths: Mutex::new(vec![]),
    };

    let result = service
        .move_entries_to_trash_with(&session.id, &ids, &trash, &NativeFileSystem)
        .unwrap();
    assert_eq!(result.moved_entry_ids.len(), 1);
    assert_eq!(result.failed_entry_ids.len(), 1);
    let remaining = service.children(&session.id, &root.id, None).unwrap();
    assert_eq!(remaining.items.len(), 1);
    assert_eq!(remaining.items[0].name, "rejected");
    assert_eq!(
        service
            .get_scan(Some(&session.id))
            .unwrap()
            .unwrap()
            .logical_size,
        "3"
    );
    assert_eq!(trash.paths.lock().unwrap().len(), 2);
    service.shutdown().unwrap();
}

#[test]
fn batch_trash_rejects_duplicate_entry_ids_before_touching_the_file_system() {
    let f = Fixture::new();
    let service = f.service();
    let error = service
        .move_entries_to_trash("1", &["10".into(), "10".into()])
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidTarget);
    service.shutdown().unwrap();
}

#[test]
fn history_compares_persisted_scans_and_duplicate_candidates_are_size_groups() {
    let f = Fixture::new();
    fs::write(f.root.join("first"), [0; 8]).unwrap();
    fs::write(f.root.join("second"), [1; 8]).unwrap();
    let service = f.service();
    let run = |service: &ScanService| {
        let (tx, rx) = mpsc::channel();
        let scan = service
            .start(f.request(), move |update| tx.send(update).is_ok())
            .unwrap();
        (scan, wait_terminal(&rx))
    };
    let (older, _) = run(&service);
    fs::write(f.root.join("third"), [2; 3]).unwrap();
    let (newer, _) = run(&service);
    let history = service.history(None).unwrap();
    assert_eq!(history.items[0].id, newer.id);
    assert_eq!(history.items[1].id, older.id);
    let comparison = service.compare(&newer.id, &older.id).unwrap();
    assert_eq!(comparison.logical_size_delta, "3");
    assert_eq!(comparison.added_files_count, "1");
    assert_eq!(comparison.removed_files_count, "0");
    assert_eq!(comparison.modified_files_count, "0");
    assert_eq!(comparison.moved_files_count, "0");
    assert_eq!(comparison.added_files.len(), 1);
    assert!(comparison.added_files[0].path.ends_with("third"));
    assert!(comparison.removed_files.is_empty());
    assert!(comparison.modified_files.is_empty());
    let old_root = service.root(&older.id).unwrap();
    assert_eq!(
        service
            .children(&older.id, &old_root.id, None)
            .unwrap()
            .items
            .len(),
        2
    );
    assert_eq!(
        service
            .directory_map(&older.id, &old_root.id, DirectoryMapMetric::Logical, 3, 8)
            .unwrap()
            .root
            .size,
        "16"
    );
    let groups = service.duplicate_candidates(None).unwrap();
    assert_eq!(groups.items[0].size, "8");
    assert_eq!(groups.items[0].files_count, "2");
    assert_eq!(groups.items[0].reclaimable_size, "8");
    service.delete_history(&older.id).unwrap();
    assert!(f.root.join("first").exists());
    assert_eq!(service.history(None).unwrap().items.len(), 1);
    assert_eq!(
        service.get_scan(Some(&older.id)).unwrap_err().code,
        ErrorCode::ScanNotFound
    );
    service.shutdown().unwrap();
}

#[test]
fn history_retention_keeps_the_requested_latest_results_and_the_open_scan() {
    let f = Fixture::new();
    fs::write(f.root.join("file"), [0]).unwrap();
    let service = f.service();
    let run = || {
        let (tx, rx) = mpsc::channel();
        let scan = service
            .start(f.request(), move |update| tx.send(update).is_ok())
            .unwrap();
        wait_terminal(&rx);
        scan
    };
    let protected = run();
    let removed = run();
    let latest = run();

    let cleanup = service.cleanup_history(1, Some(&protected.id)).unwrap();
    assert_eq!(cleanup.deleted_scan_ids, vec![removed.id]);
    let remaining = service.history(None).unwrap().items;
    assert_eq!(remaining.len(), 2);
    assert_eq!(remaining[0].id, latest.id);
    assert_eq!(remaining[1].id, protected.id);
    service.shutdown().unwrap();
}

#[test]
fn duplicate_candidates_use_last_completed_scan_when_newer_scan_failed() {
    let f = Fixture::new();
    fs::write(f.root.join("first"), [0; 4]).unwrap();
    fs::write(f.root.join("second"), [1; 4]).unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    wait_terminal(&rx);
    {
        let mut storage = SqliteStorage::open(&f.db).unwrap();
        let failed = storage.create_scan(&f.root).unwrap();
        storage
            .transition(
                parse_id(&failed.id).unwrap(),
                ScanState::Failed,
                Some(&AppError::new(ErrorCode::Internal)),
            )
            .unwrap();
    }
    assert_eq!(
        service.duplicate_candidates(None).unwrap().items[0].size,
        "4"
    );
    service.shutdown().unwrap();
}

#[test]
fn duplicate_confirmation_requires_matching_content_not_just_size() {
    let f = Fixture::new();
    fs::write(f.root.join("copy-a"), b"identical-content").unwrap();
    fs::write(f.root.join("copy-b"), b"identical-content").unwrap();
    fs::write(f.root.join("same-size-different"), b"different-content").unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);
    let groups = service.confirm_duplicates().unwrap();
    assert_eq!(groups.items.len(), 1);
    assert_eq!(groups.items[0].files_count, "2");
    assert_eq!(groups.items[0].size, "17");
    let files = service
        .duplicate_files(
            groups.scan_id.as_deref().unwrap(),
            &groups.items[0].content_hash,
            None,
        )
        .unwrap();
    assert_eq!(files.items.len(), 2);
    let ids = files
        .items
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        service
            .delete_duplicate_entries(groups.scan_id.as_deref().unwrap(), &ids)
            .unwrap_err()
            .code,
        ErrorCode::InvalidTarget
    );
    let survivor_path = files.items[1].path.clone();
    fs::remove_file(survivor_path).unwrap();
    assert_eq!(
        service
            .delete_duplicate_entries(
                groups.scan_id.as_deref().unwrap(),
                &[files.items[0].id.clone()],
            )
            .unwrap_err()
            .code,
        ErrorCode::EntryChanged
    );
    service.shutdown().unwrap();
}

#[test]
fn duplicate_batch_deletion_preserves_failed_copy_and_reconciles_successes() {
    let f = Fixture::new();
    for name in ["accepted", "rejected", "survivor"] {
        fs::write(f.root.join(name), b"identical-content").unwrap();
    }
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    wait_terminal(&rx);
    let groups = service.confirm_duplicates().unwrap();
    let scan_id = groups.scan_id.as_deref().unwrap();
    let hash = &groups.items[0].content_hash;
    let files = service.duplicate_files(scan_id, hash, None).unwrap();
    let selected = ["accepted", "rejected"]
        .into_iter()
        .map(|name| {
            files
                .items
                .iter()
                .find(|entry| entry.name == name)
                .unwrap()
                .id
                .clone()
        })
        .collect::<Vec<_>>();
    let trash = SelectiveTrash {
        rejected_name: "rejected",
        paths: Mutex::new(vec![]),
    };

    let result = service
        .delete_duplicate_entries_with(scan_id, &selected, &trash, &NativeFileSystem)
        .unwrap();
    assert_eq!(result.moved_entry_ids, vec![selected[0].clone()]);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.failures[0].entry_id, selected[1]);
    assert_eq!(result.failures[0].code, ErrorCode::PermissionDenied);
    let remaining = service.duplicate_files(scan_id, hash, None).unwrap();
    assert_eq!(remaining.items.len(), 2);
    assert!(remaining.items.iter().any(|entry| entry.name == "rejected"));
    assert!(remaining.items.iter().any(|entry| entry.name == "survivor"));
    service.shutdown().unwrap();
}

#[test]
fn duplicate_confirmation_reuses_cache_and_excludes_disappeared_files() {
    let f = Fixture::new();
    let first = f.root.join("copy-a");
    let second = f.root.join("copy-b");
    fs::write(&first, b"same-content").unwrap();
    fs::write(&second, b"same-content").unwrap();
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    wait_terminal(&rx);
    assert_eq!(service.confirm_duplicates().unwrap().items.len(), 1);
    let connection = Connection::open(&f.db).unwrap();
    let cached: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE partial_fingerprint IS NOT NULL AND content_hash IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(cached, 2);
    drop(connection);

    fs::remove_file(&second).unwrap();
    let refreshed = service.confirm_duplicates().unwrap();
    assert!(refreshed.items.is_empty());
    let connection = Connection::open(&f.db).unwrap();
    let cleared: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE name='copy-b' AND partial_fingerprint IS NULL AND content_hash IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(cleared, 1);
    service.shutdown().unwrap();
}

#[test]
fn confirmed_duplicate_groups_are_paginated_without_losing_equal_boundaries() {
    let f = Fixture::new();
    for size in 1..=51 {
        let content = vec![size as u8; size];
        fs::write(f.root.join(format!("group-{size:02}-a")), &content).unwrap();
        fs::write(f.root.join(format!("group-{size:02}-b")), &content).unwrap();
    }
    let service = f.service();
    let (tx, rx) = mpsc::channel();
    service
        .start(f.request(), move |update| tx.send(update).is_ok())
        .unwrap();
    assert_eq!(wait_terminal(&rx).state, ScanState::Completed);

    let first = service.confirm_duplicates().unwrap();
    assert_eq!(first.items.len(), 50);
    assert_eq!(first.next_cursor.as_deref(), Some("50"));
    let second = service
        .confirmed_duplicates(first.next_cursor.as_deref())
        .unwrap();
    assert_eq!(second.items.len(), 1);
    assert!(second.next_cursor.is_none());
    assert_eq!(
        service
            .confirmed_duplicates(Some("invalid"))
            .unwrap_err()
            .code,
        ErrorCode::InvalidTarget
    );
    service.shutdown().unwrap();
}

#[test]
fn comparison_rejects_scans_of_different_roots() {
    let f = Fixture::new();
    let other = f.root.parent().unwrap().join("other");
    fs::create_dir(&other).unwrap();
    let service = f.service();
    let run = |request: StartScanRequest| {
        let (tx, rx) = mpsc::channel();
        let scan = service
            .start(request, move |update| tx.send(update).is_ok())
            .unwrap();
        wait_terminal(&rx);
        scan
    };
    let first = run(f.request());
    let second = run(StartScanRequest {
        root_path: other.to_str().unwrap().into(),
    });
    assert_eq!(
        service.compare(&second.id, &first.id).unwrap_err().code,
        ErrorCode::IncompatibleScans
    );
    service.shutdown().unwrap();
}

#[cfg(unix)]
#[test]
fn symlink_loop_is_counted_without_following() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    symlink(&f.root, f.root.join("loop")).unwrap();
    symlink(f.root.join("missing"), f.root.join("broken")).unwrap();
    let name = std::ffi::OsString::from("папка");
    fs::create_dir(f.root.join(&name)).unwrap();
    let path = f.root.join(&name).join("child");
    fs::write(&path, [0; 7]).unwrap();
    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    assert_eq!(result.state, ScanState::Completed);
    assert_eq!(result.symlinks_count, "2");
    assert_eq!(result.files_count, "1");
    assert_eq!(result.logical_size, "7");
    let connection = Connection::open(&f.db).unwrap();
    let bytes: Vec<u8> = connection
        .query_row("SELECT path FROM entries WHERE name='child'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(
        filesystem::native::decode_path(bytes).unwrap(),
        path.canonicalize().unwrap()
    );
}

#[cfg(unix)]
#[test]
fn hardlinks_are_indexed_as_distinct_paths_with_the_documented_path_size_semantics() {
    let f = Fixture::new();
    let original = f.root.join("original.bin");
    let linked = f.root.join("linked.bin");
    fs::write(&original, [0; 13]).unwrap();
    fs::hard_link(&original, &linked).unwrap();
    assert_eq!(
        NativeFileSystem.metadata(&original).unwrap().link_count,
        Some(2)
    );

    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    assert_eq!(result.state, ScanState::Completed);
    assert_eq!(result.files_count, "2");
    assert_eq!(result.logical_size, "26");
    assert_eq!(
        result.unique_allocated_size,
        NativeFileSystem
            .metadata(&original)
            .unwrap()
            .allocated_size
            .map(|value| value.to_string())
    );
    assert_eq!(
        result
            .allocated_size
            .as_deref()
            .unwrap()
            .parse::<u64>()
            .unwrap(),
        result
            .unique_allocated_size
            .as_deref()
            .unwrap()
            .parse::<u64>()
            .unwrap()
            * 2
    );

    let connection = Connection::open(&f.db).unwrap();
    let identities = connection
        .prepare("SELECT identity FROM entries WHERE kind='file' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get::<_, Option<String>>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(identities.len(), 2);
    assert!(identities[0].is_some());
    assert_eq!(identities[0], identities[1]);

    let service = f.service();
    let root = service.root(&result.id).unwrap();
    let mut entries = service.children(&result.id, &root.id, None).unwrap().items;
    let trash = RecordingTrash {
        paths: Mutex::new(vec![]),
    };
    let first = entries.pop().unwrap();
    service
        .move_to_trash_with(&result.id, &first.id, &trash, &NativeFileSystem)
        .unwrap();
    assert_eq!(
        service
            .get_scan(Some(&result.id))
            .unwrap()
            .unwrap()
            .unique_allocated_size,
        result.unique_allocated_size
    );
    let second = entries.pop().unwrap();
    service
        .move_to_trash_with(&result.id, &second.id, &trash, &NativeFileSystem)
        .unwrap();
    assert_eq!(
        service
            .get_scan(Some(&result.id))
            .unwrap()
            .unwrap()
            .unique_allocated_size
            .as_deref(),
        Some("0")
    );
    service.shutdown().unwrap();
}

#[cfg(unix)]
#[test]
fn sparse_file_reports_logical_and_allocated_sizes_separately() {
    let f = Fixture::new();
    let sparse = f.root.join("sparse.bin");
    fs::File::create(&sparse)
        .unwrap()
        .set_len(1024 * 1024 * 1024)
        .unwrap();
    let native = NativeFileSystem.metadata(&sparse).unwrap();
    assert_eq!(native.logical_size, 1024 * 1024 * 1024);
    assert_eq!(native.link_count, Some(1));
    assert!(native.allocated_size.unwrap() < native.logical_size);

    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    assert_eq!(result.logical_size, native.logical_size.to_string());
    assert_eq!(result.allocated_size, result.unique_allocated_size);
    assert_eq!(
        result.allocated_size,
        native.allocated_size.map(|value| value.to_string())
    );
}

#[test]
fn managed_faults_cover_disappearing_root_disconnect_and_directory_mutation() {
    use filesystem::fault::{FaultInjectingFileSystem, FaultOperation, FaultRule, FileSystemFault};

    for fault in [
        FileSystemFault::FileDisappeared,
        FileSystemFault::VolumeDisconnected,
    ] {
        let f = Fixture::new();
        let operation = if fault == FileSystemFault::FileDisappeared {
            FaultOperation::Metadata
        } else {
            FaultOperation::ReadDirectory
        };
        let occurrence = 1;
        let provider = FaultInjectingFileSystem::new(
            Arc::new(NativeFileSystem),
            vec![FaultRule::new(
                f.root.canonicalize().unwrap(),
                operation,
                occurrence,
                fault,
            )],
        );
        let result = run_fixture(&f, Arc::new(provider));
        assert_eq!(result.state, ScanState::Failed);
        assert_eq!(result.failure.unwrap().code, ErrorCode::InvalidTarget);
    }

    let f = Fixture::new();
    let changing = f.root.join("changing");
    fs::create_dir(&changing).unwrap();
    fs::write(changing.join("unseen"), b"data").unwrap();
    let provider = FaultInjectingFileSystem::new(
        Arc::new(NativeFileSystem),
        vec![FaultRule::new(
            changing.canonicalize().unwrap(),
            FaultOperation::Metadata,
            2,
            FileSystemFault::MetadataChanged,
        )],
    );
    let result = run_fixture(&f, Arc::new(provider));
    assert_eq!(result.state, ScanState::Partial);
    assert_eq!(result.files_count, "0");
    assert_eq!(result.errors_count, "1");
}

struct FaultFs;
impl FileSystemProvider for FaultFs {
    fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
        if path.file_name().is_some_and(|name| name == "vanished") {
            return Err(io::ErrorKind::NotFound.into());
        }
        NativeFileSystem.metadata(path)
    }
    fn read_directory(&self, path: &Path) -> io::Result<DirectoryEntries> {
        if path.file_name().is_some_and(|name| name == "denied") {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        NativeFileSystem.read_directory(path)
    }
}
#[test]
fn permission_and_disappeared_file_errors_produce_partial_result_and_do_not_stop_scan() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("denied")).unwrap();
    fs::write(f.root.join("vanished"), [0; 9]).unwrap();
    fs::write(f.root.join("readable"), [0; 17]).unwrap();
    let result = run_fixture(&f, Arc::new(FaultFs));
    assert_eq!(result.state, ScanState::Partial);
    assert_eq!(result.files_count, "1");
    assert_eq!(result.logical_size, "17");
    assert_eq!(result.errors_count, "2");
    assert_eq!(result.skipped_count, "1");
    let reopened = f.service();
    let issues = reopened.issues(&result.id, None).unwrap();
    assert_eq!(issues.items.len(), 2);
    assert!(issues.items.iter().any(|i| i.code == "permission_denied"));
    assert!(issues.items.iter().any(|i| i.code == "file_disappeared"));
    let root = reopened.root(&result.id).unwrap();
    assert_eq!(
        reopened
            .children(&result.id, &root.id, None)
            .unwrap()
            .items
            .len(),
        2
    );
    assert_eq!(
        reopened
            .directory_map(&result.id, &root.id, DirectoryMapMetric::Logical, 3, 8)
            .unwrap()
            .root
            .size,
        "17"
    );
    reopened.shutdown().unwrap();
}

struct PausedFs {
    entered: mpsc::Sender<()>,
    resume: Mutex<mpsc::Receiver<()>>,
}
impl FileSystemProvider for PausedFs {
    fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
        NativeFileSystem.metadata(path)
    }
    fn read_directory(&self, path: &Path) -> io::Result<DirectoryEntries> {
        self.entered.send(()).unwrap();
        self.resume
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
        NativeFileSystem.read_directory(path)
    }
}
#[test]
fn cancellation_prevents_writes_and_another_scan_cannot_start_concurrently() {
    let f = Fixture::new();
    fs::write(f.root.join("file"), [0; 5]).unwrap();
    let service = f.service();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let (tx, rx) = mpsc::channel();
    let fs = Arc::new(PausedFs {
        entered: entered_tx,
        resume: Mutex::new(resume_rx),
    });
    let session = service
        .start_with(f.request(), fs, move |s| tx.send(s).is_ok())
        .unwrap();
    entered_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(
        service.start(f.request(), |_| true).unwrap_err().code,
        ErrorCode::ScanBusy
    );
    assert!(ScanService::open(&f.db).is_err());
    assert_eq!(
        service.cancel(&session.id).unwrap().state,
        ScanState::Cancelling
    );
    assert_eq!(
        service.cancel(&session.id).unwrap().state,
        ScanState::Cancelling
    );
    resume_tx.send(()).unwrap();
    let final_state = wait_terminal(&rx);
    assert_eq!(final_state.state, ScanState::Cancelled);
    assert_eq!(final_state.files_count, "0");
    assert_eq!(
        service.cancel(&session.id).unwrap().state,
        ScanState::Cancelled
    );
    service.shutdown().unwrap();
    assert_eq!(
        service.start(f.request(), |_| true).unwrap_err().code,
        ErrorCode::ScanBusy
    );
}

#[test]
fn invalid_targets_fail_without_reporting_success() {
    let f = Fixture::new();
    let service = f.service();
    assert_eq!(
        service
            .start(
                StartScanRequest {
                    root_path: "relative".into()
                },
                |_| true
            )
            .unwrap_err()
            .code,
        ErrorCode::InvalidTarget
    );
    let (tx, rx) = mpsc::channel();
    service
        .start(
            StartScanRequest {
                root_path: f.root.join("missing").to_str().unwrap().into(),
            },
            move |s| tx.send(s).is_ok(),
        )
        .unwrap();
    let result = wait_terminal(&rx);
    assert_eq!(result.state, ScanState::Failed);
    assert_eq!(result.failure.unwrap().code, ErrorCode::InvalidTarget);
    service.shutdown().unwrap();
}

#[test]
fn unfinished_scan_is_interrupted_on_restart_and_completed_scan_is_unchanged() {
    let f = Fixture::new();
    let completed = run_fixture(&f, Arc::new(NativeFileSystem));
    let running = {
        let mut db = SqliteStorage::open(&f.db).unwrap();
        let scan = db.create_scan(&f.root).unwrap();
        let id = parse_id(&scan.id).unwrap();
        db.transition(id, ScanState::Preparing, None).unwrap();
        db.seed_root(id, &f.root, &NativeFileSystem.metadata(&f.root).unwrap())
            .unwrap();
        db.transition(id, ScanState::Scanning, None).unwrap();
        scan
    };
    let service = f.service();
    assert_eq!(
        service.get_scan(Some(&running.id)).unwrap().unwrap().state,
        ScanState::Interrupted
    );
    assert_eq!(
        service.get_scan(Some(&completed.id)).unwrap().unwrap(),
        completed
    );
}

#[test]
fn deep_tree_aggregates_without_recursive_walker() {
    let f = Fixture::new();
    let mut current = f.root.clone();
    for _ in 0..60 {
        current = current.join("d");
        fs::create_dir(&current).unwrap();
    }
    fs::write(current.join("leaf"), [0; 31]).unwrap();
    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    assert_eq!(result.state, ScanState::Completed);
    assert_eq!(result.directories_count, "61");
    assert_eq!(result.logical_size, "31");
}

#[test]
fn many_errors_are_paginated_without_duplicates() {
    struct Denied;
    impl FileSystemProvider for Denied {
        fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
            if path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("denied-")
            {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            NativeFileSystem.metadata(path)
        }
        fn read_directory(&self, path: &Path) -> io::Result<DirectoryEntries> {
            NativeFileSystem.read_directory(path)
        }
    }
    let f = Fixture::new();
    for i in 0..205 {
        fs::write(f.root.join(format!("denied-{i}")), []).unwrap();
    }
    let result = run_fixture(&f, Arc::new(Denied));
    assert_eq!(result.errors_count, "205");
    assert_eq!(result.skipped_count, "205");
    let service = f.service();
    let mut cursor = None;
    let mut paths = std::collections::HashSet::new();
    loop {
        let page = service.issues(&result.id, cursor.as_deref()).unwrap();
        assert!(page.items.len() <= 100);
        for issue in page.items {
            assert!(paths.insert(issue.path));
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(paths.len(), 205);
}

#[cfg(target_os = "linux")]
#[test]
fn non_utf8_directory_is_scanned_without_lossy_path_roundtrip() {
    use std::os::unix::ffi::OsStringExt;
    let f = Fixture::new();
    let directory = f.root.join(std::ffi::OsString::from_vec(vec![b'x', 0xff]));
    fs::create_dir(&directory).unwrap();
    fs::write(directory.join("child"), [0; 11]).unwrap();
    let result = run_fixture(&f, Arc::new(NativeFileSystem));
    assert_eq!(result.state, ScanState::Completed);
    assert_eq!(result.files_count, "1");
    assert_eq!(result.logical_size, "11");
}
