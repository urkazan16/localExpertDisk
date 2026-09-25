//! Platform boundary; capabilities describe implemented functionality only.
use domain::{Capabilities, Platform};

pub trait PlatformProvider: Send + Sync {
    fn platform(&self) -> Platform;
    fn capabilities(&self) -> Capabilities;
}

pub struct LocalPlatform;

impl PlatformProvider for LocalPlatform {
    fn platform(&self) -> Platform {
        match std::env::consts::OS {
            "macos" => Platform::Macos,
            "windows" => Platform::Windows,
            "linux" => Platform::Linux,
            _ => Platform::Unsupported,
        }
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            trash: cfg!(target_os = "macos"),
            allocated_size: cfg!(unix),
            duplicate_hashing: true,
            ..Default::default()
        }
    }
}

pub mod fault;
pub mod native;
pub mod operations;
pub mod snapshots;
pub mod volumes;
pub mod watcher;
