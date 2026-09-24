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
        // Providers are introduced with their implementation in later stages.
        Capabilities::default()
    }
}
