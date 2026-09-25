//! Reusable deterministic filesystem fixture generation.
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};

pub const MAX_ENTRIES: u64 = 10_000_000;
pub const MAX_DEPTH: u32 = 1_024;
pub const MAX_PAYLOAD_BYTES: u64 = 50 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FixtureConfig {
    pub files: u64,
    pub directories: u32,
    pub depth: u32,
    pub file_size: u64,
}

impl FixtureConfig {
    pub fn validate(self) -> io::Result<Self> {
        let entries = self
            .files
            .checked_add(u64::from(self.directories))
            .ok_or_else(invalid_input)?;
        let payload = self
            .files
            .checked_mul(self.file_size)
            .ok_or_else(invalid_input)?;
        if entries == 0
            || entries > MAX_ENTRIES
            || self.depth > self.directories
            || self.depth > MAX_DEPTH
            || payload > MAX_PAYLOAD_BYTES
        {
            return Err(invalid_input());
        }
        Ok(self)
    }
}

fn invalid_input() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "dataset exceeds entry, depth, or payload limits",
    )
}

fn write_file(path: &Path, size: u64) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let block = vec![0x5a; usize::try_from(size.min(64 * 1024)).unwrap_or(0)];
    let mut remaining = size;
    while remaining > 0 {
        let count =
            usize::try_from(remaining.min(block.len() as u64)).map_err(|_| invalid_input())?;
        file.write_all(&block[..count])?;
        remaining -= count as u64;
    }
    Ok(())
}

pub fn generate(root: &Path, config: FixtureConfig) -> io::Result<()> {
    let config = config.validate()?;
    fs::create_dir(root)?;
    let mut current = root.to_path_buf();
    for index in 0..config.depth {
        current = current.join(format!("d{index:04}"));
        fs::create_dir(&current)?;
    }
    for index in config.depth..config.directories {
        fs::create_dir(root.join(format!("directory-{index:08}")))?;
    }
    for index in 0..config.files {
        write_file(&root.join(format!("file-{index:08}.bin")), config.file_size)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_requested_topology_and_refuses_existing_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("dataset");
        let config = FixtureConfig {
            files: 3,
            directories: 3,
            depth: 2,
            file_size: 1024,
        };
        generate(&root, config).unwrap();
        for index in 0..3 {
            assert_eq!(
                root.join(format!("file-{index:08}.bin"))
                    .metadata()
                    .unwrap()
                    .len(),
                1024
            );
        }
        assert!(root.join("d0000/d0001").is_dir());
        assert!(root.join("directory-00000002").is_dir());
        assert_eq!(
            generate(&root, config).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
    }

    #[test]
    fn invalid_configuration_does_not_create_anything() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("dataset");
        assert!(generate(
            &root,
            FixtureConfig {
                files: 0,
                directories: 0,
                depth: 0,
                file_size: 0
            }
        )
        .is_err());
        assert!(!root.exists());
    }
}
