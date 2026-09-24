use std::{
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}
impl EntryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Directory => "directory",
            Self::Symlink => "symlink",
            Self::Other => "other",
        }
    }
}
#[derive(Debug, Clone)]
pub struct EntryMetadata {
    pub kind: EntryKind,
    pub logical_size: u64,
    pub identity: Option<String>,
}
pub type DirectoryEntries = Box<dyn Iterator<Item = io::Result<PathBuf>> + Send>;
pub trait FileSystemProvider: Send + Sync {
    fn metadata(&self, path: &Path) -> io::Result<EntryMetadata>;
    fn read_directory(&self, path: &Path) -> io::Result<DirectoryEntries>;
}
pub struct NativeFileSystem;
impl FileSystemProvider for NativeFileSystem {
    fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
        let metadata = fs::symlink_metadata(path)?;
        let link = metadata.file_type().is_symlink();
        #[cfg(windows)]
        let link = {
            use std::os::windows::fs::MetadataExt;
            link || metadata.file_attributes() & 0x400 != 0
        };
        let kind = if link {
            EntryKind::Symlink
        } else if metadata.is_dir() {
            EntryKind::Directory
        } else if metadata.is_file() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::MetadataExt;
            Some(format!("{}:{}", metadata.dev(), metadata.ino()))
        };
        #[cfg(not(unix))]
        let identity = None;
        Ok(EntryMetadata {
            kind,
            logical_size: if kind == EntryKind::File {
                metadata.len()
            } else {
                0
            },
            identity,
        })
    }
    fn read_directory(&self, path: &Path) -> io::Result<DirectoryEntries> {
        Ok(Box::new(
            fs::read_dir(path)?.map(|entry| entry.map(|entry| entry.path())),
        ))
    }
}

#[cfg(unix)]
pub fn encode_path(path: &Path) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    path.as_os_str().as_bytes().to_vec()
}
#[cfg(unix)]
pub fn decode_path(bytes: Vec<u8>) -> io::Result<PathBuf> {
    use std::os::unix::ffi::OsStringExt;
    Ok(PathBuf::from(OsString::from_vec(bytes)))
}
#[cfg(windows)]
pub fn encode_path(path: &Path) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect()
}
#[cfg(windows)]
pub fn decode_path(bytes: Vec<u8>) -> io::Result<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    if !bytes.len().is_multiple_of(2) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid UTF-16 path",
        ));
    }
    let words: Vec<_> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    Ok(PathBuf::from(OsString::from_wide(&words)))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::ffi::OsStringExt;
    #[test]
    fn native_path_codec_preserves_non_utf8_bytes() {
        let path = PathBuf::from(OsString::from_vec(vec![b'/', b'x', 0xff]));
        assert_eq!(decode_path(encode_path(&path)).unwrap(), path);
    }
}
