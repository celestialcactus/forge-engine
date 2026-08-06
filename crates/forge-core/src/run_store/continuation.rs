use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{RunLedgerRequest, encode_json, read_bounded, sync_directory, write_new_synced};

pub const CONTINUATION_SCHEMA_VERSION: u8 = 2;
const LEGACY_CONTINUATION_SCHEMA_VERSION: u8 = 1;
const MAX_CONTINUATION_MANIFEST_BYTES: u64 = 2 * 1_048_576;
const MAX_INTERACTION_FRAME_BYTES: usize = 16 * 1_048_576;
const MAX_INTERACTION_LEDGER_BYTES: u64 = 128 * 1_048_576;
const MAX_INTERACTION_FRAMES: usize = 2_048;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityReplaySafety {
    ReadOnlyRetryable,
    NonIdempotent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityDescriptor {
    pub id: String,
    pub replay_safety: CapabilityReplaySafety,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunInteractionKind {
    Planner,
    Approval,
    Capability,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionReplaySafety {
    NeverRetry,
    ReadOnlyRetryable,
    NonIdempotent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RunInteractionPhase {
    Intent,
    Checkpoint,
    Completed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RunRecoveryCheckpoint {
    ChangeSetTransaction {
        schema_version: u8,
        change_set_id: String,
        transaction_id: String,
        phase: ChangeSetRecoveryPhase,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeSetRecoveryPhase {
    Registered,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunInteractionFrame {
    schema_version: u8,
    sequence: u64,
    interaction_id: String,
    kind: RunInteractionKind,
    attempt: u32,
    replay_safety: InteractionReplaySafety,
    phase: RunInteractionPhase,
    payload_sha256: String,
    payload: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunContinuationManifest {
    schema_version: u8,
    run_id: String,
    bridge_protocol_version: String,
    capability_descriptors: Vec<CapabilityDescriptor>,
    manifest_sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunContinuationManifestSubject<'a> {
    schema_version: u8,
    run_id: &'a str,
    bridge_protocol_version: &'a str,
    capability_descriptors: &'a [CapabilityDescriptor],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunContinuationDisposition {
    Terminal,
    SafeBoundary,
    RetryableCapability,
    BlockedAmbiguousPlanner,
    BlockedAmbiguousApproval,
    BlockedNonIdempotent,
    BlockedRetryExhausted,
    BlockedPlannerCheckpointUnavailable,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunContinuationInspection {
    pub schema_version: u8,
    pub disposition: RunContinuationDisposition,
    pub interaction_frame_count: u32,
    pub completed_interaction_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_interaction_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_kind: Option<RunInteractionKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_replay_safety: Option<InteractionReplaySafety>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_recovery_checkpoint: Option<RunRecoveryCheckpoint>,
    pub capability_descriptors: Vec<CapabilityDescriptor>,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RecordedRunInteraction {
    pub interaction_id: String,
    pub kind: RunInteractionKind,
    pub replay_safety: InteractionReplaySafety,
    pub intent_payload: Value,
    pub recovery_checkpoint: Option<RunRecoveryCheckpoint>,
    pub completion_payload: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RunContinuationReplay {
    pub inspection: RunContinuationInspection,
    pub interactions: Vec<RecordedRunInteraction>,
    pub planner_checkpoint: Option<Value>,
}

#[derive(Clone)]
struct PendingInteraction {
    interaction_id: String,
    kind: RunInteractionKind,
    attempt: u32,
    replay_safety: InteractionReplaySafety,
    intent_payload: Value,
    recovery_checkpoint: Option<RunRecoveryCheckpoint>,
}

pub(super) struct ContinuationWriter {
    file: File,
    schema_version: u8,
    next_sequence: u64,
    pending: Option<PendingInteraction>,
}

#[derive(Clone)]
pub(super) struct ValidatedContinuation {
    schema_version: u8,
    capability_descriptors: Vec<CapabilityDescriptor>,
    frame_count: u32,
    completed_count: u32,
    last_sequence: Option<u64>,
    pending: Option<PendingInteraction>,
    interactions: Vec<RecordedRunInteraction>,
    latest_planner_turn_seen: bool,
    latest_planner_checkpoint: Option<Value>,
}

pub(super) fn normalize_capability_descriptors(
    descriptors: &[CapabilityDescriptor],
) -> Result<Vec<CapabilityDescriptor>, String> {
    let mut normalized = descriptors.to_vec();
    normalized.sort_by(|left, right| left.id.cmp(&right.id));
    if normalized
        .iter()
        .any(|descriptor| descriptor.id.trim().is_empty() || descriptor.id.len() > 512)
    {
        return Err(
            "Run continuation capability IDs must contain from 1 to 512 characters.".to_owned(),
        );
    }
    if normalized.windows(2).any(|pair| pair[0].id == pair[1].id) {
        return Err("Run continuation capability IDs must be unique.".to_owned());
    }
    Ok(normalized)
}

pub(super) fn create_continuation(
    directory: &Path,
    run_id: &str,
    bridge_protocol_version: &str,
    descriptors: &[CapabilityDescriptor],
) -> Result<ContinuationWriter, String> {
    let capability_descriptors = normalize_capability_descriptors(descriptors)?;
    let subject = RunContinuationManifestSubject {
        schema_version: CONTINUATION_SCHEMA_VERSION,
        run_id,
        bridge_protocol_version,
        capability_descriptors: &capability_descriptors,
    };
    let subject_bytes = encode_json(&subject, "run continuation manifest identity")?;
    let manifest = RunContinuationManifest {
        schema_version: CONTINUATION_SCHEMA_VERSION,
        run_id: run_id.to_owned(),
        bridge_protocol_version: bridge_protocol_version.to_owned(),
        capability_descriptors,
        manifest_sha256: crate::change_set_v2::sha256(&subject_bytes),
    };
    let manifest_bytes = encode_json(&manifest, "run continuation manifest")?;
    if manifest_bytes.len() as u64 > MAX_CONTINUATION_MANIFEST_BYTES {
        return Err("Run continuation manifest exceeds the configured byte limit.".to_owned());
    }
    write_new_synced(&directory.join("continuation.json"), &manifest_bytes)
        .map_err(|error| format!("Cannot persist run continuation manifest: {error}"))?;
    let file = OpenOptions::new()
        .create_new(true)
        .append(true)
        .open(directory.join("interactions.jsonl"))
        .map_err(|error| format!("Cannot create run interaction ledger: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Cannot sync run interaction ledger: {error}"))?;
    sync_directory(directory)?;
    Ok(ContinuationWriter {
        file,
        schema_version: CONTINUATION_SCHEMA_VERSION,
        next_sequence: 1,
        pending: None,
    })
}

pub(super) fn resume_continuation(
    directory: &Path,
    validated: &ValidatedContinuation,
) -> Result<ContinuationWriter, String> {
    let file = OpenOptions::new()
        .append(true)
        .open(directory.join("interactions.jsonl"))
        .map_err(|error| format!("Cannot reopen run interaction ledger: {error}"))?;
    Ok(ContinuationWriter {
        file,
        schema_version: validated.schema_version,
        next_sequence: validated.last_sequence.unwrap_or(0).saturating_add(1),
        pending: validated.pending.clone(),
    })
}

impl ContinuationWriter {
    pub(super) fn record_intent(
        &mut self,
        interaction_id: &str,
        kind: RunInteractionKind,
        replay_safety: InteractionReplaySafety,
        payload: Value,
    ) -> Result<(), String> {
        if self.pending.is_some() {
            return Err("Run interaction ledger cannot open a second interaction.".to_owned());
        }
        if interaction_id.trim().is_empty() || interaction_id.len() > 512 {
            return Err("Run interaction ID must contain from 1 to 512 characters.".to_owned());
        }
        validate_kind_safety(&kind, &replay_safety)?;
        if !payload.is_object() {
            return Err("Run interaction intent payload must be a JSON object.".to_owned());
        }
        let pending = PendingInteraction {
            interaction_id: interaction_id.to_owned(),
            kind: kind.clone(),
            attempt: 1,
            replay_safety: replay_safety.clone(),
            intent_payload: payload.clone(),
            recovery_checkpoint: None,
        };
        self.append_frame(
            interaction_id,
            kind,
            1,
            replay_safety,
            RunInteractionPhase::Intent,
            payload,
        )?;
        self.pending = Some(pending);
        Ok(())
    }

    pub(super) fn record_retry_intent(
        &mut self,
        interaction_id: &str,
        kind: RunInteractionKind,
        replay_safety: InteractionReplaySafety,
        payload: Value,
    ) -> Result<(), String> {
        let previous = self
            .pending
            .clone()
            .ok_or_else(|| "Run interaction retry has no unresolved durable intent.".to_owned())?;
        if previous.interaction_id != interaction_id
            || previous.kind != kind
            || previous.replay_safety != InteractionReplaySafety::ReadOnlyRetryable
            || replay_safety != InteractionReplaySafety::ReadOnlyRetryable
            || previous.intent_payload != payload
        {
            return Err(
                "Run interaction retry does not match an unresolved read-only intent.".to_owned(),
            );
        }
        if previous.attempt != 1 {
            return Err("Run interaction has already consumed its one retry.".to_owned());
        }
        let attempt = 2;
        self.append_frame(
            interaction_id,
            kind.clone(),
            attempt,
            replay_safety.clone(),
            RunInteractionPhase::Intent,
            payload.clone(),
        )?;
        self.pending = Some(PendingInteraction {
            interaction_id: interaction_id.to_owned(),
            kind,
            attempt,
            replay_safety,
            intent_payload: payload,
            recovery_checkpoint: None,
        });
        Ok(())
    }

    pub(super) fn record_checkpoint(
        &mut self,
        interaction_id: &str,
        checkpoint: RunRecoveryCheckpoint,
    ) -> Result<(), String> {
        if self.schema_version < CONTINUATION_SCHEMA_VERSION {
            return Err("Legacy run continuations cannot accept recovery checkpoints.".to_owned());
        }
        let pending = self.pending.as_ref().ok_or_else(|| {
            "Run recovery checkpoint has no durable interaction intent.".to_owned()
        })?;
        if pending.interaction_id != interaction_id
            || pending.kind != RunInteractionKind::Capability
            || pending.replay_safety != InteractionReplaySafety::NonIdempotent
        {
            return Err(
                "Run recovery checkpoint does not match a pending non-idempotent capability."
                    .to_owned(),
            );
        }
        if pending.recovery_checkpoint.is_some() {
            return Err("Run interaction already has a recovery checkpoint.".to_owned());
        }
        validate_recovery_checkpoint(&checkpoint)?;
        let payload = serde_json::to_value(&checkpoint)
            .map_err(|error| format!("Cannot encode run recovery checkpoint: {error}"))?;
        self.append_frame(
            interaction_id,
            RunInteractionKind::Capability,
            pending.attempt,
            InteractionReplaySafety::NonIdempotent,
            RunInteractionPhase::Checkpoint,
            payload,
        )?;
        self.pending
            .as_mut()
            .expect("pending recovery interaction was validated")
            .recovery_checkpoint = Some(checkpoint);
        Ok(())
    }

    pub(super) fn record_completion(
        &mut self,
        interaction_id: &str,
        kind: RunInteractionKind,
        payload: Value,
    ) -> Result<(), String> {
        let pending = self
            .pending
            .clone()
            .ok_or_else(|| "Run interaction completion has no durable intent.".to_owned())?;
        if pending.interaction_id != interaction_id || pending.kind != kind {
            return Err("Run interaction completion does not match its durable intent.".to_owned());
        }
        if !payload.is_object() {
            return Err("Run interaction completion payload must be a JSON object.".to_owned());
        }
        self.append_frame(
            interaction_id,
            kind,
            pending.attempt,
            pending.replay_safety,
            RunInteractionPhase::Completed,
            payload,
        )?;
        self.pending = None;
        Ok(())
    }

    fn append_frame(
        &mut self,
        interaction_id: &str,
        kind: RunInteractionKind,
        attempt: u32,
        replay_safety: InteractionReplaySafety,
        phase: RunInteractionPhase,
        payload: Value,
    ) -> Result<(), String> {
        if self.next_sequence as usize > MAX_INTERACTION_FRAMES {
            return Err("Run interaction ledger exceeds the configured frame limit.".to_owned());
        }
        let payload_bytes = encode_json(&payload, "run interaction payload")?;
        let frame = RunInteractionFrame {
            schema_version: self.schema_version,
            sequence: self.next_sequence,
            interaction_id: interaction_id.to_owned(),
            kind,
            attempt,
            replay_safety,
            phase,
            payload_sha256: crate::change_set_v2::sha256(&payload_bytes),
            payload,
        };
        let mut frame_bytes = encode_json(&frame, "run interaction frame")?;
        if frame_bytes.len() > MAX_INTERACTION_FRAME_BYTES {
            return Err("Run interaction frame exceeds the configured byte limit.".to_owned());
        }
        frame_bytes.push(b'\n');
        let current_bytes = self
            .file
            .metadata()
            .map_err(|error| format!("Cannot inspect run interaction ledger: {error}"))?
            .len();
        if current_bytes.saturating_add(frame_bytes.len() as u64) > MAX_INTERACTION_LEDGER_BYTES {
            return Err("Run interaction ledger exceeds the configured byte limit.".to_owned());
        }
        self.file
            .write_all(&frame_bytes)
            .and_then(|()| self.file.sync_all())
            .map_err(|error| format!("Cannot durably append run interaction frame: {error}"))?;
        self.next_sequence = self.next_sequence.saturating_add(1);
        Ok(())
    }
}

fn validate_recovery_checkpoint(checkpoint: &RunRecoveryCheckpoint) -> Result<(), String> {
    let RunRecoveryCheckpoint::ChangeSetTransaction {
        schema_version,
        change_set_id,
        transaction_id,
        phase: _,
    } = checkpoint;
    if *schema_version != 1
        || !valid_digest_identifier(change_set_id, "changeset:sha256:")
        || !valid_digest_identifier(transaction_id, "transaction:sha256:")
    {
        return Err(
            "Run recovery checkpoint contains an invalid ChangeSet transaction identity."
                .to_owned(),
        );
    }
    Ok(())
}

fn valid_digest_identifier(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|digest| {
        digest.len() == 64
            && digest
                .as_bytes()
                .iter()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    })
}

fn validate_kind_safety(
    kind: &RunInteractionKind,
    replay_safety: &InteractionReplaySafety,
) -> Result<(), String> {
    match (kind, replay_safety) {
        (
            RunInteractionKind::Planner | RunInteractionKind::Approval,
            InteractionReplaySafety::NeverRetry,
        )
        | (
            RunInteractionKind::Capability,
            InteractionReplaySafety::ReadOnlyRetryable | InteractionReplaySafety::NonIdempotent,
        ) => Ok(()),
        _ => Err("Run interaction kind has an invalid replay-safety classification.".to_owned()),
    }
}

pub(super) fn read_continuation(
    directory: &Path,
    request: &RunLedgerRequest,
) -> Result<Option<ValidatedContinuation>, String> {
    let manifest_path = directory.join("continuation.json");
    let interactions_path = directory.join("interactions.jsonl");
    if !manifest_path.exists() {
        if interactions_path.exists() {
            return Err(
                "Run interaction ledger exists without a continuation manifest.".to_owned(),
            );
        }
        return Ok(None);
    }
    if !interactions_path.exists() {
        return Err("Run continuation manifest exists without an interaction ledger.".to_owned());
    }
    let manifest: RunContinuationManifest = super::read_bounded_json(
        &manifest_path,
        MAX_CONTINUATION_MANIFEST_BYTES,
        "run continuation manifest",
    )?;
    validate_manifest(&manifest, request)?;
    let bytes = read_bounded(
        &interactions_path,
        MAX_INTERACTION_LEDGER_BYTES,
        "run interaction ledger",
    )?;
    if !bytes.is_empty() && bytes.last() != Some(&b'\n') {
        return Err("Run interaction ledger ends with a partial frame.".to_owned());
    }
    let mut pending: Option<PendingInteraction> = None;
    let mut interactions = Vec::<RecordedRunInteraction>::new();
    let mut frame_count = 0_u32;
    let mut completed_count = 0_u32;
    let mut latest_planner_turn_seen = false;
    let mut latest_planner_checkpoint = None;
    if !bytes.is_empty() {
        for encoded in bytes[..bytes.len() - 1].split(|byte| *byte == b'\n') {
            if encoded.len() > MAX_INTERACTION_FRAME_BYTES {
                return Err("Run interaction frame exceeds the configured byte limit.".to_owned());
            }
            if frame_count as usize >= MAX_INTERACTION_FRAMES {
                return Err("Run interaction ledger exceeds the configured frame limit.".to_owned());
            }
            let frame: RunInteractionFrame = serde_json::from_slice(encoded).map_err(|error| {
                format!("Run interaction ledger contains invalid JSON: {error}")
            })?;
            let expected_sequence = u64::from(frame_count) + 1;
            if frame.schema_version != manifest.schema_version
                || frame.sequence != expected_sequence
            {
                return Err(format!(
                    "Run interaction ledger schema or sequence is invalid at frame {expected_sequence}."
                ));
            }
            if frame.interaction_id.trim().is_empty() || frame.interaction_id.len() > 512 {
                return Err("Run interaction ledger contains an invalid interaction ID.".to_owned());
            }
            validate_kind_safety(&frame.kind, &frame.replay_safety)?;
            if !frame.payload.is_object() {
                return Err("Run interaction ledger payload must be a JSON object.".to_owned());
            }
            let payload_bytes = encode_json(&frame.payload, "run interaction payload")?;
            if crate::change_set_v2::sha256(&payload_bytes) != frame.payload_sha256 {
                return Err(
                    "Run interaction payload digest does not match its contents.".to_owned(),
                );
            }
            match frame.phase {
                RunInteractionPhase::Intent => {
                    if let Some(previous) = &pending {
                        let retry_is_valid = previous.interaction_id == frame.interaction_id
                            && previous.kind == RunInteractionKind::Capability
                            && frame.kind == RunInteractionKind::Capability
                            && previous.replay_safety == InteractionReplaySafety::ReadOnlyRetryable
                            && frame.replay_safety == InteractionReplaySafety::ReadOnlyRetryable
                            && previous.attempt == 1
                            && frame.attempt == 2
                            && frame.payload == previous.intent_payload;
                        if !retry_is_valid {
                            return Err(
                                "Run interaction ledger contains an invalid retry transition."
                                    .to_owned(),
                            );
                        }
                    } else {
                        if frame.attempt != 1 {
                            return Err(
                                "Run interaction ledger contains an invalid intent transition."
                                    .to_owned(),
                            );
                        }
                        interactions.push(RecordedRunInteraction {
                            interaction_id: frame.interaction_id.clone(),
                            kind: frame.kind.clone(),
                            replay_safety: frame.replay_safety.clone(),
                            intent_payload: frame.payload.clone(),
                            recovery_checkpoint: None,
                            completion_payload: None,
                        });
                    }
                    pending = Some(PendingInteraction {
                        interaction_id: frame.interaction_id,
                        kind: frame.kind,
                        attempt: frame.attempt,
                        replay_safety: frame.replay_safety,
                        intent_payload: frame.payload,
                        recovery_checkpoint: None,
                    });
                }
                RunInteractionPhase::Checkpoint => {
                    if manifest.schema_version < CONTINUATION_SCHEMA_VERSION {
                        return Err(
                            "Legacy run continuation contains a recovery checkpoint.".to_owned()
                        );
                    }
                    let intent = pending.as_mut().ok_or_else(|| {
                        "Run recovery checkpoint has no preceding intent.".to_owned()
                    })?;
                    if intent.interaction_id != frame.interaction_id
                        || intent.kind != RunInteractionKind::Capability
                        || frame.kind != RunInteractionKind::Capability
                        || intent.attempt != frame.attempt
                        || intent.replay_safety != InteractionReplaySafety::NonIdempotent
                        || frame.replay_safety != InteractionReplaySafety::NonIdempotent
                        || intent.recovery_checkpoint.is_some()
                    {
                        return Err("Run recovery checkpoint does not match its pending non-idempotent capability.".to_owned());
                    }
                    let checkpoint: RunRecoveryCheckpoint = serde_json::from_value(frame.payload)
                        .map_err(|error| {
                        format!("Run recovery checkpoint is invalid: {error}")
                    })?;
                    validate_recovery_checkpoint(&checkpoint)?;
                    intent.recovery_checkpoint = Some(checkpoint.clone());
                    let recorded = interactions.last_mut().ok_or_else(|| {
                        "Run recovery checkpoint has no logical interaction.".to_owned()
                    })?;
                    if recorded.interaction_id != frame.interaction_id
                        || recorded.recovery_checkpoint.is_some()
                        || recorded.completion_payload.is_some()
                    {
                        return Err(
                            "Run recovery checkpoint does not match its logical interaction."
                                .to_owned(),
                        );
                    }
                    recorded.recovery_checkpoint = Some(checkpoint);
                }
                RunInteractionPhase::Completed => {
                    let intent = pending.as_ref().ok_or_else(|| {
                        "Run interaction completion has no preceding intent.".to_owned()
                    })?;
                    if intent.interaction_id != frame.interaction_id
                        || intent.kind != frame.kind
                        || intent.attempt != frame.attempt
                        || intent.replay_safety != frame.replay_safety
                    {
                        return Err(
                            "Run interaction completion does not match its intent.".to_owned()
                        );
                    }
                    let recorded = interactions.last_mut().ok_or_else(|| {
                        "Run interaction completion has no logical interaction.".to_owned()
                    })?;
                    if recorded.interaction_id != frame.interaction_id
                        || recorded.completion_payload.is_some()
                    {
                        return Err(
                            "Run interaction completion does not match its logical interaction."
                                .to_owned(),
                        );
                    }
                    recorded.completion_payload = Some(frame.payload.clone());
                    if frame.kind == RunInteractionKind::Planner
                        && frame.payload.get("type").and_then(Value::as_str) == Some("planner.turn")
                    {
                        latest_planner_turn_seen = true;
                        latest_planner_checkpoint =
                            if validate_planner_checkpoint(frame.payload.get("plannerCheckpoint"))?
                            {
                                frame.payload.get("plannerCheckpoint").cloned()
                            } else {
                                None
                            };
                    }
                    pending = None;
                    completed_count = completed_count.saturating_add(1);
                }
            }
            frame_count = frame_count.saturating_add(1);
        }
    }
    Ok(Some(ValidatedContinuation {
        schema_version: manifest.schema_version,
        capability_descriptors: manifest.capability_descriptors,
        frame_count,
        completed_count,
        last_sequence: (frame_count > 0).then_some(u64::from(frame_count)),
        pending,
        interactions,
        latest_planner_turn_seen,
        latest_planner_checkpoint,
    }))
}

fn validate_manifest(
    manifest: &RunContinuationManifest,
    request: &RunLedgerRequest,
) -> Result<(), String> {
    if ![
        LEGACY_CONTINUATION_SCHEMA_VERSION,
        CONTINUATION_SCHEMA_VERSION,
    ]
    .contains(&manifest.schema_version)
        || manifest.run_id != request.request.run_id
        || manifest.bridge_protocol_version != request.bridge_protocol_version
    {
        return Err("Run continuation manifest identity does not match its request.".to_owned());
    }
    let normalized = normalize_capability_descriptors(&manifest.capability_descriptors)?;
    if normalized != manifest.capability_descriptors
        || normalized
            .iter()
            .map(|descriptor| descriptor.id.as_str())
            .ne(request.capability_ids.iter().map(String::as_str))
    {
        return Err(
            "Run continuation capability descriptors do not match the run request.".to_owned(),
        );
    }
    let subject = RunContinuationManifestSubject {
        schema_version: manifest.schema_version,
        run_id: &manifest.run_id,
        bridge_protocol_version: &manifest.bridge_protocol_version,
        capability_descriptors: &manifest.capability_descriptors,
    };
    let expected = crate::change_set_v2::sha256(&encode_json(
        &subject,
        "run continuation manifest identity",
    )?);
    if expected != manifest.manifest_sha256 {
        return Err("Run continuation manifest digest does not match its contents.".to_owned());
    }
    Ok(())
}

fn validate_planner_checkpoint(value: Option<&Value>) -> Result<bool, String> {
    let Some(checkpoint) = value else {
        return Ok(false);
    };
    let Some(object) = checkpoint.as_object() else {
        return Err("Planner checkpoint must be a JSON object.".to_owned());
    };
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || object
            .get("plannerId")
            .and_then(Value::as_str)
            .is_none_or(|planner_id| planner_id.trim().is_empty() || planner_id.len() > 512)
        || !object.contains_key("state")
    {
        return Err("Planner checkpoint identity is invalid.".to_owned());
    }
    Ok(true)
}

pub(super) fn project_continuation(
    continuation: Option<ValidatedContinuation>,
    terminal: bool,
) -> Option<RunContinuationInspection> {
    continuation.map(|validated| {
        let (disposition, reason) = if terminal {
            (
                RunContinuationDisposition::Terminal,
                "The run is terminal; its validated artifact is returned without continuation.".to_owned(),
            )
        } else if let Some(pending) = &validated.pending {
            match (&pending.kind, &pending.replay_safety) {
                (RunInteractionKind::Planner, _) => (
                    RunContinuationDisposition::BlockedAmbiguousPlanner,
                    "A provider request was durably dispatched without a recorded completion; Forge will not duplicate it.".to_owned(),
                ),
                (RunInteractionKind::Approval, _) => (
                    RunContinuationDisposition::BlockedAmbiguousApproval,
                    "An approval request was durably dispatched without a recorded completion; Forge will not prompt again automatically.".to_owned(),
                ),
                (
                    RunInteractionKind::Capability,
                    InteractionReplaySafety::ReadOnlyRetryable,
                ) if pending.attempt == 1 => (
                    RunContinuationDisposition::RetryableCapability,
                    "The unresolved capability is explicitly read-only and has one deliberate retry available."
                        .to_owned(),
                ),
                (
                    RunInteractionKind::Capability,
                    InteractionReplaySafety::ReadOnlyRetryable,
                ) => (
                    RunContinuationDisposition::BlockedRetryExhausted,
                    "The unresolved read-only capability already consumed its single retry and will not execute again."
                        .to_owned(),
                ),
                (RunInteractionKind::Capability, _)
                    if pending.recovery_checkpoint.is_some() => (
                        RunContinuationDisposition::BlockedNonIdempotent,
                        "The unresolved capability will not be replayed; its durable ChangeSet transaction checkpoint can be inspected for recovery."
                            .to_owned(),
                    ),
                (RunInteractionKind::Capability, _) => (
                    RunContinuationDisposition::BlockedNonIdempotent,
                    "The unresolved capability is not proven retryable and will not be executed again.".to_owned(),
                ),
            }
        } else if validated.latest_planner_turn_seen && validated.latest_planner_checkpoint.is_none() {
            (
                RunContinuationDisposition::BlockedPlannerCheckpointUnavailable,
                "A completed planner turn lacks the provider checkpoint required for a later inference turn.".to_owned(),
            )
        } else {
            (
                RunContinuationDisposition::SafeBoundary,
                "All dispatched interactions have durable completions; 6B-1 records this safe boundary but does not resume automatically.".to_owned(),
            )
        };
        let pending_interaction_id = validated
            .pending
            .as_ref()
            .map(|pending| pending.interaction_id.clone());
        let pending_kind = validated
            .pending
            .as_ref()
            .map(|pending| pending.kind.clone());
        let pending_replay_safety = validated
            .pending
            .as_ref()
            .map(|pending| pending.replay_safety.clone());
        let pending_recovery_checkpoint = validated
            .pending
            .as_ref()
            .and_then(|pending| pending.recovery_checkpoint.clone());
        RunContinuationInspection {
            schema_version: validated.schema_version,
            disposition,
            interaction_frame_count: validated.frame_count,
            completed_interaction_count: validated.completed_count,
            last_sequence: validated.last_sequence,
            pending_interaction_id,
            pending_kind,
            pending_replay_safety,
            pending_recovery_checkpoint,
            capability_descriptors: validated.capability_descriptors,
            reason,
        }
    })
}

pub(super) fn build_replay(validated: &ValidatedContinuation) -> RunContinuationReplay {
    RunContinuationReplay {
        inspection: project_continuation(Some(validated.clone()), false)
            .expect("validated continuation must project"),
        interactions: validated.interactions.clone(),
        planner_checkpoint: validated.latest_planner_checkpoint.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_not_inferred_from_capability_names() {
        assert!(
            normalize_capability_descriptors(&[CapabilityDescriptor {
                id: "workspace.read".to_owned(),
                replay_safety: CapabilityReplaySafety::NonIdempotent,
            }])
            .is_ok()
        );
    }
}
