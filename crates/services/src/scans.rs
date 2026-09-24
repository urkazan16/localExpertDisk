use analyzer::Totals;
use domain::{
    AppError, AppInfo, BatchOperationResult, DuplicateGroupPage, EntryPage, ErrorCode,
    IndexedEntry, OldFileCriterion, OldFilePage, ScanComparison, ScanHistoryPage, ScanIssue,
    ScanIssuePage, ScanSession, ScanState, StartScanRequest,
};
use filesystem::{
    native::{EntryKind, FileSystemProvider, NativeFileSystem},
    operations::{NativeTrash, TrashProvider},
    LocalPlatform,
};
use scanner::{DirectoryTask, EntryDraft, ScanSink};
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use storage::{scans::parse_id, SqliteStorage};

fn internal() -> AppError {
    AppError::new(ErrorCode::Internal)
}
fn guard<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, AppError> {
    mutex.lock().map_err(|_| internal())
}
struct ActiveJob {
    id: i64,
    cancel: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}
struct Shared {
    storage: Mutex<SqliteStorage>,
    job: Mutex<Option<ActiveJob>>,
    closed: AtomicBool,
    excluded: PathBuf,
    _lock: File,
}
#[derive(Clone)]
pub struct ScanService {
    shared: Arc<Shared>,
}

trait EntryLauncher {
    fn launch(&self, path: &Path, reveal: bool) -> Result<(), AppError>;
}

struct NativeEntryLauncher;
impl EntryLauncher for NativeEntryLauncher {
    fn launch(&self, path: &Path, reveal: bool) -> Result<(), AppError> {
        let mut command = if cfg!(target_os = "macos") {
            let mut command = Command::new("open");
            if reveal {
                command.arg("-R");
            }
            command.arg(path);
            command
        } else if cfg!(target_os = "windows") {
            let mut command = Command::new("explorer.exe");
            if reveal {
                command.arg(format!("/select,{}", path.display()));
            } else {
                command.arg(path);
            }
            command
        } else {
            let mut command = Command::new("xdg-open");
            command.arg(if reveal {
                path.parent().unwrap_or(path)
            } else {
                path
            });
            command
        };
        command
            .spawn()
            .map(|_| ())
            .map_err(|_| AppError::new(ErrorCode::LaunchFailed))
    }
}
impl ScanService {
    /// The database and lock must live in the application's own writable directory.
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("lock"))
            .map_err(|_| AppError::new(ErrorCode::StorageUnavailable))?;
        lock.try_lock()
            .map_err(|_| AppError::new(ErrorCode::ScanBusy))?;
        let excluded = path
            .parent()
            .ok_or_else(internal)?
            .canonicalize()
            .map_err(|_| AppError::new(ErrorCode::StorageUnavailable))?;
        let mut storage = SqliteStorage::open(path)?;
        storage.recover_scans()?;
        Ok(Self {
            shared: Arc::new(Shared {
                storage: Mutex::new(storage),
                job: Mutex::new(None),
                closed: AtomicBool::new(false),
                excluded,
                _lock: lock,
            }),
        })
    }
    pub fn app_info(&self) -> Result<AppInfo, AppError> {
        crate::get_app_info(&*guard(&self.shared.storage)?, &LocalPlatform)
    }
    pub fn get_scan(&self, id: Option<&str>) -> Result<Option<ScanSession>, AppError> {
        let storage = guard(&self.shared.storage)?;
        match id {
            Some(id) => storage.get_scan(parse_id(id)?).map(Some),
            None => storage.latest_scan(),
        }
    }
    pub fn history(&self, after: Option<&str>) -> Result<ScanHistoryPage, AppError> {
        guard(&self.shared.storage)?.scan_history(after.map(parse_id).transpose()?.unwrap_or(0))
    }
    pub fn compare(&self, newer: &str, older: &str) -> Result<ScanComparison, AppError> {
        guard(&self.shared.storage)?.compare_scans(parse_id(newer)?, parse_id(older)?)
    }
    pub fn delete_history(&self, scan_id: &str) -> Result<(), AppError> {
        guard(&self.shared.storage)?.delete_scan_history(parse_id(scan_id)?)
    }
    pub fn duplicate_candidates(
        &self,
        after: Option<&str>,
    ) -> Result<DuplicateGroupPage, AppError> {
        let after = after
            .map(|value| {
                value
                    .parse::<i64>()
                    .ok()
                    .filter(|value| *value >= 0)
                    .ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))
            })
            .transpose()?;
        guard(&self.shared.storage)?.duplicate_candidates(after)
    }
    pub fn confirm_duplicates(&self) -> Result<DuplicateGroupPage, AppError> {
        let (scan_id, candidates) = guard(&self.shared.storage)?.duplicate_hash_candidates()?;
        let mut fingerprints = std::collections::BTreeMap::<(u64, String), Vec<_>>::new();
        for candidate in candidates {
            let metadata = NativeFileSystem
                .metadata(&candidate.path)
                .map_err(|_| AppError::new(ErrorCode::EntryChanged))?;
            if metadata.kind != EntryKind::File
                || metadata.logical_size != candidate.size
                || (candidate.identity.is_some() && metadata.identity != candidate.identity)
                || (candidate.modified_at_ms.is_some()
                    && metadata.modified_at_ms != candidate.modified_at_ms)
            {
                continue;
            }
            let fingerprint = hash_file(&candidate.path, candidate.size, true)?;
            fingerprints
                .entry((candidate.size, fingerprint))
                .or_default()
                .push(candidate);
        }
        for (_, group) in fingerprints
            .into_iter()
            .filter(|(_, group)| group.len() > 1)
        {
            for candidate in group {
                let hash = hash_file(&candidate.path, candidate.size, false)?;
                guard(&self.shared.storage)?.record_content_hash(scan_id, candidate.id, &hash)?;
            }
        }
        guard(&self.shared.storage)?.confirmed_duplicates(None)
    }
    pub fn issues(&self, id: &str, after: Option<&str>) -> Result<ScanIssuePage, AppError> {
        guard(&self.shared.storage)?
            .scan_issues(parse_id(id)?, after.map(parse_id).transpose()?.unwrap_or(0))
    }
    pub fn root(&self, id: &str) -> Result<IndexedEntry, AppError> {
        guard(&self.shared.storage)?.scan_root(parse_id(id)?)
    }
    pub fn children(
        &self,
        scan_id: &str,
        directory_id: &str,
        after: Option<&str>,
    ) -> Result<EntryPage, AppError> {
        guard(&self.shared.storage)?.children(
            parse_id(scan_id)?,
            parse_id(directory_id)?,
            after.map(parse_id).transpose()?.unwrap_or(0),
        )
    }
    pub fn large_files(&self, scan_id: &str, after: Option<&str>) -> Result<EntryPage, AppError> {
        guard(&self.shared.storage)?.large_files(parse_id(scan_id)?, after)
    }
    pub fn old_files(
        &self,
        scan_id: &str,
        criterion: OldFileCriterion,
        older_than_ms: &str,
        min_size: Option<&str>,
        after: Option<&str>,
    ) -> Result<OldFilePage, AppError> {
        let older_than_ms = older_than_ms
            .parse::<i64>()
            .ok()
            .filter(|value| *value >= 0)
            .ok_or_else(|| AppError::new(ErrorCode::InvalidTarget))?;
        let min_size = match min_size {
            Some(value) => value
                .parse::<i64>()
                .ok()
                .filter(|value| *value >= 0)
                .ok_or_else(|| AppError::new(ErrorCode::InvalidTarget))?,
            None => 0,
        };
        guard(&self.shared.storage)?.old_files(
            parse_id(scan_id)?,
            criterion,
            older_than_ms,
            min_size,
            after,
        )
    }
    pub fn search(
        &self,
        scan_id: &str,
        text: &str,
        after: Option<&str>,
    ) -> Result<EntryPage, AppError> {
        let text = text.trim();
        if text.is_empty() || text.len() > 256 || text.contains('\0') {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        guard(&self.shared.storage)?.search(
            parse_id(scan_id)?,
            text,
            after.map(parse_id).transpose()?.unwrap_or(0),
        )
    }
    pub fn open_entry(&self, scan_id: &str, entry_id: &str) -> Result<(), AppError> {
        self.launch_entry_with(scan_id, entry_id, false, &NativeEntryLauncher)
    }
    pub fn reveal_entry(&self, scan_id: &str, entry_id: &str) -> Result<(), AppError> {
        self.launch_entry_with(scan_id, entry_id, true, &NativeEntryLauncher)
    }
    pub fn move_to_trash(&self, scan_id: &str, entry_id: &str) -> Result<(), AppError> {
        self.move_to_trash_with(scan_id, entry_id, &NativeTrash, &NativeFileSystem)
    }
    pub fn move_entries_to_trash(
        &self,
        scan_id: &str,
        entry_ids: &[String],
    ) -> Result<BatchOperationResult, AppError> {
        let unique_ids = entry_ids.iter().collect::<std::collections::BTreeSet<_>>();
        if entry_ids.is_empty() || entry_ids.len() > 100 || unique_ids.len() != entry_ids.len() {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        let mut moved_entry_ids = Vec::new();
        let mut failed_entry_ids = Vec::new();
        let mut first_error = None;
        for entry_id in entry_ids {
            match self.move_to_trash(scan_id, entry_id) {
                Ok(()) => moved_entry_ids.push(entry_id.clone()),
                Err(error) => {
                    first_error.get_or_insert(error);
                    failed_entry_ids.push(entry_id.clone());
                }
            }
        }
        if moved_entry_ids.is_empty() {
            return Err(first_error.unwrap_or_else(|| AppError::new(ErrorCode::InvalidTarget)));
        }
        Ok(BatchOperationResult {
            moved_entry_ids,
            failed_entry_ids,
        })
    }
    fn move_to_trash_with(
        &self,
        scan_id: &str,
        entry_id: &str,
        trash: &impl TrashProvider,
        fs: &impl FileSystemProvider,
    ) -> Result<(), AppError> {
        let scan_id = parse_id(scan_id)?;
        let entry_id = parse_id(entry_id)?;
        let target = guard(&self.shared.storage)?.operation_target(scan_id, entry_id)?;
        ProtectedPathPolicy::allows(&target.root_path, &target.path, &self.shared.excluded)?;
        if !matches!(target.kind, EntryKind::File | EntryKind::Directory) {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        let current = fs
            .metadata(&target.path)
            .map_err(|_| AppError::new(ErrorCode::EntryChanged))?;
        if current.kind != target.kind
            || current.logical_size != target.logical_size
            || target.identity.is_some() && current.identity != target.identity
            || target.modified_at_ms.is_some() && current.modified_at_ms != target.modified_at_ms
        {
            return Err(AppError::new(ErrorCode::EntryChanged));
        }
        trash.move_to_trash(&target.path)?;
        guard(&self.shared.storage)?.reconcile_removed_entry(scan_id, entry_id)
    }
    fn launch_entry_with(
        &self,
        scan_id: &str,
        entry_id: &str,
        reveal: bool,
        launcher: &impl EntryLauncher,
    ) -> Result<(), AppError> {
        let path =
            guard(&self.shared.storage)?.entry_path(parse_id(scan_id)?, parse_id(entry_id)?)?;
        if std::fs::symlink_metadata(&path).is_err() {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        launcher.launch(&path, reveal)
    }
    pub fn start(
        &self,
        request: StartScanRequest,
        progress: impl Fn(ScanSession) -> bool + Send + Sync + 'static,
    ) -> Result<ScanSession, AppError> {
        self.start_with(request, Arc::new(NativeFileSystem), progress)
    }
    fn start_with(
        &self,
        request: StartScanRequest,
        fs: Arc<dyn FileSystemProvider>,
        progress: impl Fn(ScanSession) -> bool + Send + Sync + 'static,
    ) -> Result<ScanSession, AppError> {
        let root = PathBuf::from(&request.root_path);
        if !root.is_absolute()
            || request.root_path.len() > 32768
            || request.root_path.contains('\0')
        {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        let mut job = guard(&self.shared.job)?;
        if self.shared.closed.load(Ordering::Acquire) {
            return Err(AppError::new(ErrorCode::ScanBusy));
        }
        if let Some(active) = job.as_ref() {
            if !active.handle.is_finished() {
                return Err(AppError::new(ErrorCode::ScanBusy));
            }
        }
        if let Some(previous) = job.take() {
            previous.handle.join().map_err(|_| internal())?;
        }
        let session = guard(&self.shared.storage)?.create_scan(&root)?;
        let id = parse_id(&session.id)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_cancel = Arc::clone(&cancel);
        let shared = Arc::clone(&self.shared);
        let initial = session.clone();
        let handle = std::thread::Builder::new().name(format!("scan-{id}")).spawn(move || {
            let mut last_progress = Instant::now() - Duration::from_secs(1);
            let mut publish = || {
                if last_progress.elapsed() >= Duration::from_millis(250) {
                    if let Ok(storage) = guard(&shared.storage) {
                        let update = storage.get_scan(id);
                        drop(storage);
                        if let Ok(update) = update { if !progress(update) { worker_cancel.store(true, Ordering::Release); } }
                    }
                    last_progress = Instant::now();
                }
            };
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&shared,id,&root,fs.as_ref(),&worker_cancel,&mut publish))).unwrap_or_else(|_| Err(internal()));
            let result = finalize(&shared,id,&worker_cancel,outcome);
            let final_session = result.unwrap_or_else(|error| {
                tracing::error!(component="scanner",scan_id=id,code=?error.code,"Unable to persist final scan state");
                let mut failed = guard(&shared.storage).and_then(|storage|storage.get_scan(id)).unwrap_or(initial);
                failed.state = ScanState::Failed;
                failed.failure = Some(error);
                failed
            });
            let _ = progress(final_session);
        });
        match handle {
            Ok(handle) => {
                *job = Some(ActiveJob { id, cancel, handle });
                Ok(session)
            }
            Err(_) => {
                guard(&self.shared.storage)?.transition(
                    id,
                    ScanState::Failed,
                    Some(&internal()),
                )?;
                Err(internal())
            }
        }
    }
    pub fn cancel(&self, id: &str) -> Result<ScanSession, AppError> {
        let id = parse_id(id)?;
        let job = guard(&self.shared.job)?;
        let mut storage = guard(&self.shared.storage)?;
        let session = storage.get_scan(id)?;
        if session.state.is_terminal() || session.state == ScanState::Cancelling {
            return Ok(session);
        }
        let active = job
            .as_ref()
            .filter(|job| job.id == id)
            .ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))?;
        let session = storage.transition(id, ScanState::Cancelling, None)?;
        active.cancel.store(true, Ordering::Release);
        Ok(session)
    }
    pub fn shutdown(&self) -> Result<(), AppError> {
        let active = {
            let mut job = guard(&self.shared.job)?;
            self.shared.closed.store(true, Ordering::Release);
            job.take()
        };
        if let Some(active) = active {
            active.cancel.store(true, Ordering::Release);
            active.handle.join().map_err(|_| internal())?;
        }
        Ok(())
    }
}

fn hash_file(path: &Path, size: u64, partial: bool) -> Result<String, AppError> {
    const CHUNK: u64 = 64 * 1024;
    let mut file = File::open(path).map_err(|_| AppError::new(ErrorCode::EntryChanged))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; CHUNK.min(size) as usize];
    if partial {
        file.read_exact(&mut buffer)
            .map_err(|_| AppError::new(ErrorCode::EntryChanged))?;
        hasher.update(&buffer);
        if size > CHUNK {
            file.seek(SeekFrom::Start(size - CHUNK))
                .map_err(|_| AppError::new(ErrorCode::EntryChanged))?;
            let mut tail = vec![0; CHUNK as usize];
            file.read_exact(&mut tail)
                .map_err(|_| AppError::new(ErrorCode::EntryChanged))?;
            hasher.update(&tail);
        }
    } else {
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|_| AppError::new(ErrorCode::EntryChanged))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

struct ProtectedPathPolicy;
impl ProtectedPathPolicy {
    fn allows(root: &Path, path: &Path, excluded: &Path) -> Result<(), AppError> {
        let protected = ["/System", "/bin", "/sbin", "/usr"];
        if path == root
            || !path.starts_with(root)
            || path.starts_with(excluded)
            || protected.iter().any(|prefix| path.starts_with(prefix))
        {
            return Err(AppError::new(ErrorCode::ProtectedPath));
        }
        Ok(())
    }
}

struct Writer<'a> {
    shared: &'a Shared,
    id: i64,
    cancel: &'a AtomicBool,
}
impl ScanSink for Writer<'_> {
    fn next_directory(&mut self) -> Result<Option<DirectoryTask>, AppError> {
        guard(&self.shared.storage)?.next_directory(self.id)
    }
    fn write_batch(
        &mut self,
        parent: i64,
        entries: &[EntryDraft],
        issues: &[ScanIssue],
        totals: Totals,
    ) -> Result<(), AppError> {
        let mut storage = guard(&self.shared.storage)?;
        if self.cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        storage.write_scan_batch(self.id, parent, entries, issues, totals)
    }
    fn finish_directory(&mut self, id: i64) -> Result<(), AppError> {
        let mut storage = guard(&self.shared.storage)?;
        if self.cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        storage.finish_directory(id)
    }
}
fn run(
    shared: &Shared,
    id: i64,
    root: &Path,
    fs: &dyn FileSystemProvider,
    cancel: &AtomicBool,
    publish: &mut impl FnMut(),
) -> Result<ScanState, AppError> {
    {
        let mut storage = guard(&shared.storage)?;
        if cancel.load(Ordering::Acquire) {
            return Ok(ScanState::Cancelled);
        }
        storage.transition(id, ScanState::Preparing, None)?;
    }
    publish();
    let metadata = fs
        .metadata(root)
        .map_err(|_| AppError::new(ErrorCode::InvalidTarget))?;
    if metadata.kind != EntryKind::Directory {
        return Err(AppError::new(ErrorCode::InvalidTarget));
    }
    let root = root
        .canonicalize()
        .map_err(|_| AppError::new(ErrorCode::InvalidTarget))?;
    if root.starts_with(&shared.excluded) {
        return Err(AppError::new(ErrorCode::InvalidTarget));
    }
    {
        let mut storage = guard(&shared.storage)?;
        if cancel.load(Ordering::Acquire) {
            return Ok(ScanState::Cancelled);
        }
        storage.seed_root(id, &root, &metadata)?;
        storage.transition(id, ScanState::Scanning, None)?;
    }
    let mut writer = Writer { shared, id, cancel };
    scanner::scan(fs, &mut writer, cancel, &shared.excluded, publish)
}
fn finalize(
    shared: &Shared,
    id: i64,
    cancel: &AtomicBool,
    outcome: Result<ScanState, AppError>,
) -> Result<ScanSession, AppError> {
    let mut storage = guard(&shared.storage)?;
    let current = storage.get_scan(id)?;
    // A persistence or invariant failure takes precedence over cancellation.
    match outcome {
        Err(error) => storage.transition(id, ScanState::Failed, Some(&error)),
        Ok(state) if cancel.load(Ordering::Acquire) || state == ScanState::Cancelled => {
            if current.state != ScanState::Cancelling {
                storage.transition(id, ScanState::Cancelling, None)?;
            }
            storage.transition(id, ScanState::Cancelled, None)
        }
        Ok(state) => {
            storage.transition(id, ScanState::Finalizing, None)?;
            storage.transition(id, state, None)
        }
    }
}

#[cfg(test)]
mod tests;
