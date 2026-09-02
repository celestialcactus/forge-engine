use serde::{Deserialize, Serialize};

use super::{
    MemoryCaptureMode, MemoryGrantId, MemoryGrantScope, MemoryObservation, MemoryObservationId,
    MemoryProjection, MemoryScope, MemoryStandingGrant, ProjectedMemory, RecoveryMemory,
};

pub const MEMORY_LEDGER_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MemoryLineageId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCorrectionDisposition {
    KeepBounded,
    ErasePrevious,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryOperation {
    Remember {
        observation: MemoryObservation,
    },
    Correct {
        target: MemoryObservationId,
        replacement: MemoryObservation,
        disposition: MemoryCorrectionDisposition,
        occurred_at_millis: i64,
    },
    Restore {
        target: MemoryObservationId,
        occurred_at_millis: i64,
    },
    Forget {
        target: MemoryObservationId,
        occurred_at_millis: i64,
    },
    Purge {
        target: MemoryObservationId,
        actor_id: String,
        purged_at_millis: i64,
    },
    ClearRecoveryHistory {
        actor_id: String,
        cleared_at_millis: i64,
    },
    SetCaptureMode {
        grant: MemoryStandingGrant,
    },
    RevokeGrant {
        grant_id: MemoryGrantId,
        actor_id: String,
        revoked_at_millis: i64,
    },
    AutoCapture {
        observation: MemoryObservation,
        grant_id: MemoryGrantId,
        grant_scope: MemoryGrantScope,
    },
    UndoAutoCapture {
        target: MemoryObservationId,
        grant_id: MemoryGrantId,
        actor_id: String,
        occurred_at_millis: i64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryReceiptReason {
    CorrectionHistoryErased,
    RecoveryCompacted,
    AutoCaptureUndone,
    MemoryPurged,
    RecoveryHistoryCleared,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryNonContentReceipt {
    pub schema_version: u8,
    pub operation_id: String,
    pub performed_at_millis: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purged_at_millis: Option<i64>,
    pub scope_kind: super::MemoryScopeKind,
    pub reason_code: MemoryReceiptReason,
    pub removed_record_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryEvent {
    ObservationAdmitted {
        observation: MemoryObservation,
    },
    ObservationCorrected {
        target: MemoryObservationId,
        replacement: MemoryObservation,
        disposition: MemoryCorrectionDisposition,
        occurred_at_millis: i64,
    },
    ObservationRestored {
        target: MemoryObservationId,
        occurred_at_millis: i64,
    },
    ObservationForgotten {
        target: MemoryObservationId,
        occurred_at_millis: i64,
    },
    ObservationPurged {
        target: MemoryObservationId,
        actor_id: String,
        purged_at_millis: i64,
    },
    RecoveryHistoryCleared {
        actor_id: String,
        cleared_at_millis: i64,
    },
    GrantChanged {
        grant: MemoryStandingGrant,
    },
    GrantRevoked {
        grant_id: MemoryGrantId,
        actor_id: String,
        revoked_at_millis: i64,
    },
    ObservationAutoCaptured {
        observation: MemoryObservation,
        grant_id: MemoryGrantId,
        grant_scope: MemoryGrantScope,
    },
    AutoCaptureUndone {
        target: MemoryObservationId,
        grant_id: MemoryGrantId,
        actor_id: String,
        occurred_at_millis: i64,
    },
    CompactionStarted {
        compacted_at_millis: i64,
    },
    CompactedActive {
        entry: ProjectedMemory,
    },
    CompactedRecovery {
        entry: RecoveryMemory,
    },
    CompactedReceipt {
        receipt: MemoryNonContentReceipt,
    },
    CompactedGrant {
        grant: MemoryStandingGrant,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryLedgerFrame {
    pub schema_version: u8,
    pub sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_frame_sha256: Option<String>,
    pub frame_sha256: String,
    pub event: MemoryEvent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryOperationStatus {
    Admitted,
    Corrected,
    Restored,
    Forgotten,
    Purged,
    RecoveryHistoryCleared,
    Unchanged,
    CaptureModeChanged,
    GrantRevoked,
    AutoCaptureUndone,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryOperationResult {
    pub schema_version: u8,
    pub status: MemoryOperationStatus,
    pub scope: MemoryScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_observation: Option<MemoryObservation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant: Option<MemoryStandingGrant>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receipt: Option<MemoryNonContentReceipt>,
    pub active_count: u32,
    pub recovery_count: u32,
    pub ledger_head_sha256: String,
    pub compacted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryInspection {
    pub schema_version: u8,
    pub scope: MemoryScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ledger_head_sha256: Option<String>,
    pub active: Vec<super::ProjectedMemory>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recovery: Vec<super::RecoveryMemory>,
    pub active_count: u32,
    pub recovery_count: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grants: Vec<MemoryStandingGrant>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCompactionResult {
    pub schema_version: u8,
    pub compacted: bool,
    pub removed_recovery_records: u32,
    pub recovery_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ledger_head_sha256: Option<String>,
}

impl MemoryInspection {
    pub(crate) fn from_projection(
        scope: MemoryScope,
        projection: &MemoryProjection,
        include_recovery: bool,
    ) -> Self {
        Self {
            schema_version: 1,
            scope,
            ledger_head_sha256: projection.ledger_head_sha256.clone(),
            active: projection.active.clone(),
            recovery: if include_recovery {
                projection.recovery.clone()
            } else {
                Vec::new()
            },
            active_count: projection.active.len().try_into().unwrap_or(u32::MAX),
            recovery_count: projection.recovery.len().try_into().unwrap_or(u32::MAX),
            grants: projection.grants.clone(),
        }
    }
}

impl MemoryInspection {
    pub fn capture_mode_for(&self, scope: &MemoryGrantScope) -> MemoryCaptureMode {
        self.grants
            .iter()
            .find(|grant| grant.scope == *scope && grant.revoked_at_millis.is_none())
            .map_or(MemoryCaptureMode::Ask, |grant| grant.mode.clone())
    }
}
