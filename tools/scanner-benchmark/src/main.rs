//! Scanner Gate benchmark runner. Writes one self-contained JSON result per run.
use domain::{DirectoryMapMetric, DirectoryMapNode, ScanSession, StartScanRequest};
use filesystem::{
    fault::{FaultInjectingFileSystem, FaultOperation, FaultRule, FileSystemFault},
    native::{FileSystemProvider, NativeFileSystem},
};
use fixture_generator::{generate, FixtureConfig};
use serde::{Deserialize, Serialize};
use services::scans::{ScanInstrumentation, ScanService};
use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug)]
struct Config {
    root: PathBuf,
    output: PathBuf,
    profile: String,
    fault: Option<FileSystemFault>,
    fault_target: Option<PathBuf>,
    fixture: Option<FixtureConfig>,
    controlled: bool,
    iterations: u32,
    thresholds: Option<PathBuf>,
}

#[derive(Serialize)]
struct Counts {
    files: String,
    directories: String,
    symlinks: String,
    skipped: String,
    errors: String,
}

#[derive(Serialize)]
struct Sizes {
    logical_bytes: String,
    allocated_bytes: Option<String>,
    unique_allocated_bytes: Option<String>,
    sqlite_bytes: u64,
}

#[derive(Serialize)]
struct Report {
    schema_version: u32,
    runner_version: &'static str,
    profile: String,
    environment: EnvironmentReport,
    root: String,
    started_at_ms: u128,
    fixture: Option<FixtureReport>,
    fixture_generation_ms: Option<u128>,
    iterations: u32,
    scan_durations_ms: Vec<u128>,
    processed_entries: String,
    duration_ms: u128,
    entries_per_second: f64,
    peak_rss_bytes: Option<u64>,
    batch_commits: u64,
    ipc_progress_events: u64,
    state: String,
    counts: Counts,
    sizes: Sizes,
    analyzer: AnalyzerReport,
    regression: Option<RegressionReport>,
}

#[derive(Serialize)]
struct EnvironmentReport {
    os: &'static str,
    architecture: &'static str,
}

#[derive(Serialize)]
struct FixtureReport {
    files: u64,
    directories: u32,
    depth: u32,
    file_size: u64,
}

impl From<FixtureConfig> for FixtureReport {
    fn from(value: FixtureConfig) -> Self {
        Self {
            files: value.files,
            directories: value.directories,
            depth: value.depth,
            file_size: value.file_size,
        }
    }
}

#[derive(Serialize)]
struct AnalyzerReport {
    total_duration_ms: u128,
    root_duration_ms: u128,
    explorer_first_page_duration_ms: u128,
    categories_duration_ms: u128,
    first_content_duration_ms: u128,
    directory_map_duration_ms: u128,
    large_files_duration_ms: u128,
    explorer_items: usize,
    directory_map_nodes: usize,
    directory_map_remainder_objects: String,
    peak_rss_before_bytes: Option<u64>,
    peak_rss_after_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
struct Thresholds {
    min_entries_per_second: f64,
    max_peak_rss_bytes: u64,
    max_sqlite_bytes_per_entry: f64,
    max_directory_map_duration_ms: u128,
    max_ipc_events_per_million_entries: f64,
    max_first_display_ms: u128,
}

#[derive(Serialize)]
struct RegressionCheck {
    metric: &'static str,
    actual: f64,
    limit: f64,
    passed: bool,
}

#[derive(Serialize)]
struct RegressionReport {
    passed: bool,
    checks: Vec<RegressionCheck>,
    frontend_first_display_limit_ms: u128,
}

fn parse_fault(value: &str) -> Result<FileSystemFault, Box<dyn Error>> {
    Ok(match value {
        "permission-denied" => FileSystemFault::PermissionDenied,
        "file-disappeared" => FileSystemFault::FileDisappeared,
        "read-failure" => FileSystemFault::ReadFailure,
        "volume-disconnected" => FileSystemFault::VolumeDisconnected,
        "metadata-changed" => FileSystemFault::MetadataChanged,
        _ => return Err(format!("unknown fault: {value}").into()),
    })
}

fn parse_args(args: &[String]) -> Result<Config, Box<dyn Error>> {
    let root = args.first().ok_or("missing ROOT")?;
    let mut output = None;
    let mut profile = None;
    let mut fault = None;
    let mut fault_target = None;
    let mut fixture = FixtureConfig {
        files: 0,
        directories: 0,
        depth: 0,
        file_size: 0,
    };
    let mut generate_fixture = false;
    let mut controlled = false;
    let mut iterations = 1;
    let mut thresholds = None;
    let mut index = 1;
    while index < args.len() {
        if args[index] == "--controlled" {
            controlled = true;
            index += 1;
            continue;
        }
        let value = args.get(index + 1).ok_or("missing option value")?;
        match args[index].as_str() {
            "--output" => output = Some(PathBuf::from(value)),
            "--profile" => profile = Some(value.clone()),
            "--fault" => fault = Some(parse_fault(value)?),
            "--fault-target" => fault_target = Some(PathBuf::from(value)),
            "--generate-files" => {
                fixture.files = value.parse()?;
                generate_fixture = true;
            }
            "--generate-directories" => {
                fixture.directories = value.parse()?;
                generate_fixture = true;
            }
            "--generate-depth" => {
                fixture.depth = value.parse()?;
                generate_fixture = true;
            }
            "--file-size" => {
                fixture.file_size = value.parse()?;
                generate_fixture = true;
            }
            "--iterations" => iterations = value.parse()?,
            "--thresholds" => thresholds = Some(PathBuf::from(value)),
            option => return Err(format!("unknown option: {option}").into()),
        }
        index += 2;
    }
    if !(1..=100).contains(&iterations) {
        return Err("--iterations must be between 1 and 100".into());
    }
    Ok(Config {
        root: PathBuf::from(root),
        output: output.ok_or("missing --output")?,
        profile: profile.ok_or("missing --profile")?,
        fault,
        fault_target,
        fixture: generate_fixture.then(|| fixture.validate()).transpose()?,
        controlled,
        iterations,
        thresholds,
    })
}

fn provider(config: &Config) -> Arc<dyn FileSystemProvider> {
    let native: Arc<dyn FileSystemProvider> = Arc::new(NativeFileSystem);
    let Some(fault) = config.fault else {
        return native;
    };
    let target = config
        .fault_target
        .as_ref()
        .map(|path| config.root.join(path))
        .unwrap_or_else(|| config.root.clone());
    let (operation, occurrence) = match fault {
        FileSystemFault::MetadataChanged | FileSystemFault::FileDisappeared => {
            (FaultOperation::Metadata, 2)
        }
        FileSystemFault::ReadFailure => (FaultOperation::ReadEntry, 1),
        FileSystemFault::PermissionDenied | FileSystemFault::VolumeDisconnected => {
            (FaultOperation::ReadDirectory, 1)
        }
    };
    Arc::new(FaultInjectingFileSystem::new(
        native,
        vec![FaultRule::new(target, operation, occurrence, fault)],
    ))
}

fn database_size(path: &Path) -> u64 {
    [
        path.to_path_buf(),
        path.with_extension("db-wal"),
        path.with_extension("db-shm"),
    ]
    .iter()
    .filter_map(|path| path.metadata().ok().map(|metadata| metadata.len()))
    .sum()
}

#[cfg(unix)]
fn peak_rss_bytes() -> Option<u64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: getrusage initializes the supplied rusage structure on success.
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: the successful call above initialized usage.
    let value = unsafe { usage.assume_init() }.ru_maxrss;
    let bytes = u64::try_from(value).ok()?;
    #[cfg(target_os = "linux")]
    return bytes.checked_mul(1024);
    #[cfg(not(target_os = "linux"))]
    Some(bytes)
}

#[cfg(not(unix))]
fn peak_rss_bytes() -> Option<u64> {
    None
}

fn terminal(receiver: &mpsc::Receiver<ScanSession>) -> Result<ScanSession, Box<dyn Error>> {
    loop {
        let session = receiver.recv_timeout(Duration::from_secs(30))?;
        if session.state.is_terminal() {
            return Ok(session);
        }
    }
}

fn state_name(session: &ScanSession) -> Result<String, Box<dyn Error>> {
    Ok(serde_json::to_value(session.state)?
        .as_str()
        .ok_or("invalid state")?
        .to_owned())
}

fn map_nodes(node: &DirectoryMapNode) -> usize {
    1 + node.children.iter().map(map_nodes).sum::<usize>()
}

fn load_thresholds(path: Option<&Path>) -> Result<Option<Thresholds>, Box<dyn Error>> {
    path.map(|path| Ok(serde_json::from_slice(&fs::read(path)?)?))
        .transpose()
}

fn regression_report(
    thresholds: Thresholds,
    entries_per_second: f64,
    peak_rss_bytes: Option<u64>,
    sqlite_bytes: u64,
    processed_entries: u64,
    directory_map_duration_ms: u128,
    ipc_progress_events: u64,
) -> RegressionReport {
    let denominator = processed_entries.max(1) as f64;
    let values = [
        RegressionCheck {
            metric: "entries_per_second",
            actual: entries_per_second,
            limit: thresholds.min_entries_per_second,
            passed: entries_per_second >= thresholds.min_entries_per_second,
        },
        RegressionCheck {
            metric: "peak_rss_bytes",
            actual: peak_rss_bytes.unwrap_or(u64::MAX) as f64,
            limit: thresholds.max_peak_rss_bytes as f64,
            passed: peak_rss_bytes.is_some_and(|value| value <= thresholds.max_peak_rss_bytes),
        },
        RegressionCheck {
            metric: "sqlite_bytes_per_entry",
            actual: sqlite_bytes as f64 / denominator,
            limit: thresholds.max_sqlite_bytes_per_entry,
            passed: sqlite_bytes as f64 / denominator <= thresholds.max_sqlite_bytes_per_entry,
        },
        RegressionCheck {
            metric: "directory_map_duration_ms",
            actual: directory_map_duration_ms as f64,
            limit: thresholds.max_directory_map_duration_ms as f64,
            passed: directory_map_duration_ms <= thresholds.max_directory_map_duration_ms,
        },
        RegressionCheck {
            metric: "ipc_events_per_million_entries",
            actual: ipc_progress_events as f64 * 1_000_000.0 / denominator,
            limit: thresholds.max_ipc_events_per_million_entries,
            passed: ipc_progress_events as f64 * 1_000_000.0 / denominator
                <= thresholds.max_ipc_events_per_million_entries,
        },
    ];
    let checks = Vec::from(values);
    RegressionReport {
        passed: checks.iter().all(|check| check.passed),
        checks,
        frontend_first_display_limit_ms: thresholds.max_first_display_ms,
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut config = parse_args(&std::env::args().skip(1).collect::<Vec<_>>()).map_err(|error| {
        format!("{error}\nusage: scanner-benchmark ROOT --output FILE --profile NAME [--generate-files N --generate-directories N --generate-depth N --file-size N] [--iterations N] [--thresholds FILE] [--controlled] [--fault FAULT] [--fault-target RELATIVE_PATH]")
    })?;
    let thresholds = load_thresholds(config.thresholds.as_deref())?;
    let fixture_generation_ms = if let Some(fixture) = config.fixture {
        if fixture.files >= 5_000_000
            && (!config.controlled
                || std::env::var("LOCAL_EXPERT_DISK_CONTROLLED").as_deref() != Ok("1"))
        {
            return Err(
                "5M fixtures require --controlled and LOCAL_EXPERT_DISK_CONTROLLED=1".into(),
            );
        }
        let started = Instant::now();
        generate(&config.root, fixture)?;
        Some(started.elapsed().as_millis())
    } else {
        None
    };
    config.root = fs::canonicalize(&config.root)?;
    let state = tempfile::tempdir()?;
    let database = state.path().join("benchmark.db");
    let service = ScanService::open(&database)?;
    let instrumentation = Arc::new(ScanInstrumentation::default());
    let (sender, receiver) = mpsc::channel();
    let started_at_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let started = Instant::now();
    let mut scan_durations_ms = Vec::with_capacity(config.iterations as usize);
    let mut session = None;
    let mut processed_entries = 0_u64;
    for _ in 0..config.iterations {
        let scan_started = Instant::now();
        let updates = sender.clone();
        service.start_instrumented(
            StartScanRequest {
                root_path: config.root.to_string_lossy().into_owned(),
            },
            provider(&config),
            Arc::clone(&instrumentation),
            move |session| updates.send(session).is_ok(),
        )?;
        let completed = terminal(&receiver)?;
        processed_entries += completed.files_count.parse::<u64>()?
            + completed.directories_count.parse::<u64>()?
            + completed.symlinks_count.parse::<u64>()?;
        scan_durations_ms.push(scan_started.elapsed().as_millis());
        session = Some(completed);
    }
    let session = session.ok_or("benchmark did not execute a scan")?;
    let duration = started.elapsed();
    let analyzer_peak_before = peak_rss_bytes();
    let analyzer_started = Instant::now();
    let root_started = Instant::now();
    let root = service.root(&session.id)?;
    let root_duration_ms = root_started.elapsed().as_millis();
    let explorer_started = Instant::now();
    let explorer = service.children(&session.id, &root.id, None)?;
    let explorer_first_page_duration_ms = explorer_started.elapsed().as_millis();
    let categories_started = Instant::now();
    let _categories = service.categories(&session.id)?;
    let categories_duration_ms = categories_started.elapsed().as_millis();
    let first_content_duration_ms =
        root_duration_ms + explorer_first_page_duration_ms + categories_duration_ms;
    let map_started = Instant::now();
    let map = service.directory_map(&session.id, &root.id, DirectoryMapMetric::Logical, 3, 8)?;
    let directory_map_duration_ms = map_started.elapsed().as_millis();
    let large_started = Instant::now();
    let _large_files = service.large_files(&session.id, None)?;
    let large_files_duration_ms = large_started.elapsed().as_millis();
    let analyzer = AnalyzerReport {
        total_duration_ms: analyzer_started.elapsed().as_millis(),
        root_duration_ms,
        explorer_first_page_duration_ms,
        categories_duration_ms,
        first_content_duration_ms,
        directory_map_duration_ms,
        large_files_duration_ms,
        explorer_items: explorer.items.len(),
        directory_map_nodes: map_nodes(&map.root),
        directory_map_remainder_objects: map
            .root
            .remainder
            .as_ref()
            .map(|remainder| remainder.objects_count.clone())
            .unwrap_or_else(|| "0".into()),
        peak_rss_before_bytes: analyzer_peak_before,
        peak_rss_after_bytes: peak_rss_bytes(),
    };
    service.shutdown()?;
    let sqlite_bytes = database_size(&database);
    let peak_rss = peak_rss_bytes();
    let entries_per_second = processed_entries as f64 / duration.as_secs_f64().max(f64::EPSILON);
    let regression = thresholds.map(|thresholds| {
        regression_report(
            thresholds,
            entries_per_second,
            peak_rss,
            sqlite_bytes,
            processed_entries,
            directory_map_duration_ms,
            instrumentation.progress_events(),
        )
    });
    let gate_passed = regression.as_ref().is_none_or(|report| report.passed);
    let report = Report {
        schema_version: 4,
        runner_version: env!("CARGO_PKG_VERSION"),
        profile: config.profile,
        environment: EnvironmentReport {
            os: std::env::consts::OS,
            architecture: std::env::consts::ARCH,
        },
        root: config.root.to_string_lossy().into_owned(),
        started_at_ms,
        fixture: config.fixture.map(Into::into),
        fixture_generation_ms,
        iterations: config.iterations,
        scan_durations_ms,
        processed_entries: processed_entries.to_string(),
        duration_ms: duration.as_millis(),
        entries_per_second,
        peak_rss_bytes: peak_rss,
        batch_commits: instrumentation.batch_commits(),
        ipc_progress_events: instrumentation.progress_events(),
        state: state_name(&session)?,
        counts: Counts {
            files: session.files_count,
            directories: session.directories_count,
            symlinks: session.symlinks_count,
            skipped: session.skipped_count,
            errors: session.errors_count,
        },
        sizes: Sizes {
            logical_bytes: session.logical_size,
            allocated_bytes: session.allocated_size,
            unique_allocated_bytes: session.unique_allocated_size,
            sqlite_bytes,
        },
        analyzer,
        regression,
    };
    if let Some(parent) = config.output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&config.output, serde_json::to_vec_pretty(&report)?)?;
    println!("{}", serde_json::to_string(&report)?);
    if !gate_passed {
        return Err("performance regression thresholds failed".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regression_thresholds_cover_all_scanner_gate_metrics() {
        let report = regression_report(
            Thresholds {
                min_entries_per_second: 3_000.0,
                max_peak_rss_bytes: 64 * 1024 * 1024,
                max_sqlite_bytes_per_entry: 512.0,
                max_directory_map_duration_ms: 3_000,
                max_ipc_events_per_million_entries: 512.0,
                max_first_display_ms: 2_000,
            },
            3_500.0,
            Some(32 * 1024 * 1024),
            400_000_000,
            1_000_000,
            50,
            200,
        );
        assert!(report.passed);
        assert_eq!(report.checks.len(), 5);
        assert_eq!(report.frontend_first_display_limit_ms, 2_000);
    }

    #[test]
    fn regression_failure_is_reported_without_hiding_other_checks() {
        let report = regression_report(
            Thresholds {
                min_entries_per_second: 4_000.0,
                max_peak_rss_bytes: 1,
                max_sqlite_bytes_per_entry: 1.0,
                max_directory_map_duration_ms: 1,
                max_ipc_events_per_million_entries: 1.0,
                max_first_display_ms: 1,
            },
            10.0,
            None,
            10,
            1,
            10,
            10,
        );
        assert!(!report.passed);
        assert!(report.checks.iter().all(|check| !check.passed));
    }
}
