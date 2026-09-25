use fixture_generator::{generate, FixtureConfig};
use std::{error::Error, path::PathBuf};

fn parse_u64(value: Option<&String>) -> Result<u64, Box<dyn Error>> {
    value
        .ok_or("missing option value")?
        .parse()
        .map_err(Into::into)
}

fn parse_args(args: &[String]) -> Result<(PathBuf, FixtureConfig), Box<dyn Error>> {
    if args.len() == 2 && !args[1].starts_with("--") {
        return Ok((
            PathBuf::from(&args[0]),
            FixtureConfig {
                files: args[1].parse()?,
                directories: 0,
                depth: 0,
                file_size: 1024,
            }
            .validate()?,
        ));
    }
    let root = args.first().ok_or("missing NEW_DIRECTORY")?;
    let mut config = FixtureConfig {
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
    let (root, config) = parse_args(&args).map_err(|error| format!(
        "{error}\nusage: fixture-generator NEW_DIRECTORY --files N --directories N --depth N --file-size BYTES"
    ))?;
    generate(&root, config)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
            FixtureConfig {
                files: 1_000_000,
                directories: 100_000,
                depth: 20,
                file_size: 0
            }
        );
    }
}
