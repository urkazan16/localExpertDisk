use analyzer::Totals;
use domain::{
    AppError, AppInfo, BatchOperationResult, CategorySummary, DirectoryMap, DirectoryMapMetric,
    DuplicateDeleteFailure, DuplicateDeleteResult, DuplicateFilePage, DuplicateGroupPage,
    DuplicateHashFailure, DuplicateHashPhase, DuplicateHashProgress, DuplicateHashResult,
    EntryPage, ErrorCode, HistoryCleanupResult, IndexedEntry, OldFileCriterion, OldFilePage,
    RetentionPolicy, ScanComparison, ScanComparisonFilePage, ScanComparisonKind, ScanHistoryPage,
    ScanIssue, ScanIssuePage, ScanSession, ScanState, StartScanRequest,
};
use filesystem::{
    native::{EntryKind, FileSystemProvider, NativeFileSystem},
    operations::{NativeTrash, TrashProvider},
    volumes::{LocalVolumes, VolumeProvider},
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
        atomic::{AtomicBool, AtomicU64, Ordering},
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
    duplicate_cancel: Mutex<Option<Arc<AtomicBool>>>,
    closed: AtomicBool,
    excluded: PathBuf,
    _lock: File,
}
#[derive(Clone)]
pub struct ScanService {
    shared: Arc<Shared>,
}

#[derive(Default)]
pub struct ScanInstrumentation {
    batch_commits: AtomicU64,
    progress_events: AtomicU64,
}

impl ScanInstrumentation {
    pub fn batch_commits(&self) -> u64 {
        self.batch_commits.load(Ordering::Acquire)
    }

    pub fn progress_events(&self) -> u64 {
        self.progress_events.load(Ordering::Acquire)
    }
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
                duplicate_cancel: Mutex::new(None),
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
    pub fn comparison_files(
        &self,
        newer: &str,
        older: &str,
        kind: ScanComparisonKind,
        after: Option<&str>,
    ) -> Result<ScanComparisonFilePage, AppError> {
        guard(&self.shared.storage)?.comparison_files(
            parse_id(newer)?,
            parse_id(older)?,
            kind,
            after.map(parse_id).transpose()?.unwrap_or(0),
        )
    }
    pub fn retention_policy(&self) -> Result<RetentionPolicy, AppError> {
        guard(&self.shared.storage)?.retention_policy()
    }
    pub fn set_retention_policy(&self, keep_latest: u16) -> Result<RetentionPolicy, AppError> {
        if !(1..=1000).contains(&keep_latest) {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        guard(&self.shared.storage)?.set_retention_policy(keep_latest)
    }
    pub fn delete_history(&self, scan_id: &str) -> Result<(), AppError> {
        guard(&self.shared.storage)?.delete_scan_history(parse_id(scan_id)?)
    }
    pub fn cleanup_history(
        &self,
        keep_latest: u16,
        protected_scan_id: Option<&str>,
    ) -> Result<HistoryCleanupResult, AppError> {
        if !(1..=1000).contains(&keep_latest) {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        guard(&self.shared.storage)?.cleanup_scan_history(
            usize::from(keep_latest),
            protected_scan_id.map(parse_id).transpose()?,
        )
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
        Ok(self.confirm_duplicates_with_progress(|_| true)?.groups)
    }
    pub fn confirm_duplicates_with_progress(
        &self,
        progress: impl Fn(DuplicateHashProgress) -> bool,
    ) -> Result<DuplicateHashResult, AppError> {
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut active = guard(&self.shared.duplicate_cancel)?;
            if active.is_some() {
                return Err(AppError::new(ErrorCode::ScanBusy));
            }
            *active = Some(Arc::clone(&cancel));
        }
        let result = self.confirm_duplicates_with(&cancel, progress);
        *guard(&self.shared.duplicate_cancel)? = None;
        result
    }
    fn confirm_duplicates_with(
        &self,
        cancel: &AtomicBool,
        progress: impl Fn(DuplicateHashProgress) -> bool,
    ) -> Result<DuplicateHashResult, AppError> {
        let (scan_id, mut candidates) = guard(&self.shared.storage)?.duplicate_hash_candidates()?;
        let mut failures = Vec::new();
        let total = candidates.len() as u64;
        let publish = |phase: DuplicateHashPhase, processed: u64, total: u64| {
            let update = DuplicateHashProgress {
                scan_id: scan_id.to_string(),
                phase,
                processed_files: processed.to_string(),
                total_files: total.to_string(),
            };
            if !progress(update) {
                cancel.store(true, Ordering::Release);
            }
        };
        publish(DuplicateHashPhase::Fingerprint, 0, total);
        let mut fingerprints = std::collections::BTreeMap::<(u64, String), Vec<_>>::new();
        for (index, candidate) in candidates.iter_mut().enumerate() {
            if cancel.load(Ordering::Acquire) {
                publish(DuplicateHashPhase::Cancelled, index as u64, total);
                return self.duplicate_hash_result(scan_id, failures, true);
            }
            let signature = match hash_candidate_signature(&NativeFileSystem, candidate) {
                Ok(signature) => signature,
                Err(code) => {
                    failures.push(hash_failure(candidate, code));
                    guard(&self.shared.storage)?.clear_duplicate_hashes(scan_id, candidate.id)?;
                    publish(DuplicateHashPhase::Fingerprint, index as u64 + 1, total);
                    continue;
                }
            };
            if candidate.hash_metadata_signature.as_deref() != Some(&signature)
                && (candidate.partial_fingerprint.is_some() || candidate.content_hash.is_some())
            {
                guard(&self.shared.storage)?.clear_duplicate_hashes(scan_id, candidate.id)?;
                candidate.partial_fingerprint = None;
                candidate.content_hash = None;
            }
            let fingerprint = match candidate.partial_fingerprint.clone() {
                Some(value) => value,
                None => match hash_file(&candidate.path, candidate.size, true, cancel) {
                    Ok(Some(value)) => {
                        if hash_candidate_signature(&NativeFileSystem, candidate).as_deref()
                            != Ok(signature.as_str())
                        {
                            failures.push(hash_failure(candidate, ErrorCode::EntryChanged));
                            guard(&self.shared.storage)?
                                .clear_duplicate_hashes(scan_id, candidate.id)?;
                            publish(DuplicateHashPhase::Fingerprint, index as u64 + 1, total);
                            continue;
                        }
                        guard(&self.shared.storage)?.record_partial_fingerprint(
                            scan_id,
                            candidate.id,
                            &value,
                            &signature,
                        )?;
                        candidate.hash_metadata_signature = Some(signature.clone());
                        value
                    }
                    Ok(None) => {
                        publish(DuplicateHashPhase::Cancelled, index as u64, total);
                        return self.duplicate_hash_result(scan_id, failures, true);
                    }
                    Err(error) => {
                        failures.push(hash_failure(candidate, error.code));
                        guard(&self.shared.storage)?
                            .clear_duplicate_hashes(scan_id, candidate.id)?;
                        publish(DuplicateHashPhase::Fingerprint, index as u64 + 1, total);
                        continue;
                    }
                },
            };
            fingerprints
                .entry((candidate.size, fingerprint))
                .or_default()
                .push(candidate.clone());
            publish(DuplicateHashPhase::Fingerprint, index as u64 + 1, total);
        }
        let groups = fingerprints
            .into_iter()
            .filter(|(_, group)| group.len() > 1)
            .map(|(_, group)| group)
            .collect::<Vec<_>>();
        let sha_total = groups.iter().map(Vec::len).sum::<usize>() as u64;
        let mut sha_processed = 0_u64;
        publish(DuplicateHashPhase::Sha256, sha_processed, sha_total);
        for group in groups {
            for candidate in group {
                if cancel.load(Ordering::Acquire) {
                    publish(DuplicateHashPhase::Cancelled, sha_processed, sha_total);
                    return self.duplicate_hash_result(scan_id, failures, true);
                }
                if candidate.content_hash.is_some() {
                    sha_processed += 1;
                    publish(DuplicateHashPhase::Sha256, sha_processed, sha_total);
                    continue;
                }
                let hash = match hash_file(&candidate.path, candidate.size, false, cancel) {
                    Ok(Some(hash)) => hash,
                    Ok(None) => {
                        publish(DuplicateHashPhase::Cancelled, sha_processed, sha_total);
                        return self.duplicate_hash_result(scan_id, failures, true);
                    }
                    Err(error) => {
                        failures.push(hash_failure(&candidate, error.code));
                        guard(&self.shared.storage)?
                            .clear_duplicate_hashes(scan_id, candidate.id)?;
                        sha_processed += 1;
                        publish(DuplicateHashPhase::Sha256, sha_processed, sha_total);
                        continue;
                    }
                };
                let signature = candidate
                    .hash_metadata_signature
                    .as_deref()
                    .unwrap_or_default();
                if hash_candidate_signature(&NativeFileSystem, &candidate).as_deref()
                    != Ok(signature)
                {
                    failures.push(hash_failure(&candidate, ErrorCode::EntryChanged));
                    guard(&self.shared.storage)?.clear_duplicate_hashes(scan_id, candidate.id)?;
                    sha_processed += 1;
                    publish(DuplicateHashPhase::Sha256, sha_processed, sha_total);
                    continue;
                }
                guard(&self.shared.storage)?.record_content_hash(
                    scan_id,
                    candidate.id,
                    &hash,
                    signature,
                )?;
                sha_processed += 1;
                publish(DuplicateHashPhase::Sha256, sha_processed, sha_total);
            }
        }
        publish(DuplicateHashPhase::Complete, sha_total, sha_total);
        self.duplicate_hash_result(scan_id, failures, false)
    }
    fn duplicate_hash_result(
        &self,
        _scan_id: i64,
        failures: Vec<DuplicateHashFailure>,
        cancelled: bool,
    ) -> Result<DuplicateHashResult, AppError> {
        Ok(DuplicateHashResult {
            groups: guard(&self.shared.storage)?.confirmed_duplicates(None)?,
            failures,
            cancelled,
        })
    }
    pub fn cancel_duplicate_hashing(&self) -> Result<(), AppError> {
        let active = guard(&self.shared.duplicate_cancel)?;
        let cancel = active
            .as_ref()
            .ok_or_else(|| AppError::new(ErrorCode::ScanNotFound))?;
        cancel.store(true, Ordering::Release);
        Ok(())
    }
    pub fn confirmed_duplicates(
        &self,
        after: Option<&str>,
    ) -> Result<DuplicateGroupPage, AppError> {
        let after = after
            .map(|value| {
                value
                    .parse::<i64>()
                    .ok()
                    .filter(|value| *value >= 0)
                    .ok_or_else(|| AppError::new(ErrorCode::InvalidTarget))
            })
            .transpose()?;
        guard(&self.shared.storage)?.confirmed_duplicates(after)
    }
    pub fn duplicate_files(
        &self,
        scan_id: &str,
        content_hash: &str,
        after: Option<&str>,
    ) -> Result<DuplicateFilePage, AppError> {
        if content_hash.len() != 64 || !content_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        guard(&self.shared.storage)?.duplicate_files(
            parse_id(scan_id)?,
            content_hash,
            after.map(parse_id).transpose()?.unwrap_or(0),
        )
    }
    pub fn delete_duplicate_entries(
        &self,
        scan_id: &str,
        entry_ids: &[String],
    ) -> Result<DuplicateDeleteResult, AppError> {
        self.delete_duplicate_entries_with(scan_id, entry_ids, &NativeTrash, &NativeFileSystem)
    }
    pub fn delete_duplicate_entries_using(
        &self,
        scan_id: &str,
        entry_ids: &[String],
        trash: &impl TrashProvider,
    ) -> Result<DuplicateDeleteResult, AppError> {
        self.delete_duplicate_entries_with(scan_id, entry_ids, trash, &NativeFileSystem)
    }
    fn delete_duplicate_entries_with(
        &self,
        scan_id: &str,
        entry_ids: &[String],
        trash: &impl TrashProvider,
        fs: &impl FileSystemProvider,
    ) -> Result<DuplicateDeleteResult, AppError> {
        let unique_ids = entry_ids.iter().collect::<std::collections::BTreeSet<_>>();
        if entry_ids.is_empty() || entry_ids.len() > 100 || unique_ids.len() != entry_ids.len() {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        let parsed = entry_ids
            .iter()
            .map(|id| parse_id(id))
            .collect::<Result<Vec<_>, _>>()?;
        let parsed_scan_id = parse_id(scan_id)?;
        guard(&self.shared.storage)?.validate_duplicate_deletion(parsed_scan_id, &parsed)?;
        let (group_count, survivors) =
            guard(&self.shared.storage)?.duplicate_deletion_survivors(parsed_scan_id, &parsed)?;
        let mut surviving_groups = std::collections::BTreeSet::new();
        for survivor in survivors {
            if hash_candidate_unchanged(fs, &survivor) {
                if let Some(hash) = survivor.content_hash {
                    surviving_groups.insert(hash);
                }
            } else {
                guard(&self.shared.storage)?.clear_duplicate_hashes(parsed_scan_id, survivor.id)?;
            }
        }
        if surviving_groups.len() != group_count {
            return Err(AppError::new(ErrorCode::EntryChanged));
        }
        let mut moved_entry_ids = Vec::new();
        let mut failures = Vec::new();
        for entry_id in entry_ids {
            match self.move_to_trash_with(scan_id, entry_id, trash, fs) {
                Ok(()) => moved_entry_ids.push(entry_id.clone()),
                Err(error) => {
                    if error.code == ErrorCode::EntryChanged {
                        guard(&self.shared.storage)?
                            .clear_duplicate_hashes(parsed_scan_id, parse_id(entry_id)?)?;
                    }
                    failures.push(DuplicateDeleteFailure {
                        entry_id: entry_id.clone(),
                        code: error.code,
                    });
                }
            }
        }
        Ok(DuplicateDeleteResult {
            moved_entry_ids,
            failures,
        })
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
    pub fn directory_map(
        &self,
        scan_id: &str,
        directory_id: &str,
        metric: DirectoryMapMetric,
        depth: u8,
        max_children: u8,
    ) -> Result<DirectoryMap, AppError> {
        if !(1..=3).contains(&depth) || !(1..=18).contains(&max_children) {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        guard(&self.shared.storage)?.directory_map(
            parse_id(scan_id)?,
            parse_id(directory_id)?,
            metric,
            depth,
            usize::from(max_children),
        )
    }
    pub fn large_files(&self, scan_id: &str, after: Option<&str>) -> Result<EntryPage, AppError> {
        guard(&self.shared.storage)?.large_files(parse_id(scan_id)?, after)
    }
    pub fn filtered_large_files(
        &self,
        scan_id: &str,
        min_size: &str,
        category: Option<domain::FileCategory>,
        sort: domain::FileSort,
        after: Option<&str>,
    ) -> Result<EntryPage, AppError> {
        let min_size = min_size
            .parse::<i64>()
            .ok()
            .filter(|value| *value >= 0)
            .ok_or_else(|| AppError::new(ErrorCode::InvalidTarget))?;
        guard(&self.shared.storage)?.filtered_large_files(
            parse_id(scan_id)?,
            min_size,
            category,
            sort,
            after,
        )
    }
    pub fn categories(&self, scan_id: &str) -> Result<Vec<CategorySummary>, AppError> {
        guard(&self.shared.storage)?.categories(parse_id(scan_id)?)
    }
    pub fn files_in_category(
        &self,
        scan_id: &str,
        category: domain::FileCategory,
        after: Option<&str>,
    ) -> Result<EntryPage, AppError> {
        guard(&self.shared.storage)?.files_in_category(
            parse_id(scan_id)?,
            category,
            after.map(parse_id).transpose()?.unwrap_or(0),
        )
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
        self.move_entries_to_trash_with(scan_id, entry_ids, &NativeTrash, &NativeFileSystem)
    }
    fn move_entries_to_trash_with(
        &self,
        scan_id: &str,
        entry_ids: &[String],
        trash: &impl TrashProvider,
        fs: &impl FileSystemProvider,
    ) -> Result<BatchOperationResult, AppError> {
        let unique_ids = entry_ids.iter().collect::<std::collections::BTreeSet<_>>();
        if entry_ids.is_empty() || entry_ids.len() > 100 || unique_ids.len() != entry_ids.len() {
            return Err(AppError::new(ErrorCode::InvalidTarget));
        }
        let mut moved_entry_ids = Vec::new();
        let mut failed_entry_ids = Vec::new();
        let mut first_error = None;
        for entry_id in entry_ids {
            match self.move_to_trash_with(scan_id, entry_id, trash, fs) {
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
        let current = fs.metadata(&target.path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                AppError::new(ErrorCode::PermissionDenied)
            } else {
                AppError::new(ErrorCode::EntryChanged)
            }
        })?;
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
    pub fn start_with(
        &self,
        request: StartScanRequest,
        fs: Arc<dyn FileSystemProvider>,
        progress: impl Fn(ScanSession) -> bool + Send + Sync + 'static,
    ) -> Result<ScanSession, AppError> {
        self.start_instrumented(
            request,
            fs,
            Arc::new(ScanInstrumentation::default()),
            progress,
        )
    }

    pub fn start_instrumented(
        &self,
        request: StartScanRequest,
        fs: Arc<dyn FileSystemProvider>,
        instrumentation: Arc<ScanInstrumentation>,
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
            let terminal = guard(&self.shared.storage)?
                .get_scan(active.id)?
                .state
                .is_terminal();
            if !active.handle.is_finished() && !terminal {
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
        let worker_instrumentation = Arc::clone(&instrumentation);
        let handle = std::thread::Builder::new().name(format!("scan-{id}")).spawn(move || {
            let mut last_progress = Instant::now() - Duration::from_secs(1);
            let mut publish = || {
                if last_progress.elapsed() >= Duration::from_millis(250) {
                    if let Ok(storage) = guard(&shared.storage) {
                        let update = storage.get_scan(id);
                        drop(storage);
                        if let Ok(update) = update {
                            worker_instrumentation.progress_events.fetch_add(1, Ordering::AcqRel);
                            if !progress(update) { worker_cancel.store(true, Ordering::Release); }
                        }
                    }
                    last_progress = Instant::now();
                }
            };
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&shared,id,&root,fs.as_ref(),&worker_cancel,&worker_instrumentation,&mut publish))).unwrap_or_else(|_| Err(internal()));
            let result = finalize(&shared,id,&worker_cancel,outcome);
            let final_session = result.unwrap_or_else(|error| {
                tracing::error!(component="scanner",scan_id=id,code=?error.code,"Unable to persist final scan state");
                let mut failed = guard(&shared.storage).and_then(|storage|storage.get_scan(id)).unwrap_or(initial);
                failed.state = ScanState::Failed;
                failed.failure = Some(error);
                failed
            });
            worker_instrumentation.progress_events.fetch_add(1, Ordering::AcqRel);
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
        if let Some(cancel) = guard(&self.shared.duplicate_cancel)?.as_ref() {
            cancel.store(true, Ordering::Release);
        }
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

fn hash_candidate_unchanged(
    fs: &impl FileSystemProvider,
    candidate: &storage::scans::HashCandidate,
) -> bool {
    let Ok(metadata) = fs.metadata(&candidate.path) else {
        return false;
    };
    metadata.kind == EntryKind::File
        && metadata.logical_size == candidate.size
        && (candidate.identity.is_none() || metadata.identity == candidate.identity)
        && (candidate.modified_at_ms.is_none()
            || metadata.modified_at_ms == candidate.modified_at_ms)
}

fn hash_candidate_signature(
    fs: &impl FileSystemProvider,
    candidate: &storage::scans::HashCandidate,
) -> Result<String, ErrorCode> {
    let metadata = fs.metadata(&candidate.path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            ErrorCode::PermissionDenied
        } else {
            ErrorCode::EntryChanged
        }
    })?;
    if metadata.kind != EntryKind::File
        || metadata.logical_size != candidate.size
        || candidate.identity.is_some() && metadata.identity != candidate.identity
        || candidate.modified_at_ms.is_some() && metadata.modified_at_ms != candidate.modified_at_ms
    {
        return Err(ErrorCode::EntryChanged);
    }
    let mut signature = Sha256::new();
    signature.update(metadata.logical_size.to_le_bytes());
    signature.update(metadata.modified_at_ms.unwrap_or(i64::MIN).to_le_bytes());
    if let Some(identity) = metadata.identity {
        signature.update((identity.len() as u64).to_le_bytes());
        signature.update(identity.as_bytes());
    }
    Ok(signature
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn hash_failure(
    candidate: &storage::scans::HashCandidate,
    code: ErrorCode,
) -> DuplicateHashFailure {
    DuplicateHashFailure {
        entry_id: candidate.id.to_string(),
        path: candidate.path.to_string_lossy().into_owned(),
        code,
    }
}

fn hash_file(
    path: &Path,
    size: u64,
    partial: bool,
    cancel: &AtomicBool,
) -> Result<Option<String>, AppError> {
    const CHUNK: u64 = 64 * 1024;
    let mut file = File::open(path).map_err(|error| {
        AppError::new(if error.kind() == std::io::ErrorKind::PermissionDenied {
            ErrorCode::PermissionDenied
        } else {
            ErrorCode::EntryChanged
        })
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; CHUNK.min(size) as usize];
    if partial {
        if cancel.load(Ordering::Acquire) {
            return Ok(None);
        }
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
            if cancel.load(Ordering::Acquire) {
                return Ok(None);
            }
            let read = file
                .read(&mut buffer)
                .map_err(|_| AppError::new(ErrorCode::EntryChanged))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
    }
    Ok(Some(
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    ))
}

struct ProtectedPathPolicy;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProtectedPlatform {
    Macos,
    Windows,
    Linux,
    Unsupported,
}

impl ProtectedPlatform {
    fn current() -> Self {
        match std::env::consts::OS {
            "macos" => Self::Macos,
            "windows" => Self::Windows,
            "linux" => Self::Linux,
            _ => Self::Unsupported,
        }
    }
}

impl ProtectedPathPolicy {
    fn allows(root: &Path, path: &Path, excluded: &Path) -> Result<(), AppError> {
        let platform = ProtectedPlatform::current();
        let mounts = LocalVolumes
            .volumes()
            .into_iter()
            .filter_map(|volume| volume.mount_point.map(PathBuf::from))
            .collect::<Vec<_>>();
        let system_paths = Self::system_paths(platform);
        Self::allows_with(platform, root, path, excluded, &mounts, &system_paths)
    }

    fn allows_with(
        platform: ProtectedPlatform,
        root: &Path,
        path: &Path,
        excluded: &Path,
        mounts: &[PathBuf],
        system_paths: &[PathBuf],
    ) -> Result<(), AppError> {
        let is_scan_root = Self::same_path(platform, path, root);
        let outside_scan = !Self::is_within(platform, path, root);
        let overlaps_app_data =
            Self::is_within(platform, path, excluded) || Self::is_within(platform, excluded, path);
        let is_mount_root = mounts
            .iter()
            .any(|mount| Self::same_path(platform, path, mount));
        let is_system_path = system_paths
            .iter()
            .any(|system| Self::is_within(platform, path, system));
        if is_scan_root || outside_scan || overlaps_app_data || is_mount_root || is_system_path {
            return Err(AppError::new(ErrorCode::ProtectedPath));
        }
        Ok(())
    }

    fn system_paths(platform: ProtectedPlatform) -> Vec<PathBuf> {
        match platform {
            ProtectedPlatform::Macos => [
                "/System",
                "/Library",
                "/Applications",
                "/bin",
                "/sbin",
                "/usr",
                "/private/etc",
                "/private/var/db",
                "/private/var/root",
            ]
            .into_iter()
            .map(PathBuf::from)
            .collect(),
            ProtectedPlatform::Linux => [
                "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run",
                "/sbin", "/sys", "/usr", "/var",
            ]
            .into_iter()
            .map(PathBuf::from)
            .collect(),
            ProtectedPlatform::Windows => {
                let mut paths = [
                    r"C:\Windows",
                    r"C:\Program Files",
                    r"C:\Program Files (x86)",
                    r"C:\ProgramData",
                ]
                .into_iter()
                .map(PathBuf::from)
                .collect::<Vec<_>>();
                for variable in [
                    "SystemRoot",
                    "WINDIR",
                    "ProgramFiles",
                    "ProgramFiles(x86)",
                    "ProgramData",
                ] {
                    if let Some(value) = std::env::var_os(variable) {
                        paths.push(PathBuf::from(value));
                    }
                }
                paths
            }
            ProtectedPlatform::Unsupported => Vec::new(),
        }
    }

    fn same_path(platform: ProtectedPlatform, left: &Path, right: &Path) -> bool {
        if platform == ProtectedPlatform::Windows {
            Self::windows_path(left) == Self::windows_path(right)
        } else {
            left == right
        }
    }

    fn is_within(platform: ProtectedPlatform, path: &Path, parent: &Path) -> bool {
        if platform == ProtectedPlatform::Windows {
            let path = Self::windows_path(path);
            let parent = Self::windows_path(parent);
            path == parent
                || if parent.ends_with('\\') {
                    path.starts_with(&parent)
                } else {
                    path.strip_prefix(&parent)
                        .is_some_and(|suffix| suffix.starts_with('\\'))
                }
        } else {
            path.starts_with(parent)
        }
    }

    fn windows_path(path: &Path) -> String {
        let normalized = path.to_string_lossy().replace('/', "\\").to_lowercase();
        let trimmed = normalized.trim_end_matches('\\');
        if trimmed.len() == 2 && trimmed.ends_with(':') {
            format!("{trimmed}\\")
        } else {
            trimmed.to_owned()
        }
    }
}

struct Writer<'a> {
    shared: &'a Shared,
    id: i64,
    cancel: &'a AtomicBool,
    instrumentation: &'a ScanInstrumentation,
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
        storage.write_scan_batch(self.id, parent, entries, issues, totals)?;
        self.instrumentation
            .batch_commits
            .fetch_add(1, Ordering::AcqRel);
        Ok(())
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
    instrumentation: &ScanInstrumentation,
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
    let mut writer = Writer {
        shared,
        id,
        cancel,
        instrumentation,
    };
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
    let session = match outcome {
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
    }?;
    if let Err(error) = storage.apply_retention_policy() {
        tracing::error!(component="history",operation="automatic_retention",scan_id=id,code=?error.code,"Automatic history cleanup failed");
    }
    Ok(session)
}

#[cfg(test)]
mod tests;
