//! Scanner Gate benchmark runner. Writes one self-contained JSON result per run.
use domain::{ScanSession, StartScanRequest};
use filesystem::{
    fault::{FaultInjectingFileSystem, FaultOperation, FaultRule, FileSystemFault},
    native::{FileSystemProvider, NativeFileSystem},
};
use fixture_generator::{generate, FixtureConfig};
use serde::Serialize;
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
    profile: String,
    root: String,
    started_at_ms: u128,
    fixture_generation_ms: Option<u128>,
    duration_ms: u128,
    entries_per_second: f64,
    peak_rss_bytes: Option<u64>,
    batch_commits: u64,
    ipc_progress_events: u64,
    state: String,
    counts: Counts,
    sizes: Sizes,
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
            option => return Err(format!("unknown option: {option}").into()),
        }
        index += 2;
    }
    Ok(Config {
        root: PathBuf::from(root),
        output: output.ok_or("missing --output")?,
        profile: profile.ok_or("missing --profile")?,
        fault,
        fault_target,
        fixture: generate_fixture.then(|| fixture.validate()).transpose()?,
        controlled,
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

fn main() -> Result<(), Box<dyn Error>> {
    let mut config = parse_args(&std::env::args().skip(1).collect::<Vec<_>>()).map_err(|error| {
        format!("{error}\nusage: scanner-benchmark ROOT --output FILE --profile NAME [--generate-files N --generate-directories N --generate-depth N --file-size N] [--controlled] [--fault FAULT] [--fault-target RELATIVE_PATH]")
    })?;
    let fixture_generation_ms = if let Some(fixture) = config.fixture {
        if fixture.files >= 5_000_000 && !config.controlled {
            return Err("5M fixtures require --controlled".into());
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
    service.start_instrumented(
        StartScanRequest {
            root_path: config.root.to_string_lossy().into_owned(),
        },
        provider(&config),
        Arc::clone(&instrumentation),
        move |session| sender.send(session).is_ok(),
    )?;
    let session = terminal(&receiver)?;
    let duration = started.elapsed();
    service.shutdown()?;
    let entries = session.files_count.parse::<u64>()?
        + session.directories_count.parse::<u64>()?
        + session.symlinks_count.parse::<u64>()?;
    let report = Report {
        schema_version: 1,
        profile: config.profile,
        root: config.root.to_string_lossy().into_owned(),
        started_at_ms,
        fixture_generation_ms,
        duration_ms: duration.as_millis(),
        entries_per_second: entries as f64 / duration.as_secs_f64().max(f64::EPSILON),
        peak_rss_bytes: peak_rss_bytes(),
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
            sqlite_bytes: database_size(&database),
        },
    };
    if let Some(parent) = config.output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&config.output, serde_json::to_vec_pretty(&report)?)?;
    println!("{}", serde_json::to_string(&report)?);
    Ok(())
}
