use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{
    MEMORY_LEDGER_SCHEMA_VERSION, MemoryCompactionResult, MemoryCorrectionDisposition, MemoryEvent,
    MemoryInspection, MemoryLedgerFrame, MemoryNonContentReceipt, MemoryObservation,
    MemoryOperation, MemoryOperationResult, MemoryOperationStatus, MemoryProjection,
    MemoryReceiptReason, MemoryScope, MemoryStandingGrant, MemoryStoreLimits,
};

const MEMORY_DIRECTORY: &str = "memory";
const MEMORY_VERSION_DIRECTORY: &str = "v1";
const MEMORY_SCOPES_DIRECTORY: &str = "scopes";
const MEMORY_LEDGER_FILE: &str = "ledger.ndjson";
const MEMORY_PROJECTION_FILE: &str = "projection.json";
const MEMORY_LOCK_FILE: &str = "lock";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryStoreError {
    code: String,
    message: String,
}

impl MemoryStoreError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn code(&self) -> &str {
        &self.code
    }
}

impl std::fmt::Display for MemoryStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for MemoryStoreError {}

struct MemoryStoreLock(File);

impl Drop for MemoryStoreLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

pub struct MemoryStore {
    scope: MemoryScope,
    ledger_path: PathBuf,
    projection_path: PathBuf,
    limits: MemoryStoreLimits,
    frames: Vec<MemoryLedgerFrame>,
    projection: MemoryProjection,
    #[cfg(test)]
    fail_before_rewrite_publish: bool,
    _lock: MemoryStoreLock,
}

impl MemoryStore {
    pub fn open(
        engine_root: impl AsRef<Path>,
        scope: MemoryScope,
        limits: MemoryStoreLimits,
    ) -> Result<Self, MemoryStoreError> {
        limits
            .validate()
            .map_err(|message| MemoryStoreError::new("memory_store_limits_invalid", message))?;
        let scope = scope
            .normalized()
            .map_err(|error| MemoryStoreError::new(error.code(), error.to_string()))?;
        let engine_root = engine_root.as_ref();
        if !engine_root.is_absolute() {
            return Err(MemoryStoreError::new(
                "memory_store_root_invalid",
                "memory engine root must be absolute",
            ));
        }
        fs::create_dir_all(engine_root).map_err(|error| {
            io_error(
                "memory_store_root_create_failed",
                "cannot create memory engine root",
                error,
            )
        })?;
        let engine_root = fs::canonicalize(engine_root).map_err(|error| {
            io_error(
                "memory_store_root_invalid",
                "cannot resolve memory engine root",
                error,
            )
        })?;
        let scopes_root = engine_root
            .join(MEMORY_DIRECTORY)
            .join(MEMORY_VERSION_DIRECTORY)
            .join(MEMORY_SCOPES_DIRECTORY);
        fs::create_dir_all(&scopes_root).map_err(|error| {
            io_error(
                "memory_store_root_create_failed",
                "cannot create memory scope root",
                error,
            )
        })?;
        let scopes_root = fs::canonicalize(&scopes_root).map_err(|error| {
            io_error(
                "memory_store_root_invalid",
                "cannot resolve memory scope root",
                error,
            )
        })?;
        if !path_is_within(&scopes_root, &engine_root) || scopes_root == engine_root {
            return Err(MemoryStoreError::new(
                "memory_store_containment_invalid",
                "memory scope root escapes the configured engine root",
            ));
        }

        let scope_digest = digest_json(&scope)?;
        let directory = scopes_root.join(scope_digest);
        reject_directory_link_if_present(&directory)?;
        fs::create_dir_all(&directory).map_err(|error| {
            io_error(
                "memory_store_scope_create_failed",
                "cannot create memory scope directory",
                error,
            )
        })?;
        let directory = fs::canonicalize(&directory).map_err(|error| {
            io_error(
                "memory_store_scope_invalid",
                "cannot resolve memory scope directory",
                error,
            )
        })?;
        if !path_is_within(&directory, &scopes_root) || directory == scopes_root {
            return Err(MemoryStoreError::new(
                "memory_store_containment_invalid",
                "memory scope directory escapes the scope root",
            ));
        }
        let lock_path = directory.join(MEMORY_LOCK_FILE);
        reject_link_if_present(&lock_path)?;
        let lock_file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|error| {
                io_error(
                    "memory_store_lock_open_failed",
                    "cannot open memory scope lock",
                    error,
                )
            })?;
        lock_file.try_lock().map_err(|_| {
            MemoryStoreError::new(
                "memory_store_lock_busy",
                "memory scope is already being modified; retry shortly",
            )
        })?;
        recover_or_reject_entries(&directory)?;

        let ledger_path = directory.join(MEMORY_LEDGER_FILE);
        let projection_path = directory.join(MEMORY_PROJECTION_FILE);
        reject_link_if_present(&ledger_path)?;
        reject_link_if_present(&projection_path)?;
        let frames = read_frames(&ledger_path, &limits)?;
        let projection = rebuild_projection(&frames, &scope, &limits)?;
        if !projection_matches(&projection_path, &projection, &limits)? {
            write_projection(&projection_path, &projection, &limits)?;
        }

        Ok(Self {
            scope,
            ledger_path,
            projection_path,
            limits,
            frames,
            projection,
            #[cfg(test)]
            fail_before_rewrite_publish: false,
            _lock: MemoryStoreLock(lock_file),
        })
    }

    pub fn apply(
        &mut self,
        operation: MemoryOperation,
    ) -> Result<MemoryOperationResult, MemoryStoreError> {
        let (event, status, as_of_millis, force_rewrite) = match operation {
            MemoryOperation::Remember { observation } => {
                self.ensure_scope(&observation)?;
                (
                    MemoryEvent::ObservationAdmitted {
                        observation: observation.clone(),
                    },
                    MemoryOperationStatus::Admitted,
                    observation.observed_at_millis,
                    false,
                )
            }
            MemoryOperation::Correct {
                target,
                replacement,
                disposition,
                occurred_at_millis,
            } => {
                self.ensure_scope(&replacement)?;
                let force_rewrite = disposition == MemoryCorrectionDisposition::ErasePrevious;
                (
                    MemoryEvent::ObservationCorrected {
                        target,
                        replacement,
                        disposition,
                        occurred_at_millis,
                    },
                    MemoryOperationStatus::Corrected,
                    occurred_at_millis,
                    force_rewrite,
                )
            }
            MemoryOperation::Restore {
                target,
                occurred_at_millis,
            } => (
                MemoryEvent::ObservationRestored {
                    target,
                    occurred_at_millis,
                },
                MemoryOperationStatus::Restored,
                occurred_at_millis,
                false,
            ),
            MemoryOperation::Forget {
                target,
                occurred_at_millis,
            } => (
                MemoryEvent::ObservationForgotten {
                    target,
                    occurred_at_millis,
                },
                MemoryOperationStatus::Forgotten,
                occurred_at_millis,
                false,
            ),
            MemoryOperation::Purge {
                target,
                actor_id,
                purged_at_millis,
            } => {
                self.ensure_operation_actor(&actor_id)?;
                (
                    MemoryEvent::ObservationPurged {
                        target,
                        actor_id,
                        purged_at_millis,
                    },
                    MemoryOperationStatus::Purged,
                    purged_at_millis,
                    true,
                )
            }
            MemoryOperation::ClearRecoveryHistory {
                actor_id,
                cleared_at_millis,
            } => {
                self.ensure_operation_actor(&actor_id)?;
                (
                    MemoryEvent::RecoveryHistoryCleared {
                        actor_id,
                        cleared_at_millis,
                    },
                    MemoryOperationStatus::RecoveryHistoryCleared,
                    cleared_at_millis,
                    true,
                )
            }
            MemoryOperation::SetCaptureMode { grant } => {
                self.ensure_grant_actor(&grant)?;
                let occurred_at_millis = grant.created_at_millis;
                (
                    MemoryEvent::GrantChanged { grant },
                    MemoryOperationStatus::CaptureModeChanged,
                    occurred_at_millis,
                    false,
                )
            }
            MemoryOperation::RevokeGrant {
                grant_id,
                actor_id,
                revoked_at_millis,
            } => (
                MemoryEvent::GrantRevoked {
                    grant_id,
                    actor_id,
                    revoked_at_millis,
                },
                MemoryOperationStatus::GrantRevoked,
                revoked_at_millis,
                false,
            ),
            MemoryOperation::AutoCapture {
                observation,
                grant_id,
                grant_scope,
            } => {
                self.ensure_scope(&observation)?;
                let occurred_at_millis = observation.observed_at_millis;
                (
                    MemoryEvent::ObservationAutoCaptured {
                        observation,
                        grant_id,
                        grant_scope,
                    },
                    MemoryOperationStatus::Admitted,
                    occurred_at_millis,
                    false,
                )
            }
            MemoryOperation::UndoAutoCapture {
                target,
                grant_id,
                actor_id,
                occurred_at_millis,
            } => (
                MemoryEvent::AutoCaptureUndone {
                    target,
                    grant_id,
                    actor_id,
                    occurred_at_millis,
                },
                MemoryOperationStatus::AutoCaptureUndone,
                occurred_at_millis,
                true,
            ),
        };

        let prospective_sequence = self
            .frames
            .last()
            .map_or(1, |frame| frame.sequence.saturating_add(1));
        let mut prospective = self.projection.clone();
        let change = prospective
            .apply(prospective_sequence, &event, &self.limits)
            .map_err(|error| MemoryStoreError::new(error.code, error.message))?;
        if change.unchanged {
            let active = change.active_observation.or_else(|| match &event {
                MemoryEvent::ObservationAdmitted { observation }
                | MemoryEvent::ObservationAutoCaptured { observation, .. } => prospective
                    .active_by_id(&observation.observation_id)
                    .map(|entry| entry.observation.clone()),
                _ => None,
            });
            return self.operation_result(
                MemoryOperationStatus::Unchanged,
                active,
                change.grant,
                None,
                false,
            );
        }

        let pruned = prospective
            .enforce_recovery_limits(as_of_millis, &self.limits)
            .map_err(|error| MemoryStoreError::new(error.code, error.message))?;
        prospective
            .validate_lineage_integrity()
            .map_err(|error| MemoryStoreError::new(error.code, error.message))?;
        let removed = change.erased_records.saturating_add(pruned);
        let privacy_receipt = match &event {
            MemoryEvent::ObservationPurged { actor_id, .. } => {
                Some((actor_id.as_str(), MemoryReceiptReason::MemoryPurged))
            }
            MemoryEvent::RecoveryHistoryCleared { actor_id, .. } => Some((
                actor_id.as_str(),
                MemoryReceiptReason::RecoveryHistoryCleared,
            )),
            _ => None,
        };
        let receipt = if removed > 0 || privacy_receipt.is_some() {
            let receipt = non_content_receipt(
                prospective_sequence,
                as_of_millis,
                &self.scope,
                if let Some((_, reason)) = &privacy_receipt {
                    reason.clone()
                } else if matches!(status, MemoryOperationStatus::AutoCaptureUndone) {
                    MemoryReceiptReason::AutoCaptureUndone
                } else if force_rewrite {
                    MemoryReceiptReason::CorrectionHistoryErased
                } else {
                    MemoryReceiptReason::RecoveryCompacted
                },
                removed,
                privacy_receipt.map(|(actor_id, _)| actor_id),
            )?;
            prospective.receipts.push(receipt.clone());
            Some(receipt)
        } else {
            None
        };
        let active = change.active_observation;
        let grant = change.grant;
        if active.is_none()
            && grant.is_none()
            && !matches!(status, MemoryOperationStatus::AutoCaptureUndone)
            && !matches!(
                status,
                MemoryOperationStatus::Forgotten
                    | MemoryOperationStatus::Purged
                    | MemoryOperationStatus::RecoveryHistoryCleared
            )
        {
            return Err(MemoryStoreError::new(
                "memory_integrity_result_missing",
                "memory transition did not produce an authoritative result",
            ));
        }

        let event_frame = build_frame(
            prospective_sequence,
            self.frames.last().map(|frame| frame.frame_sha256.clone()),
            event.clone(),
            &self.limits,
        )?;
        let encoded_event = encode_frame(&event_frame, &self.limits)?;
        let current_bytes = file_len(&self.ledger_path)?;
        let should_rewrite = force_rewrite
            || pruned > 0
            || current_bytes.saturating_add(encoded_event.len() as u64)
                >= self.limits.compaction_trigger_bytes;

        if should_rewrite {
            #[cfg(test)]
            if self.fail_before_rewrite_publish {
                return Err(MemoryStoreError::new(
                    "memory_store_test_rewrite_failure",
                    "injected failure before memory rewrite publication",
                ));
            }
            let frames = compacted_frames(&prospective, as_of_millis, &self.limits)?;
            rewrite_ledger(&self.ledger_path, &frames, &self.limits)?;
            self.frames = frames;
            prospective.ledger_head_sha256 =
                self.frames.last().map(|frame| frame.frame_sha256.clone());
        } else {
            if current_bytes.saturating_add(encoded_event.len() as u64)
                > self.limits.maximum_ledger_bytes
            {
                return Err(MemoryStoreError::new(
                    "memory_store_ledger_capacity",
                    "memory ledger hard ceiling would be exceeded",
                ));
            }
            append_synced(&self.ledger_path, &encoded_event)?;
            prospective.ledger_head_sha256 = Some(event_frame.frame_sha256.clone());
            self.frames.push(event_frame);
        }
        write_projection(&self.projection_path, &prospective, &self.limits)?;
        self.projection = prospective;
        self.operation_result(status, active, grant, receipt, should_rewrite)
    }

    pub fn inspect(&self, include_recovery: bool) -> MemoryInspection {
        MemoryInspection::from_projection(self.scope.clone(), &self.projection, include_recovery)
    }

    pub fn compact(
        &mut self,
        as_of_millis: i64,
    ) -> Result<MemoryCompactionResult, MemoryStoreError> {
        let mut prospective = self.projection.clone();
        let removed = prospective
            .enforce_recovery_limits(as_of_millis, &self.limits)
            .map_err(|error| MemoryStoreError::new(error.code, error.message))?;
        if removed == 0 {
            return Ok(MemoryCompactionResult {
                schema_version: 1,
                compacted: false,
                removed_recovery_records: 0,
                recovery_count: prospective.recovery.len().try_into().unwrap_or(u32::MAX),
                ledger_head_sha256: prospective.ledger_head_sha256,
            });
        }
        let sequence = self
            .frames
            .last()
            .map_or(1, |frame| frame.sequence.saturating_add(1));
        prospective.receipts.push(non_content_receipt(
            sequence,
            as_of_millis,
            &self.scope,
            MemoryReceiptReason::RecoveryCompacted,
            removed,
            None,
        )?);
        let frames = compacted_frames(&prospective, as_of_millis, &self.limits)?;
        rewrite_ledger(&self.ledger_path, &frames, &self.limits)?;
        self.frames = frames;
        prospective.ledger_head_sha256 = self.frames.last().map(|frame| frame.frame_sha256.clone());
        write_projection(&self.projection_path, &prospective, &self.limits)?;
        self.projection = prospective;
        Ok(MemoryCompactionResult {
            schema_version: 1,
            compacted: true,
            removed_recovery_records: removed,
            recovery_count: self
                .projection
                .recovery
                .len()
                .try_into()
                .unwrap_or(u32::MAX),
            ledger_head_sha256: self.projection.ledger_head_sha256.clone(),
        })
    }

    pub fn rebuild(&mut self) -> Result<MemoryProjection, MemoryStoreError> {
        self.frames = read_frames(&self.ledger_path, &self.limits)?;
        self.projection = rebuild_projection(&self.frames, &self.scope, &self.limits)?;
        write_projection(&self.projection_path, &self.projection, &self.limits)?;
        Ok(self.projection.clone())
    }

    fn operation_result(
        &self,
        status: MemoryOperationStatus,
        active_observation: Option<MemoryObservation>,
        grant: Option<MemoryStandingGrant>,
        receipt: Option<MemoryNonContentReceipt>,
        compacted: bool,
    ) -> Result<MemoryOperationResult, MemoryStoreError> {
        let ledger_head_sha256 = self
            .projection
            .ledger_head_sha256
            .clone()
            .or_else(|| self.frames.last().map(|frame| frame.frame_sha256.clone()))
            .ok_or_else(|| {
                MemoryStoreError::new(
                    "memory_integrity_head_missing",
                    "memory operation completed without a ledger head",
                )
            })?;
        Ok(MemoryOperationResult {
            schema_version: 1,
            status,
            scope: self.scope.clone(),
            active_observation,
            grant,
            receipt,
            active_count: self.projection.active.len().try_into().unwrap_or(u32::MAX),
            recovery_count: self
                .projection
                .recovery
                .len()
                .try_into()
                .unwrap_or(u32::MAX),
            ledger_head_sha256,
            compacted,
        })
    }

    fn ensure_scope(&self, observation: &MemoryObservation) -> Result<(), MemoryStoreError> {
        if observation.scope != self.scope {
            return Err(MemoryStoreError::new(
                "memory_scope_mismatch",
                "memory observation does not match the opened exact scope",
            ));
        }
        Ok(())
    }

    fn ensure_grant_actor(&self, grant: &MemoryStandingGrant) -> Result<(), MemoryStoreError> {
        grant
            .validate_identity()
            .map_err(|error| MemoryStoreError::new(error.code(), error.to_string()))?;
        if !matches!(grant.scope, super::MemoryGrantScope::Repository { .. }) {
            return Err(MemoryStoreError::new(
                "memory_scope_unavailable",
                "Slice 3 standing grants are limited to the current repository",
            ));
        }
        match &self.scope {
            MemoryScope::Developer { actor_id } if actor_id == &grant.actor_id => Ok(()),
            _ => Err(MemoryStoreError::new(
                "memory_admission_actor_mismatch",
                "memory standing grants must be stored in their exact developer scope",
            )),
        }
    }

    fn ensure_operation_actor(&self, actor_id: &str) -> Result<(), MemoryStoreError> {
        if actor_id.trim().is_empty()
            || actor_id.len() > 512
            || actor_id.chars().any(char::is_control)
        {
            return Err(MemoryStoreError::new(
                "memory_admission_actor_invalid",
                "memory actor identity is invalid",
            ));
        }
        if matches!(&self.scope, MemoryScope::Developer { actor_id: scope_actor } if scope_actor != actor_id)
        {
            return Err(MemoryStoreError::new(
                "memory_admission_actor_mismatch",
                "memory operation actor does not match the exact developer scope",
            ));
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameIdentityMaterial<'a> {
    schema_version: u8,
    sequence: u64,
    previous_frame_sha256: &'a Option<String>,
    event: &'a MemoryEvent,
}

fn build_frame(
    sequence: u64,
    previous_frame_sha256: Option<String>,
    event: MemoryEvent,
    limits: &MemoryStoreLimits,
) -> Result<MemoryLedgerFrame, MemoryStoreError> {
    let frame_sha256 = digest_json(&FrameIdentityMaterial {
        schema_version: MEMORY_LEDGER_SCHEMA_VERSION,
        sequence,
        previous_frame_sha256: &previous_frame_sha256,
        event: &event,
    })?;
    let frame = MemoryLedgerFrame {
        schema_version: MEMORY_LEDGER_SCHEMA_VERSION,
        sequence,
        previous_frame_sha256,
        frame_sha256,
        event,
    };
    let _ = encode_frame(&frame, limits)?;
    Ok(frame)
}

fn encode_frame(
    frame: &MemoryLedgerFrame,
    limits: &MemoryStoreLimits,
) -> Result<Vec<u8>, MemoryStoreError> {
    let mut bytes = serde_json::to_vec(frame).map_err(|_| {
        MemoryStoreError::new(
            "memory_store_encoding_failed",
            "memory ledger frame could not be encoded",
        )
    })?;
    if bytes.len() as u64 > limits.maximum_frame_bytes {
        return Err(MemoryStoreError::new(
            "memory_store_frame_capacity",
            "memory ledger frame exceeds its byte ceiling",
        ));
    }
    bytes.push(b'\n');
    Ok(bytes)
}

fn read_frames(
    path: &Path,
    limits: &MemoryStoreLimits,
) -> Result<Vec<MemoryLedgerFrame>, MemoryStoreError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::metadata(path).map_err(|error| {
        io_error(
            "memory_store_ledger_read_failed",
            "cannot inspect memory ledger",
            error,
        )
    })?;
    if !metadata.is_file() || metadata.len() > limits.maximum_ledger_bytes {
        return Err(MemoryStoreError::new(
            "memory_store_ledger_capacity",
            "memory ledger is not a bounded regular file",
        ));
    }
    let bytes = fs::read(path).map_err(|error| {
        io_error(
            "memory_store_ledger_read_failed",
            "cannot read memory ledger",
            error,
        )
    })?;
    if !bytes.is_empty() && !bytes.ends_with(b"\n") {
        return Err(MemoryStoreError::new(
            "memory_integrity_partial_frame",
            "memory ledger ends with a partial frame",
        ));
    }
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    let mut frames = Vec::new();
    let complete = &bytes[..bytes.len() - 1];
    for (index, line) in complete.split(|byte| *byte == b'\n').enumerate() {
        if line.is_empty() || line.len() as u64 > limits.maximum_frame_bytes {
            return Err(MemoryStoreError::new(
                "memory_integrity_frame_size",
                "memory ledger contains an empty or oversized frame",
            ));
        }
        let frame: MemoryLedgerFrame = serde_json::from_slice(line).map_err(|_| {
            MemoryStoreError::new(
                "memory_integrity_frame_json",
                "memory ledger contains invalid frame JSON",
            )
        })?;
        let expected_sequence = u64::try_from(index).unwrap_or(u64::MAX).saturating_add(1);
        let expected_previous = frames
            .last()
            .map(|previous: &MemoryLedgerFrame| previous.frame_sha256.clone());
        if frame.schema_version != MEMORY_LEDGER_SCHEMA_VERSION
            || frame.sequence != expected_sequence
            || frame.previous_frame_sha256 != expected_previous
        {
            return Err(MemoryStoreError::new(
                "memory_integrity_frame_sequence",
                "memory ledger sequence or previous-frame link is invalid",
            ));
        }
        let expected_hash = digest_json(&FrameIdentityMaterial {
            schema_version: frame.schema_version,
            sequence: frame.sequence,
            previous_frame_sha256: &frame.previous_frame_sha256,
            event: &frame.event,
        })?;
        if frame.frame_sha256 != expected_hash {
            return Err(MemoryStoreError::new(
                "memory_integrity_frame_hash",
                "memory ledger frame hash does not match its content",
            ));
        }
        frames.push(frame);
    }
    Ok(frames)
}

fn rebuild_projection(
    frames: &[MemoryLedgerFrame],
    scope: &MemoryScope,
    limits: &MemoryStoreLimits,
) -> Result<MemoryProjection, MemoryStoreError> {
    let mut projection = MemoryProjection::empty();
    let compacted_prefix = frames
        .first()
        .is_some_and(|frame| matches!(frame.event, MemoryEvent::CompactionStarted { .. }));
    let mut prefix_open = compacted_prefix;
    for frame in frames {
        match &frame.event {
            MemoryEvent::CompactionStarted { .. } if frame.sequence != 1 => {
                return Err(MemoryStoreError::new(
                    "memory_integrity_compaction_order",
                    "memory compaction may start only at the first ledger frame",
                ));
            }
            MemoryEvent::CompactedActive { .. }
            | MemoryEvent::CompactedRecovery { .. }
            | MemoryEvent::CompactedReceipt { .. }
            | MemoryEvent::CompactedGrant { .. }
                if !prefix_open =>
            {
                return Err(MemoryStoreError::new(
                    "memory_integrity_compaction_order",
                    "compacted memory entries must form the initial ledger prefix",
                ));
            }
            MemoryEvent::ObservationAdmitted { .. }
            | MemoryEvent::ObservationCorrected { .. }
            | MemoryEvent::ObservationRestored { .. }
            | MemoryEvent::ObservationForgotten { .. }
            | MemoryEvent::ObservationPurged { .. }
            | MemoryEvent::RecoveryHistoryCleared { .. }
            | MemoryEvent::ObservationAutoCaptured { .. }
            | MemoryEvent::AutoCaptureUndone { .. }
            | MemoryEvent::GrantChanged { .. }
            | MemoryEvent::GrantRevoked { .. } => prefix_open = false,
            _ => {}
        }
        projection
            .apply(frame.sequence, &frame.event, limits)
            .map_err(|error| MemoryStoreError::new(error.code, error.message))?;
        projection.ledger_head_sha256 = Some(frame.frame_sha256.clone());
    }
    projection
        .validate_lineage_integrity()
        .map_err(|error| MemoryStoreError::new(error.code, error.message))?;
    if projection
        .active
        .iter()
        .any(|entry| &entry.observation.scope != scope)
        || projection
            .recovery
            .iter()
            .any(|entry| &entry.observation.scope != scope)
    {
        return Err(MemoryStoreError::new(
            "memory_scope_mismatch",
            "memory ledger contains content from another exact scope",
        ));
    }
    if projection.grants.iter().any(|grant| {
        !matches!(scope, MemoryScope::Developer { actor_id } if actor_id == &grant.actor_id)
            || !matches!(grant.scope, super::MemoryGrantScope::Repository { .. })
    }) {
        return Err(MemoryStoreError::new(
            "memory_admission_actor_mismatch",
            "memory ledger contains a standing grant outside its exact developer scope",
        ));
    }
    Ok(projection)
}

fn compacted_frames(
    projection: &MemoryProjection,
    compacted_at_millis: i64,
    limits: &MemoryStoreLimits,
) -> Result<Vec<MemoryLedgerFrame>, MemoryStoreError> {
    let mut events = Vec::with_capacity(
        1usize
            .saturating_add(projection.active.len())
            .saturating_add(projection.recovery.len())
            .saturating_add(projection.receipts.len())
            .saturating_add(projection.grants.len()),
    );
    events.push(MemoryEvent::CompactionStarted {
        compacted_at_millis,
    });
    events.extend(
        projection
            .active
            .iter()
            .cloned()
            .map(|entry| MemoryEvent::CompactedActive { entry }),
    );
    events.extend(
        projection
            .recovery
            .iter()
            .cloned()
            .map(|entry| MemoryEvent::CompactedRecovery { entry }),
    );
    events.extend(
        projection
            .receipts
            .iter()
            .cloned()
            .map(|receipt| MemoryEvent::CompactedReceipt { receipt }),
    );
    events.extend(
        projection
            .grants
            .iter()
            .cloned()
            .map(|grant| MemoryEvent::CompactedGrant { grant }),
    );
    let mut frames = Vec::with_capacity(events.len());
    let mut total_bytes = 0u64;
    for event in events {
        let sequence = u64::try_from(frames.len())
            .unwrap_or(u64::MAX)
            .saturating_add(1);
        let previous = frames
            .last()
            .map(|frame: &MemoryLedgerFrame| frame.frame_sha256.clone());
        let frame = build_frame(sequence, previous, event, limits)?;
        total_bytes = total_bytes.saturating_add(encode_frame(&frame, limits)?.len() as u64);
        if total_bytes > limits.maximum_ledger_bytes {
            return Err(MemoryStoreError::new(
                "memory_store_ledger_capacity",
                "compacted memory ledger exceeds its hard ceiling",
            ));
        }
        frames.push(frame);
    }
    Ok(frames)
}

fn append_synced(path: &Path, bytes: &[u8]) -> Result<(), MemoryStoreError> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| {
            io_error(
                "memory_store_append_failed",
                "cannot open memory ledger for append",
                error,
            )
        })?;
    file.write_all(bytes).map_err(|error| {
        io_error(
            "memory_store_append_failed",
            "cannot append memory ledger frame",
            error,
        )
    })?;
    file.sync_all().map_err(|error| {
        io_error(
            "memory_store_sync_failed",
            "cannot synchronize memory ledger",
            error,
        )
    })
}

fn rewrite_ledger(
    path: &Path,
    frames: &[MemoryLedgerFrame],
    limits: &MemoryStoreLimits,
) -> Result<(), MemoryStoreError> {
    let mut bytes = Vec::new();
    for frame in frames {
        bytes.extend(encode_frame(frame, limits)?);
    }
    if bytes.len() as u64 > limits.maximum_ledger_bytes {
        return Err(MemoryStoreError::new(
            "memory_store_ledger_capacity",
            "rewritten memory ledger exceeds its hard ceiling",
        ));
    }
    atomic_write(path, &bytes, "ledger")
}

fn projection_matches(
    path: &Path,
    expected: &MemoryProjection,
    limits: &MemoryStoreLimits,
) -> Result<bool, MemoryStoreError> {
    if !path.exists() {
        return Ok(false);
    }
    let metadata = fs::metadata(path).map_err(|error| {
        io_error(
            "memory_store_projection_read_failed",
            "cannot inspect memory projection",
            error,
        )
    })?;
    if !metadata.is_file() || metadata.len() > limits.maximum_ledger_bytes {
        return Ok(false);
    }
    let bytes = fs::read(path).map_err(|error| {
        io_error(
            "memory_store_projection_read_failed",
            "cannot read memory projection",
            error,
        )
    })?;
    Ok(serde_json::from_slice::<MemoryProjection>(&bytes)
        .is_ok_and(|projection| projection == *expected))
}

fn write_projection(
    path: &Path,
    projection: &MemoryProjection,
    limits: &MemoryStoreLimits,
) -> Result<(), MemoryStoreError> {
    let mut bytes = serde_json::to_vec_pretty(projection).map_err(|_| {
        MemoryStoreError::new(
            "memory_store_projection_encoding_failed",
            "memory projection could not be encoded",
        )
    })?;
    bytes.push(b'\n');
    if bytes.len() as u64 > limits.maximum_ledger_bytes {
        return Err(MemoryStoreError::new(
            "memory_store_projection_capacity",
            "memory projection exceeds its byte ceiling",
        ));
    }
    atomic_write(path, &bytes, "projection")
}

fn atomic_write(path: &Path, bytes: &[u8], label: &str) -> Result<(), MemoryStoreError> {
    let parent = path.parent().ok_or_else(|| {
        MemoryStoreError::new(
            "memory_store_path_invalid",
            "memory state path has no parent",
        )
    })?;
    let temporary = parent.join(format!(
        ".{label}.{}-{}.tmp",
        std::process::id(),
        temporary_nonce()
    ));
    let result = (|| -> Result<(), MemoryStoreError> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| {
                io_error(
                    "memory_store_temporary_create_failed",
                    "cannot create temporary memory state",
                    error,
                )
            })?;
        file.write_all(bytes).map_err(|error| {
            io_error(
                "memory_store_temporary_write_failed",
                "cannot write temporary memory state",
                error,
            )
        })?;
        file.sync_all().map_err(|error| {
            io_error(
                "memory_store_sync_failed",
                "cannot synchronize temporary memory state",
                error,
            )
        })?;
        if path.exists() {
            replace_file(path, &temporary)?;
        } else {
            fs::rename(&temporary, path).map_err(|error| {
                io_error(
                    "memory_store_publish_failed",
                    "cannot publish memory state",
                    error,
                )
            })?;
        }
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(unix)]
fn replace_file(target: &Path, replacement: &Path) -> Result<(), MemoryStoreError> {
    fs::rename(replacement, target).map_err(|error| {
        io_error(
            "memory_store_publish_failed",
            "cannot atomically replace memory state",
            error,
        )
    })
}

#[cfg(windows)]
fn replace_file(target: &Path, replacement: &Path) -> Result<(), MemoryStoreError> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let target = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    // SAFETY: both paths are owned, NUL-terminated UTF-16 buffers valid for this
    // call and MoveFileExW retains no pointer.
    let result = unsafe {
        MoveFileExW(
            replacement.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(MemoryStoreError::new(
            "memory_store_publish_failed",
            format!(
                "cannot atomically replace memory state: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), MemoryStoreError> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| {
                io_error(
                    "memory_store_sync_failed",
                    "cannot synchronize memory state directory",
                    error,
                )
            })?;
    }
    #[cfg(windows)]
    {
        let _ = path;
    }
    Ok(())
}

fn non_content_receipt(
    sequence: u64,
    performed_at_millis: i64,
    scope: &MemoryScope,
    reason_code: MemoryReceiptReason,
    removed_record_count: u32,
    actor_id: Option<&str>,
) -> Result<MemoryNonContentReceipt, MemoryStoreError> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ReceiptIdentity<'a> {
        schema_version: u8,
        sequence: u64,
        performed_at_millis: i64,
        scope_kind: super::MemoryScopeKind,
        reason_code: &'a MemoryReceiptReason,
        removed_record_count: u32,
        actor_id: Option<&'a str>,
    }
    let material = ReceiptIdentity {
        schema_version: 1,
        sequence,
        performed_at_millis,
        scope_kind: scope.kind(),
        reason_code: &reason_code,
        removed_record_count,
        actor_id,
    };
    Ok(MemoryNonContentReceipt {
        schema_version: 1,
        operation_id: format!("memory_operation:v1:sha256:{}", digest_json(&material)?),
        performed_at_millis,
        actor_id: actor_id.map(str::to_owned),
        purged_at_millis: actor_id.map(|_| performed_at_millis),
        scope_kind: scope.kind(),
        reason_code,
        removed_record_count,
    })
}

fn recover_or_reject_entries(directory: &Path) -> Result<(), MemoryStoreError> {
    for entry in fs::read_dir(directory).map_err(|error| {
        io_error(
            "memory_store_scope_read_failed",
            "cannot inspect memory scope directory",
            error,
        )
    })? {
        let entry = entry.map_err(|error| {
            io_error(
                "memory_store_scope_read_failed",
                "cannot inspect memory scope entry",
                error,
            )
        })?;
        let name = entry.file_name();
        let name = name.to_str().ok_or_else(|| {
            MemoryStoreError::new(
                "memory_store_unexpected_entry",
                "memory scope contains a non-UTF-8 entry",
            )
        })?;
        if matches!(
            name,
            MEMORY_LEDGER_FILE | MEMORY_PROJECTION_FILE | MEMORY_LOCK_FILE
        ) {
            continue;
        }
        if name.starts_with(".ledger.") || name.starts_with(".projection.") {
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
                io_error(
                    "memory_store_scope_read_failed",
                    "cannot inspect temporary memory state",
                    error,
                )
            })?;
            if metadata.is_file() && !metadata.file_type().is_symlink() {
                fs::remove_file(entry.path()).map_err(|error| {
                    io_error(
                        "memory_store_temporary_cleanup_failed",
                        "cannot remove abandoned temporary memory state",
                        error,
                    )
                })?;
                continue;
            }
        }
        return Err(MemoryStoreError::new(
            "memory_store_unexpected_entry",
            "memory scope contains an unexpected entry",
        ));
    }
    Ok(())
}

fn reject_link_if_present(path: &Path) -> Result<(), MemoryStoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(MemoryStoreError::new(
            "memory_store_link_rejected",
            "memory state files must not be symbolic links",
        )),
        Ok(metadata) if !metadata.is_file() => Err(MemoryStoreError::new(
            "memory_store_entry_invalid",
            "memory state entry must be a regular file",
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(
            "memory_store_entry_invalid",
            "cannot inspect memory state entry",
            error,
        )),
    }
}

fn reject_directory_link_if_present(path: &Path) -> Result<(), MemoryStoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(MemoryStoreError::new(
            "memory_store_link_rejected",
            "memory scope directories must not be symbolic links",
        )),
        Ok(metadata) if !metadata.is_dir() => Err(MemoryStoreError::new(
            "memory_store_entry_invalid",
            "memory scope entry must be a directory",
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(
            "memory_store_entry_invalid",
            "cannot inspect memory scope directory",
            error,
        )),
    }
}

fn file_len(path: &Path) -> Result<u64, MemoryStoreError> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(io_error(
            "memory_store_ledger_read_failed",
            "cannot inspect memory ledger length",
            error,
        )),
    }
}

fn digest_json(value: &impl Serialize) -> Result<String, MemoryStoreError> {
    let bytes = serde_json::to_vec(value).map_err(|_| {
        MemoryStoreError::new(
            "memory_store_encoding_failed",
            "memory identity material could not be encoded",
        )
    })?;
    Ok(digest_bytes(&bytes))
}

fn digest_bytes(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn temporary_nonce() -> String {
    let mut bytes = [0u8; 8];
    if getrandom::fill(&mut bytes).is_err() {
        bytes = (std::process::id() as u64).to_le_bytes();
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn io_error(code: &'static str, context: &'static str, error: std::io::Error) -> MemoryStoreError {
    MemoryStoreError::new(code, format!("{context}: {error}"))
}

fn path_is_within(candidate: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let candidate = candidate.to_string_lossy().to_lowercase();
        let root = root.to_string_lossy().to_lowercase();
        candidate == root
            || candidate
                .strip_prefix(&root)
                .is_some_and(|suffix| suffix.starts_with('\\') || suffix.starts_with('/'))
    }
    #[cfg(not(windows))]
    {
        candidate == root || candidate.starts_with(root)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        MemoryFreshness, MemoryObservationInput, MemoryObservationRelation, MemoryProvenance,
        MemoryStatementKind, MemorySubjectKind, PreferenceAdmission,
    };

    #[test]
    fn injected_privacy_rewrite_failure_leaves_authoritative_state_restart_safe() {
        let root = std::env::temp_dir().join(format!(
            "forge-memory-rewrite-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let scope = MemoryScope::Repository {
            workspace_id: "workspace:test".to_owned(),
            repository_id: "repository:test".to_owned(),
        };
        let observation = MemoryObservation::new(MemoryObservationInput {
            subject_kind: MemorySubjectKind::RepositoryConvention,
            statement_kind: MemoryStatementKind::ReviewedDecision,
            subject: "privacy boundary".to_owned(),
            statement: "Preserve this memory when rewrite publication fails.".to_owned(),
            scope: scope.clone(),
            provenance: MemoryProvenance::DeveloperStatement {
                run_id: "run:test".to_owned(),
                actor_id: "developer:test".to_owned(),
                source_id: "input:test".to_owned(),
                input_sha256: "a".repeat(64),
                admission: Some(PreferenceAdmission::ExplicitRemember),
            },
            relation: MemoryObservationRelation::Supports,
            confidence: 100,
            observed_at_millis: 10,
            freshness: MemoryFreshness::PersistentUntilReviewed,
        })
        .unwrap();
        let mut store =
            MemoryStore::open(&root, scope.clone(), MemoryStoreLimits::default()).unwrap();
        store
            .apply(MemoryOperation::Remember {
                observation: observation.clone(),
            })
            .unwrap();
        let before = store.inspect(true);
        store.fail_before_rewrite_publish = true;
        let error = store
            .apply(MemoryOperation::Purge {
                target: observation.observation_id,
                actor_id: "developer:test".to_owned(),
                purged_at_millis: 20,
            })
            .unwrap_err();
        assert_eq!(error.code(), "memory_store_test_rewrite_failure");
        assert_eq!(store.inspect(true), before);
        drop(store);
        let reopened = MemoryStore::open(&root, scope, MemoryStoreLimits::default()).unwrap();
        assert_eq!(reopened.inspect(true), before);
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }
}
