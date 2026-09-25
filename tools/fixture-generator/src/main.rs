//! Deterministic filesystem datasets for scanner correctness and performance gates.
use std::{
    error::Error,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

const MAX_ENTRIES: u64 = 10_000_000;
const MAX_DEPTH: u32 = 1_024;
const MAX_PAYLOAD_BYTES: u64 = 50 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Config {
    files: u64,
    directories: u32,
    depth: u32,
    file_size: u64,
}

impl Config {
    fn validate(self) -> io::Result<Self> {
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

fn generate(root: &Path, config: Config) -> io::Result<()> {
    let config = config.validate()?;
    // Never reuse or overwrite a user-selected existing directory.
    fs::create_dir(root)?;

    let mut current = root.to_path_buf();
    for index in 0..config.depth {
        current = current.join(format!("deep-{index:04}"));
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

fn parse_u64(value: Option<&String>) -> Result<u64, Box<dyn Error>> {
    value
        .ok_or("missing option value")?
        .parse()
        .map_err(Into::into)
}

fn parse_args(args: &[String]) -> Result<(PathBuf, Config), Box<dyn Error>> {
    if args.len() == 2 && !args[1].starts_with("--") {
        return Ok((
            PathBuf::from(&args[0]),
            Config {
                files: args[1].parse()?,
                directories: 0,
                depth: 0,
                file_size: 1024,
            }
            .validate()?,
        ));
    }
    let root = args.first().ok_or("missing NEW_DIRECTORY")?;
    let mut config = Config {
        files: 0,
        directories: 0,
        depth: 0,
        file_size: 0,
    };
    let mut index = 1;
    while index < args.len() {
        let value = args.get(index + 1);
        match args[index].as_str() {
            "--files" => config.files = parse_u64(value)?,
            "--directories" => config.directories = u32::try_from(parse_u64(value)?)?,
            "--depth" => config.depth = u32::try_from(parse_u64(value)?)?,
            "--file-size" => config.file_size = parse_u64(value)?,
            _ => return Err(format!("unknown option: {}", args[index]).into()),
        }
        index += 2;
    }
    Ok((PathBuf::from(root), config.validate()?))
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let (root, config) = parse_args(&args).map_err(|error| {
        format!(
            "{error}\nusage: fixture-generator NEW_DIRECTORY --files N --directories N --depth N --file-size BYTES"
        )
    })?;
    generate(&root, config)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_requested_topology_and_refuses_existing_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("dataset");
        let config = Config {
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
        assert!(root.join("deep-0000/deep-0001").is_dir());
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
            Config {
                files: 0,
                directories: 0,
                depth: 0,
                file_size: 0,
            }
        )
        .is_err());
        assert!(!root.exists());
    }

    #[test]
    fn parses_legacy_and_gate_profiles() {
        let legacy = vec!["/tmp/fixture".into(), "100".into()];
        assert_eq!(parse_args(&legacy).unwrap().1.files, 100);
        let gate = vec![
            "/tmp/fixture".into(),
            "--files".into(),
            "1000000".into(),
            "--directories".into(),
            "100000".into(),
            "--depth".into(),
            "20".into(),
            "--file-size".into(),
            "0".into(),
        ];
        assert_eq!(
            parse_args(&gate).unwrap().1,
            Config {
                files: 1_000_000,
                directories: 100_000,
                depth: 20,
                file_size: 0,
            }
        );
    }
}
