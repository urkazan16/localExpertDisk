use analyzer::Totals;
use domain::{
    AppError, AppInfo, DuplicateGroupPage, EntryPage, ErrorCode, IndexedEntry, ScanComparison,
    ScanHistoryPage, ScanIssue, ScanIssuePage, ScanSession, ScanState, StartScanRequest,
};
use filesystem::{
    native::{EntryKind, FileSystemProvider, NativeFileSystem},
    LocalPlatform,
};
use scanner::{DirectoryTask, EntryDraft, ScanSink};
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
