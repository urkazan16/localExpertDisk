use super::*;
use filesystem::native::{DirectoryEntries, EntryMetadata};
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
        .old_files(&session.id, &i64::MAX.to_string(), None)
        .unwrap();
    assert_eq!(old_files.items.len(), 2);
    assert!(old_files
        .items
        .iter()
        .all(|file| !file.modified_at_ms.is_empty()));
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
        .old_files(&session.id, &i64::MAX.to_string(), None)
        .unwrap();
    assert_eq!(first.items.len(), 100);
    let second = service
        .old_files(
            &session.id,
            &i64::MAX.to_string(),
            first.next_cursor.as_deref(),
        )
        .unwrap();
    assert_eq!(second.items.len(), 1);
    assert_ne!(
        first.items.last().unwrap().entry.id,
        second.items[0].entry.id
    );
    assert_eq!(
        service.old_files(&session.id, "-1", None).unwrap_err().code,
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
    assert_eq!(
        service
            .compare(&newer.id, &older.id)
            .unwrap()
            .logical_size_delta,
        "3"
    );
    let groups = service.duplicate_candidates(None).unwrap();
    assert_eq!(groups.items[0].size, "8");
    assert_eq!(groups.items[0].files_count, "2");
    assert_eq!(groups.items[0].reclaimable_size, "8");
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
    let reopened = f.service();
    let issues = reopened.issues(&result.id, None).unwrap();
    assert_eq!(issues.items.len(), 2);
    assert!(issues.items.iter().any(|i| i.code == "permission_denied"));
    assert!(issues.items.iter().any(|i| i.code == "file_disappeared"));
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
