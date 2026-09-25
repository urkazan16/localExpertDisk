//! Deterministic persistence failures for scanner recovery and atomicity tests.
use crate::{DirectoryTask, EntryDraft, ScanSink};
use analyzer::Totals;
use domain::{AppError, ErrorCode, ScanIssue};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersistenceFault {
    DiskFull,
    DatabaseBusy,
}

pub struct FaultInjectingSink<S> {
    inner: S,
    fault: PersistenceFault,
    occurrence: u64,
    writes: u64,
    fired: bool,
}

impl<S> FaultInjectingSink<S> {
    pub fn new(inner: S, fault: PersistenceFault, occurrence: u64) -> Self {
        Self {
            inner,
            fault,
            occurrence: occurrence.max(1),
            writes: 0,
            fired: false,
        }
    }

    pub fn into_inner(self) -> S {
        self.inner
    }

    fn injected_error(&self) -> AppError {
        AppError::new(match self.fault {
            PersistenceFault::DiskFull => ErrorCode::DiskFull,
            PersistenceFault::DatabaseBusy => ErrorCode::DatabaseBusy,
        })
    }
}

impl<S: ScanSink> ScanSink for FaultInjectingSink<S> {
    fn next_directory(&mut self) -> Result<Option<DirectoryTask>, AppError> {
        self.inner.next_directory()
    }

    fn write_batch(
        &mut self,
        parent: i64,
        entries: &[EntryDraft],
        issues: &[ScanIssue],
        totals: Totals,
    ) -> Result<(), AppError> {
        self.writes += 1;
        if !self.fired && self.writes == self.occurrence {
            self.fired = true;
            return Err(self.injected_error());
        }
        self.inner.write_batch(parent, entries, issues, totals)
    }

    fn finish_directory(&mut self, id: i64) -> Result<(), AppError> {
        self.inner.finish_directory(id)
    }
}
