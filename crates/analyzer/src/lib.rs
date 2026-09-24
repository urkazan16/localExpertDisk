//! Checked accumulation independent of storage and transport.
use domain::{AppError, ErrorCode};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Totals {
    pub files: u64,
    pub directories: u64,
    pub symlinks: u64,
    pub skipped: u64,
    pub logical: u64,
    /// None means at least one source object did not expose allocated blocks.
    pub allocated: Option<u64>,
    pub errors: u64,
}

impl Totals {
    pub fn merge(self, other: Self) -> Result<Self, AppError> {
        fn add(a: u64, b: u64) -> Result<u64, AppError> {
            a.checked_add(b)
                .filter(|n| *n <= i64::MAX as u64)
                .ok_or_else(|| AppError::new(ErrorCode::SizeOverflow))
        }
        fn add_optional(a: Option<u64>, b: Option<u64>) -> Result<Option<u64>, AppError> {
            match (a, b) {
                (Some(a), Some(b)) => add(a, b).map(Some),
                _ => Ok(None),
            }
        }
        Ok(Self {
            files: add(self.files, other.files)?,
            directories: add(self.directories, other.directories)?,
            symlinks: add(self.symlinks, other.symlinks)?,
            skipped: add(self.skipped, other.skipped)?,
            logical: add(self.logical, other.logical)?,
            allocated: add_optional(self.allocated, other.allocated)?,
            errors: add(self.errors, other.errors)?,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_size_overflow_instead_of_rounding_or_wrapping() {
        let a = Totals {
            logical: i64::MAX as u64,
            ..Default::default()
        };
        assert_eq!(
            a.merge(Totals {
                logical: 1,
                ..Default::default()
            })
            .unwrap_err()
            .code,
            ErrorCode::SizeOverflow
        );
    }
}
