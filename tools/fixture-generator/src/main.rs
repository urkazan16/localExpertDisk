//! Small deterministic fixture skeleton. Large benchmark profiles come later.
use std::{
    error::Error,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};

fn generate(root: &Path, files: u32) -> io::Result<()> {
    if !(1..=10_000).contains(&files) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "files must be 1..=10000",
        ));
    }
    // Never reuse or overwrite a user-selected existing directory.
    fs::create_dir(root)?;
    for index in 0..files {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join(format!("file-{index:05}.bin")))?;
        file.write_all(&[0x5a; 1024])?;
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: fixture-generator NEW_DIRECTORY FILE_COUNT (1..10000)".into());
    }
    generate(Path::new(&args[0]), args[1].parse()?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_exact_sizes_and_refuses_existing_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("dataset");
        generate(&root, 3).unwrap();
        assert_eq!(fs::read_dir(&root).unwrap().count(), 3);
        for entry in fs::read_dir(&root).unwrap() {
            assert_eq!(entry.unwrap().metadata().unwrap().len(), 1024);
        }
        assert_eq!(
            generate(&root, 3).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
    }

    #[test]
    fn invalid_count_does_not_create_anything() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("dataset");
        assert!(generate(&root, 0).is_err());
        assert!(!root.exists());
    }
}
