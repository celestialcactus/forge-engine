use serde::{Deserialize, Serialize};

pub const DEFAULT_MAXIMUM_MEMORY_FRAME_BYTES: u64 = 64 * 1024;
pub const DEFAULT_MEMORY_COMPACTION_TRIGGER_BYTES: u64 = 48 * 1024 * 1024;
pub const DEFAULT_MAXIMUM_MEMORY_LEDGER_BYTES: u64 = 64 * 1024 * 1024;
pub const DEFAULT_MAXIMUM_ACTIVE_MEMORY_RECORDS: u32 = 4_096;
pub const DEFAULT_MEMORY_RECOVERY_RETENTION_MILLIS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const DEFAULT_MEMORY_RECOVERY_VERSIONS_PER_LINEAGE: u8 = 5;
pub const DEFAULT_MAXIMUM_MEMORY_RECOVERY_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryStoreLimits {
    pub maximum_frame_bytes: u64,
    pub compaction_trigger_bytes: u64,
    pub maximum_ledger_bytes: u64,
    pub maximum_active_records: u32,
    pub recovery_retention_millis: u64,
    pub recovery_versions_per_lineage: u8,
    pub maximum_recovery_bytes: u64,
}

impl Default for MemoryStoreLimits {
    fn default() -> Self {
        Self {
            maximum_frame_bytes: DEFAULT_MAXIMUM_MEMORY_FRAME_BYTES,
            compaction_trigger_bytes: DEFAULT_MEMORY_COMPACTION_TRIGGER_BYTES,
            maximum_ledger_bytes: DEFAULT_MAXIMUM_MEMORY_LEDGER_BYTES,
            maximum_active_records: DEFAULT_MAXIMUM_ACTIVE_MEMORY_RECORDS,
            recovery_retention_millis: DEFAULT_MEMORY_RECOVERY_RETENTION_MILLIS,
            recovery_versions_per_lineage: DEFAULT_MEMORY_RECOVERY_VERSIONS_PER_LINEAGE,
            maximum_recovery_bytes: DEFAULT_MAXIMUM_MEMORY_RECOVERY_BYTES,
        }
    }
}

impl MemoryStoreLimits {
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        if self.maximum_frame_bytes < 4 * 1024
            || self.compaction_trigger_bytes < self.maximum_frame_bytes
            || self.maximum_ledger_bytes < self.compaction_trigger_bytes
            || self.maximum_active_records == 0
            || self.recovery_versions_per_lineage == 0
            || self.maximum_recovery_bytes < self.maximum_frame_bytes
        {
            return Err("memory store limits are inconsistent");
        }
        Ok(())
    }
}
