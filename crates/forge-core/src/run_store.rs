mod continuation;

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub use continuation::{
    CapabilityDescriptor, CapabilityReplaySafety, InteractionReplaySafety, RecordedRunInteraction,
    RunContinuationDisposition, RunContinuationInspection, RunContinuationReplay,
    RunInteractionKind,
};
use continuation::{
    ContinuationWriter, build_replay, create_continuation, normalize_capability_descriptors,
    project_continuation, read_continuation, resume_continuation,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{OutcomeStatus, RunArtifact, RunEvent, RunEventData, RunRequest, RunStatus};

pub const RUN_STORE_SCHEMA_VERSION: u8 = 1;
pub const MAX_RUN_STORE_EVENTS: usize = 512;
const MAX_REQUEST_BYTES: u64 = 24 * 1_048_576;
const MAX_EVENT_BYTES: usize = 8 * 1_048_576;
const MAX_EVENTS_BYTES: u64 = 64 * 1_048_576;
const MAX_ARTIFACT_BYTES: u64 = 128 * 1_048_576;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunLedgerRequest {
    pub schema_version: u8,
    pub bridge_protocol_version: String,
    pub request_sha256: String,
    pub request: RunRequest,
    pub capability_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunRecordState {
    Terminal,
    OpenOrInterrupted,
    RepairRequired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunResumeDisposition {
    ReturnTerminalArtifact,
    ResumeAvailable,
    RetryAuthorizationRequired,
    BlockedIncomplete,
    RepairRequired,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunStoreInspection {
    pub schema_version: u8,
    pub run_id: String,
    pub state: RunRecordState,
    pub resume_disposition: RunResumeDisposition,
    pub event_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_sha256: Option<String>,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<RunContinuationInspection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact: Option<RunArtifact>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunLedgerSubject<'a> {
    request: &'a RunRequest,
    capability_ids: &'a [String],
}

pub struct RunExecutionLock {
    file: File,
}

impl RunExecutionLock {
    pub fn acquire(root: &Path, run_id: &str) -> Result<Self, String> {
        validate_root(root)?;
        validate_run_id(run_id)?;
        fs::create_dir_all(root)
            .map_err(|error| format!("Cannot create run store root for execution lock: {error}"))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("Cannot canonicalize run store root: {error}"))?;
        let digest = crate::change_set_v2::sha256(run_id.as_bytes());
        let lock_directory = canonical_root.join(".locks").join(&digest[..2]);
        fs::create_dir_all(&lock_directory)
            .map_err(|error| format!("Cannot create run execution lock directory: {error}"))?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(lock_directory.join(format!("{digest}.lock")))
            .map_err(|error| format!("Cannot open run execution lock: {error}"))?;
        file.try_lock().map_err(|error| {
            format!("Run {run_id} already has a live execution or resume owner: {error}")
        })?;
        Ok(Self { file })
    }
}

impl Drop for RunExecutionLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

pub enum RunResumeOpen {
    Terminal {
        request: RunRequest,
        artifact: RunArtifact,
        recovered_temporary_artifact: bool,
    },
    Continue {
        ledger: RunLedger,
        replay: RunContinuationReplay,
    },
}

struct StagedRunDirectory {
    path: PathBuf,
    published: bool,
}

impl StagedRunDirectory {
    fn create(parent: &Path) -> Result<Self, String> {
        for _ in 0..4 {
            let mut nonce = [0_u8; 16];
            getrandom::fill(&mut nonce)
                .map_err(|error| format!("Cannot obtain run-ledger staging randomness: {error}"))?;
            let token = crate::change_set_v2::sha256(&nonce);
            let path = parent.join(format!(".initializing-{}", &token[..32]));
            match fs::create_dir(&path) {
                Ok(()) => {
                    return Ok(Self {
                        path,
                        published: false,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "Cannot create staged run ledger directory: {error}"
                    ));
                }
            }
        }
        Err("Cannot allocate a unique staged run ledger directory.".to_owned())
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn publish(mut self, destination: &Path, run_id: &str) -> Result<(), String> {
        if let Err(error) = fs::rename(&self.path, destination) {
            if destination.exists() {
                return Err(format!(
                    "Run {run_id} already has a durable ledger and cannot be executed again."
                ));
            }
            return Err(format!(
                "Cannot atomically publish run ledger directory: {error}"
            ));
        }
        self.published = true;
        let parent = destination
            .parent()
            .ok_or_else(|| "Run ledger directory has no parent.".to_owned())?;
        sync_directory(parent)
    }
}

impl Drop for StagedRunDirectory {
    fn drop(&mut self) {
        if !self.published {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

pub struct RunLedger {
    directory: PathBuf,
    request: RunRequest,
    request_sha256: String,
    continuation: ContinuationWriter,
    events_file: File,
    events: Vec<RunEvent>,
    sealed: bool,
}

impl RunLedger {
    pub fn create(
        root: &Path,
        bridge_protocol_version: &str,
        request: &RunRequest,
        capability_descriptors: &[CapabilityDescriptor],
    ) -> Result<Self, String> {
        Self::create_with_before_publish(
            root,
            bridge_protocol_version,
            request,
            capability_descriptors,
            |_, _| Ok(()),
        )
    }

    fn create_with_before_publish<F>(
        root: &Path,
        bridge_protocol_version: &str,
        request: &RunRequest,
        capability_descriptors: &[CapabilityDescriptor],
        before_publish: F,
    ) -> Result<Self, String>
    where
        F: FnOnce(&Path, &Path) -> Result<(), String>,
    {
        validate_root(root)?;
        validate_run_id(&request.run_id)?;
        if bridge_protocol_version.trim().is_empty() {
            return Err("Run ledger bridge protocol version must not be empty.".to_owned());
        }
        let normalized_capability_descriptors =
            normalize_capability_descriptors(capability_descriptors)?;
        let normalized_capability_ids = normalized_capability_descriptors
            .iter()
            .map(|descriptor| descriptor.id.clone())
            .collect::<Vec<_>>();
        fs::create_dir_all(root)
            .map_err(|error| format!("Cannot create run store root: {error}"))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("Cannot canonicalize run store root: {error}"))?;
        let directory = run_directory(&canonical_root, &request.run_id);
        let parent = directory
            .parent()
            .ok_or_else(|| "Run ledger directory has no parent.".to_owned())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create run ledger parent directory: {error}"))?;
        if directory.exists() {
            return Err(format!(
                "Run {} already has a durable ledger and cannot be executed again.",
                request.run_id
            ));
        }
        let staged = StagedRunDirectory::create(parent)?;
        let staged_directory = staged.path().to_path_buf();

        let request_sha256 = subject_sha256(request, &normalized_capability_ids)?;
        let record = RunLedgerRequest {
            schema_version: RUN_STORE_SCHEMA_VERSION,
            bridge_protocol_version: bridge_protocol_version.to_owned(),
            request_sha256: request_sha256.clone(),
            request: request.clone(),
            capability_ids: normalized_capability_ids,
        };
        let request_bytes = encode_json(&record, "run ledger request")?;
        if request_bytes.len() as u64 > MAX_REQUEST_BYTES {
            return Err("Run ledger request exceeds the configured byte limit.".to_owned());
        }
        write_new_synced(&staged_directory.join("request.json"), &request_bytes)
            .map_err(|error| format!("Cannot persist staged run ledger request: {error}"))?;
        let staged_continuation = create_continuation(
            &staged_directory,
            &request.run_id,
            bridge_protocol_version,
            &normalized_capability_descriptors,
        )?;
        drop(staged_continuation);
        {
            let staged_events_file = OpenOptions::new()
                .create_new(true)
                .append(true)
                .open(staged_directory.join("events.jsonl"))
                .map_err(|error| format!("Cannot create staged run event ledger: {error}"))?;
            staged_events_file
                .sync_all()
                .map_err(|error| format!("Cannot sync staged run event ledger: {error}"))?;
        }
        sync_directory(&staged_directory)?;
        before_publish(&staged_directory, &directory)?;
        staged.publish(&directory, &request.run_id)?;
        let validated = read_continuation(&directory, &record)?
            .ok_or_else(|| "Published run ledger has no continuation transcript.".to_owned())?;
        let continuation = resume_continuation(&directory, &validated)?;
        let events_file = OpenOptions::new()
            .append(true)
            .open(directory.join("events.jsonl"))
            .map_err(|error| format!("Cannot reopen published run event ledger: {error}"))?;

        Ok(Self {
            directory,
            request: request.clone(),
            request_sha256,
            continuation,
            events_file,
            events: Vec::new(),
            sealed: false,
        })
    }

    pub fn open_for_resume(
        root: &Path,
        run_id: &str,
        bridge_protocol_version: &str,
    ) -> Result<RunResumeOpen, String> {
        validate_root(root)?;
        validate_run_id(run_id)?;
        if !root.exists() {
            return Err(format!("Run store root does not exist: {}", root.display()));
        }
        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("Cannot canonicalize run store root: {error}"))?;
        let directory = run_directory(&canonical_root, run_id);
        if !directory.is_dir() {
            return Err(format!("Run ledger was not found: {run_id}"));
        }
        let record: RunLedgerRequest = read_bounded_json(
            &directory.join("request.json"),
            MAX_REQUEST_BYTES,
            "run ledger request",
        )?;
        validate_request_record(&record, run_id)?;
        if record.bridge_protocol_version != bridge_protocol_version {
            return Err(format!(
                "Run {run_id} uses bridge protocol {} and cannot resume under {bridge_protocol_version}.",
                record.bridge_protocol_version
            ));
        }
        let events = read_events(&directory.join("events.jsonl"), run_id)?;
        let validated = read_continuation(&directory, &record)?;
        let artifact_path = directory.join("artifact.json");
        let temporary_artifact_path = directory.join("artifact.json.tmp");
        if artifact_path.exists() || temporary_artifact_path.exists() {
            let recovered_temporary_artifact = !artifact_path.exists();
            let source = if recovered_temporary_artifact {
                &temporary_artifact_path
            } else {
                &artifact_path
            };
            let artifact: RunArtifact =
                read_bounded_json(source, MAX_ARTIFACT_BYTES, "terminal run artifact")?;
            validate_terminal_artifact(&record.request, &events, &artifact)?;
            if recovered_temporary_artifact {
                fs::rename(&temporary_artifact_path, &artifact_path).map_err(|error| {
                    format!("Cannot publish validated temporary run artifact: {error}")
                })?;
                sync_directory(&directory)?;
            }
            return Ok(RunResumeOpen::Terminal {
                request: record.request,
                artifact,
                recovered_temporary_artifact,
            });
        }
        let validated = validated.ok_or_else(|| {
            "Run predates the continuation transcript and cannot be resumed safely.".to_owned()
        })?;
        let replay = build_replay(&validated);
        let continuation = resume_continuation(&directory, &validated)?;
        let events_file = OpenOptions::new()
            .append(true)
            .open(directory.join("events.jsonl"))
            .map_err(|error| format!("Cannot reopen run event ledger: {error}"))?;
        Ok(RunResumeOpen::Continue {
            ledger: Self {
                directory,
                request: record.request,
                request_sha256: record.request_sha256,
                continuation,
                events_file,
                events,
                sealed: false,
            },
            replay,
        })
    }
    pub fn record_interaction_intent(
        &mut self,
        interaction_id: &str,
        kind: RunInteractionKind,
        replay_safety: InteractionReplaySafety,
        payload: Value,
    ) -> Result<(), String> {
        if self.sealed {
            return Err("A sealed run ledger cannot accept interaction intents.".to_owned());
        }
        self.continuation
            .record_intent(interaction_id, kind, replay_safety, payload)
    }

    pub fn record_interaction_retry_intent(
        &mut self,
        interaction_id: &str,
        kind: RunInteractionKind,
        replay_safety: InteractionReplaySafety,
        payload: Value,
    ) -> Result<(), String> {
        if self.sealed {
            return Err("A sealed run ledger cannot accept interaction retries.".to_owned());
        }
        self.continuation
            .record_retry_intent(interaction_id, kind, replay_safety, payload)
    }

    pub fn record_interaction_completion(
        &mut self,
        interaction_id: &str,
        kind: RunInteractionKind,
        payload: Value,
    ) -> Result<(), String> {
        if self.sealed {
            return Err("A sealed run ledger cannot accept interaction completions.".to_owned());
        }
        self.continuation
            .record_completion(interaction_id, kind, payload)
    }

    pub fn append_event(&mut self, event: &RunEvent) -> Result<(), String> {
        if self.sealed {
            return Err("A sealed run ledger cannot accept more events.".to_owned());
        }
        if event.run_id != self.request.run_id {
            return Err("Run event ID does not match its ledger request.".to_owned());
        }
        let expected_sequence = self.events.len() as u64 + 1;
        if event.sequence != expected_sequence {
            return Err(format!(
                "Run event sequence {} does not match expected sequence {}.",
                event.sequence, expected_sequence
            ));
        }
        if self.events.len() >= MAX_RUN_STORE_EVENTS {
            return Err("Run event ledger exceeds the configured event limit.".to_owned());
        }
        let mut frame = encode_json(event, "run event")?;
        if frame.len() > MAX_EVENT_BYTES {
            return Err("Run event exceeds the configured byte limit.".to_owned());
        }
        frame.push(b'\n');
        let current_bytes = self
            .events_file
            .metadata()
            .map_err(|error| format!("Cannot inspect run event ledger: {error}"))?
            .len();
        if current_bytes.saturating_add(frame.len() as u64) > MAX_EVENTS_BYTES {
            return Err("Run event ledger exceeds the configured byte limit.".to_owned());
        }
        self.events_file
            .write_all(&frame)
            .and_then(|()| self.events_file.sync_all())
            .map_err(|error| format!("Cannot durably append run event: {error}"))?;
        self.events.push(event.clone());
        Ok(())
    }

    pub fn seal(&mut self, artifact: &RunArtifact) -> Result<(), String> {
        if self.sealed {
            return Err("Run ledger is already sealed.".to_owned());
        }
        validate_terminal_artifact(&self.request, &self.events, artifact)?;
        let artifact_bytes = encode_json(artifact, "terminal run artifact")?;
        if artifact_bytes.len() as u64 > MAX_ARTIFACT_BYTES {
            return Err("Terminal run artifact exceeds the configured byte limit.".to_owned());
        }
        let temporary = self.directory.join("artifact.json.tmp");
        write_new_synced(&temporary, &artifact_bytes)
            .map_err(|error| format!("Cannot persist terminal run artifact: {error}"))?;
        fs::rename(&temporary, self.directory.join("artifact.json"))
            .map_err(|error| format!("Cannot publish terminal run artifact: {error}"))?;
        sync_directory(&self.directory)?;
        self.sealed = true;
        Ok(())
    }

    pub fn request_sha256(&self) -> &str {
        &self.request_sha256
    }

    pub fn request(&self) -> &RunRequest {
        &self.request
    }

    pub fn durable_events(&self) -> &[RunEvent] {
        &self.events
    }
}

pub fn inspect_run(root: &Path, run_id: &str) -> Result<RunStoreInspection, String> {
    validate_root(root)?;
    validate_run_id(run_id)?;
    if !root.exists() {
        return Err(format!("Run store root does not exist: {}", root.display()));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Cannot canonicalize run store root: {error}"))?;
    let directory = run_directory(&canonical_root, run_id);
    if !directory.is_dir() {
        return Err(format!("Run ledger was not found: {run_id}"));
    }

    let request: RunLedgerRequest = match read_bounded_json(
        &directory.join("request.json"),
        MAX_REQUEST_BYTES,
        "run ledger request",
    ) {
        Ok(record) => record,
        Err(reason) => return Ok(repair_required(run_id, 0, None, None, reason)),
    };
    if let Err(reason) = validate_request_record(&request, run_id) {
        return Ok(repair_required(run_id, 0, None, None, reason));
    }

    let events = match read_events(&directory.join("events.jsonl"), run_id) {
        Ok(events) => events,
        Err(reason) => {
            return Ok(repair_required(
                run_id,
                0,
                None,
                Some(request.request_sha256),
                reason,
            ));
        }
    };
    let continuation = match read_continuation(&directory, &request) {
        Ok(continuation) => continuation,
        Err(reason) => {
            return Ok(repair_required(
                run_id,
                events.len() as u32,
                events.last().map(|event| event.sequence),
                Some(request.request_sha256),
                reason,
            ));
        }
    };
    let event_count = events.len() as u32;
    let last_sequence = events.last().map(|event| event.sequence);
    let artifact_path = directory.join("artifact.json");
    if !artifact_path.exists() {
        let continuation = project_continuation(continuation, false);
        let temporary_artifact_exists = directory.join("artifact.json.tmp").exists();
        let (resume_disposition, reason) = if temporary_artifact_exists {
            (
                RunResumeDisposition::BlockedIncomplete,
                "An unpublished temporary artifact exists; continuation is blocked pending explicit recovery."
                    .to_owned(),
            )
        } else {
            match continuation.as_ref().map(|item| &item.disposition) {
            Some(RunContinuationDisposition::SafeBoundary) => (
                RunResumeDisposition::ResumeAvailable,
                "The durable interaction boundary is complete and can resume through deterministic same-runtime replay."
                    .to_owned(),
            ),
            Some(RunContinuationDisposition::RetryableCapability) => (
                RunResumeDisposition::RetryAuthorizationRequired,
                "The unresolved capability is explicitly read-only; continuation requires deliberate retry authorization."
                    .to_owned(),
            ),
            Some(_) => (
                RunResumeDisposition::BlockedIncomplete,
                "The continuation frontier is ambiguous or unsafe and cannot resume automatically."
                    .to_owned(),
            ),
                None => (
                    RunResumeDisposition::BlockedIncomplete,
                    "The run predates the continuation transcript and cannot resume safely."
                        .to_owned(),
                ),
            }
        };
        return Ok(RunStoreInspection {
            schema_version: RUN_STORE_SCHEMA_VERSION,
            run_id: run_id.to_owned(),
            state: RunRecordState::OpenOrInterrupted,
            resume_disposition,
            event_count,
            last_sequence,
            request_sha256: Some(request.request_sha256),
            reason,
            continuation,
            artifact: None,
        });
    }
    let artifact: RunArtifact =
        match read_bounded_json(&artifact_path, MAX_ARTIFACT_BYTES, "terminal run artifact") {
            Ok(artifact) => artifact,
            Err(reason) => {
                return Ok(repair_required(
                    run_id,
                    event_count,
                    last_sequence,
                    Some(request.request_sha256),
                    reason,
                ));
            }
        };
    if let Err(reason) = validate_terminal_artifact(&request.request, &events, &artifact) {
        return Ok(repair_required(
            run_id,
            event_count,
            last_sequence,
            Some(request.request_sha256),
            reason,
        ));
    }
    Ok(RunStoreInspection {
        schema_version: RUN_STORE_SCHEMA_VERSION,
        run_id: run_id.to_owned(),
        state: RunRecordState::Terminal,
        resume_disposition: RunResumeDisposition::ReturnTerminalArtifact,
        event_count,
        last_sequence,
        request_sha256: Some(request.request_sha256),
        reason: "The durable terminal artifact passed request, event-ledger, and continuation validation; callers may return it without replaying the run.".to_owned(),
        continuation: project_continuation(continuation, true),
        artifact: Some(artifact),
    })
}

fn validate_root(root: &Path) -> Result<(), String> {
    if !root.is_absolute() {
        return Err("Run store root must be an absolute path.".to_owned());
    }
    Ok(())
}

fn validate_run_id(run_id: &str) -> Result<(), String> {
    if run_id.trim().is_empty() || run_id.len() > 512 {
        return Err("Run ID must contain from 1 to 512 characters.".to_owned());
    }
    Ok(())
}

fn run_directory(root: &Path, run_id: &str) -> PathBuf {
    let digest = crate::change_set_v2::sha256(run_id.as_bytes());
    root.join(&digest[..2]).join(digest)
}

fn subject_sha256(request: &RunRequest, capability_ids: &[String]) -> Result<String, String> {
    let encoded = serde_json::to_vec(&RunLedgerSubject {
        request,
        capability_ids,
    })
    .map_err(|error| format!("Cannot encode run request identity: {error}"))?;
    Ok(crate::change_set_v2::sha256(&encoded))
}

fn validate_request_record(record: &RunLedgerRequest, run_id: &str) -> Result<(), String> {
    if record.schema_version != RUN_STORE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported run ledger request schema: {}",
            record.schema_version
        ));
    }
    if record.bridge_protocol_version.trim().is_empty() {
        return Err("Run ledger request has an empty bridge protocol version.".to_owned());
    }
    if record.request.run_id != run_id {
        return Err("Run ledger request ID does not match its hashed directory.".to_owned());
    }
    let mut normalized = record.capability_ids.clone();
    normalized.sort();
    normalized.dedup();
    if normalized != record.capability_ids || normalized.iter().any(|id| id.trim().is_empty()) {
        return Err("Run ledger capability IDs are not canonical.".to_owned());
    }
    let expected = subject_sha256(&record.request, &record.capability_ids)?;
    if expected != record.request_sha256 {
        return Err("Run ledger request digest does not match its contents.".to_owned());
    }
    Ok(())
}

fn validate_terminal_artifact(
    request: &RunRequest,
    events: &[RunEvent],
    artifact: &RunArtifact,
) -> Result<(), String> {
    if artifact.schema_version != 4
        || artifact.run_id != request.run_id
        || artifact.task != request.task
        || artifact.snapshot != request.snapshot
        || artifact.execution_budget != request.execution_budget
        || artifact.outcome_contract != request.outcome_contract
    {
        return Err("Terminal run artifact does not match its durable request.".to_owned());
    }
    if artifact.events != events {
        return Err("Terminal run artifact does not match its durable event ledger.".to_owned());
    }

    let context_plans: Vec<_> = events
        .iter()
        .filter_map(|event| match &event.data {
            RunEventData::ContextPlanned { plan } => Some(plan.clone()),
            _ => None,
        })
        .collect();
    if context_plans.len() > 1 || artifact.context_plan != context_plans.first().cloned() {
        return Err(
            "Terminal run artifact context projection does not match its events.".to_owned(),
        );
    }
    let capability_results: Vec<_> = events
        .iter()
        .filter_map(|event| match &event.data {
            RunEventData::CapabilityCompleted { result } => Some(result.clone()),
            _ => None,
        })
        .collect();
    if artifact.capability_results != capability_results {
        return Err(
            "Terminal run artifact capability projection does not match its events.".to_owned(),
        );
    }
    let inference_evidence: Vec<_> = events
        .iter()
        .filter_map(|event| match &event.data {
            RunEventData::InferenceCompleted { evidence } => Some(evidence.clone()),
            _ => None,
        })
        .collect();
    let expected_inference = if inference_evidence.is_empty() {
        None
    } else {
        Some(inference_evidence.clone())
    };
    if artifact.inference_evidence != expected_inference {
        return Err(
            "Terminal run artifact inference projection does not match its events.".to_owned(),
        );
    }
    let assessed_outcomes: Vec<_> = events
        .iter()
        .filter_map(|event| match &event.data {
            RunEventData::OutcomeAssessed { assessment } => Some(assessment.clone()),
            _ => None,
        })
        .collect();
    if assessed_outcomes.len() > 1
        || assessed_outcomes
            .first()
            .is_some_and(|assessment| assessment != &artifact.outcome)
        || (assessed_outcomes.is_empty()
            && (artifact.outcome.status != OutcomeStatus::NotEvaluated
                || !artifact.outcome.checks.is_empty()))
    {
        return Err(
            "Terminal run artifact outcome projection does not match its events.".to_owned(),
        );
    }

    let requested_calls = events
        .iter()
        .filter(|event| matches!(event.data, RunEventData::CapabilityRequested { .. }))
        .count() as u32;
    let invalid_call_increment = matches!(
        events.last().map(|event| &event.data),
        Some(RunEventData::RunFailed { code, .. }) if code == "invalid_capability_call"
    ) as u32;
    let (expected_input_tokens, expected_output_tokens) =
        inference_evidence
            .iter()
            .fold(
                (0_u64, 0_u64),
                |(input_total, output_total), evidence| match (
                    evidence.usage.input_tokens,
                    evidence.usage.output_tokens,
                ) {
                    (Some(input_tokens), Some(output_tokens)) => (
                        input_total.saturating_add(input_tokens),
                        output_total.saturating_add(output_tokens),
                    ),
                    _ => (input_total, output_total),
                },
            );
    if artifact.execution_usage.schema_version != 1
        || artifact.execution_usage.capability_calls
            != requested_calls.saturating_add(invalid_call_increment)
        || artifact.execution_usage.inference_turns != inference_evidence.len() as u32
        || artifact.execution_usage.reported_input_tokens != expected_input_tokens
        || artifact.execution_usage.reported_output_tokens != expected_output_tokens
    {
        return Err("Terminal run artifact usage projection does not match its events.".to_owned());
    }
    if artifact.status == RunStatus::Running {
        return Err("A running artifact cannot seal a run ledger.".to_owned());
    }
    let terminal_matches = match (
        artifact.status.clone(),
        events.last().map(|event| &event.data),
    ) {
        (RunStatus::Completed, Some(RunEventData::RunCompleted { output }))
            if artifact.output.as_ref() == Some(output) =>
        {
            true
        }
        (RunStatus::Failed, Some(RunEventData::RunFailed { .. }))
        | (RunStatus::Cancelled, Some(RunEventData::RunCancelled { .. }))
        | (RunStatus::BudgetExhausted, Some(RunEventData::RunBudgetExhausted { .. }))
        | (
            RunStatus::ExecutionBudgetExhausted,
            Some(RunEventData::RunExecutionBudgetExhausted { .. }),
        ) if artifact.output.is_none() => true,
        _ => false,
    };
    if !terminal_matches {
        return Err("Terminal run status does not match the final durable event.".to_owned());
    }
    Ok(())
}

fn read_events(path: &Path, run_id: &str) -> Result<Vec<RunEvent>, String> {
    let bytes = read_bounded(path, MAX_EVENTS_BYTES, "run event ledger")?;
    if !bytes.is_empty() && bytes.last() != Some(&b'\n') {
        return Err("Run event ledger ends with a partial frame.".to_owned());
    }
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    let mut events = Vec::new();
    let complete_frames = &bytes[..bytes.len() - 1];
    for frame in complete_frames.split(|byte| *byte == b'\n') {
        if frame.len() > MAX_EVENT_BYTES {
            return Err("Run event exceeds the configured byte limit.".to_owned());
        }
        if events.len() >= MAX_RUN_STORE_EVENTS {
            return Err("Run event ledger exceeds the configured event limit.".to_owned());
        }
        let event: RunEvent = serde_json::from_slice(frame)
            .map_err(|error| format!("Run event ledger contains invalid JSON: {error}"))?;
        let expected_sequence = events.len() as u64 + 1;
        if event.run_id != run_id || event.sequence != expected_sequence {
            return Err(format!(
                "Run event ledger identity or sequence is invalid at event {}.",
                expected_sequence
            ));
        }
        events.push(event);
    }
    Ok(events)
}

fn read_bounded_json<T: for<'de> Deserialize<'de>>(
    path: &Path,
    maximum_bytes: u64,
    label: &str,
) -> Result<T, String> {
    let bytes = read_bounded(path, maximum_bytes, label)?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid {label} JSON: {error}"))
}

fn read_bounded(path: &Path, maximum_bytes: u64, label: &str) -> Result<Vec<u8>, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Cannot inspect {label}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("The {label} is not a regular file."));
    }
    if metadata.len() > maximum_bytes {
        return Err(format!("The {label} exceeds the configured byte limit."));
    }
    let file = File::open(path).map_err(|error| format!("Cannot open {label}: {error}"))?;
    let capacity = usize::try_from(metadata.len().min(maximum_bytes)).unwrap_or(usize::MAX);
    let mut bytes = Vec::with_capacity(capacity);
    file.take(maximum_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read {label}: {error}"))?;
    if bytes.len() as u64 > maximum_bytes {
        return Err(format!("The {label} exceeds the configured byte limit."));
    }
    Ok(bytes)
}

fn encode_json<T: Serialize>(value: &T, label: &str) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|error| format!("Cannot encode {label}: {error}"))
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Cannot sync run ledger directory: {error}"))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn repair_required(
    run_id: &str,
    event_count: u32,
    last_sequence: Option<u64>,
    request_sha256: Option<String>,
    reason: String,
) -> RunStoreInspection {
    RunStoreInspection {
        schema_version: RUN_STORE_SCHEMA_VERSION,
        run_id: run_id.to_owned(),
        state: RunRecordState::RepairRequired,
        resume_disposition: RunResumeDisposition::RepairRequired,
        event_count,
        last_sequence,
        request_sha256,
        reason,
        continuation: None,
        artifact: None,
    }
}

#[cfg(test)]
mod tests {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Barrier};
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::{
        ApprovalDecision, ApprovalPolicy, CapabilityAdapter, CapabilityCall, CapabilityContext,
        CapabilityResult, ExecutionBudget, NoCancellation, NoopEventSink, PlannerRequest,
        PlannerTurn, RuntimeSignal, Slice0Runtime, TaskPlanner, WorkspaceSnapshot,
    };

    use super::*;

    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(1);

    struct CompletePlanner;

    impl TaskPlanner for CompletePlanner {
        fn next(&mut self, _request: PlannerRequest) -> Result<PlannerTurn, RuntimeSignal> {
            Ok(PlannerTurn::Complete {
                output: "done".to_owned(),
                inference: None,
            })
        }
    }

    struct UnusedPolicy;

    impl ApprovalPolicy for UnusedPolicy {
        fn decide(
            &mut self,
            _call: &CapabilityCall,
            _context: &CapabilityContext,
        ) -> Result<ApprovalDecision, RuntimeSignal> {
            panic!("approval is not used")
        }
    }

    struct NoCapabilities;

    impl CapabilityAdapter for NoCapabilities {
        fn supports(&self, _capability_id: &str) -> bool {
            false
        }

        fn invoke(
            &mut self,
            _call: &CapabilityCall,
            _snapshot: &WorkspaceSnapshot,
            _context: &CapabilityContext,
        ) -> Result<CapabilityResult, RuntimeSignal> {
            panic!("capabilities are not used")
        }
    }

    fn temporary_root() -> PathBuf {
        let nonce = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "forge-run-store-{}-{time}-{nonce}",
            std::process::id()
        ))
    }

    fn request(run_id: &str) -> RunRequest {
        RunRequest {
            run_id: run_id.to_owned(),
            task: "return done".to_owned(),
            snapshot: WorkspaceSnapshot {
                id: "workspace:test".to_owned(),
                root_label: "fixture".to_owned(),
                files: Vec::new(),
            },
            context_budget_bytes: 65_536,
            max_turns: 2,
            execution_budget: ExecutionBudget {
                schema_version: 1,
                max_capability_calls: 1,
                max_reported_input_tokens: 100,
                max_reported_output_tokens: 100,
            },
            outcome_contract: None,
        }
    }

    fn terminal_artifact(request: &RunRequest) -> RunArtifact {
        let mut planner = CompletePlanner;
        let mut policy = UnusedPolicy;
        let mut capabilities = NoCapabilities;
        let cancellation = NoCancellation;
        let mut sink = NoopEventSink;
        Slice0Runtime {
            planner: &mut planner,
            approval_policy: &mut policy,
            capabilities: &mut capabilities,
            cancellation: &cancellation,
            event_sink: &mut sink,
        }
        .run(request.clone())
    }

    fn open_continuation(root: &Path, request: &RunRequest) -> (RunLedger, RunContinuationReplay) {
        match RunLedger::open_for_resume(root, &request.run_id, "test").expect("resume open") {
            RunResumeOpen::Continue { ledger, replay } => (ledger, replay),
            RunResumeOpen::Terminal { .. } => panic!("expected an open continuation"),
        }
    }

    #[test]
    fn returns_a_valid_terminal_artifact_without_replay() {
        let root = temporary_root();
        let request = request("run:terminal");
        let artifact = terminal_artifact(&request);
        let mut ledger = RunLedger::create(
            &root,
            "forge.kernel.bridge.test",
            &request,
            &[CapabilityDescriptor {
                id: "workspace.read".to_owned(),
                replay_safety: CapabilityReplaySafety::ReadOnlyRetryable,
            }],
        )
        .expect("ledger");
        for event in &artifact.events {
            ledger.append_event(event).expect("append");
        }
        ledger.seal(&artifact).expect("seal");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::Terminal);
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::ReturnTerminalArtifact
        );
        assert_eq!(inspection.artifact, Some(artifact));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn blocks_an_interrupted_run_instead_of_replaying_it() {
        let root = temporary_root();
        let request = request("run:interrupted");
        let artifact = terminal_artifact(&request);
        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        ledger.append_event(&artifact.events[0]).expect("append");
        drop(ledger);

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::OpenOrInterrupted);
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::ResumeAvailable
        );
        assert_eq!(inspection.event_count, 1);
        assert!(inspection.artifact.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn blocks_a_request_only_crash_window_before_the_first_event() {
        let root = temporary_root();
        let request = request("run:request-only");
        let ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        let request_sha256 = ledger.request_sha256().to_owned();
        drop(ledger);

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::OpenOrInterrupted);
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::ResumeAvailable
        );
        assert_eq!(inspection.event_count, 0);
        assert_eq!(inspection.last_sequence, None);
        assert_eq!(
            inspection.request_sha256.as_deref(),
            Some(request_sha256.as_str())
        );
        assert!(inspection.artifact.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn treats_a_synced_temporary_artifact_without_publication_as_incomplete() {
        let root = temporary_root();
        let request = request("run:temporary-artifact");
        let artifact = terminal_artifact(&request);
        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        for event in &artifact.events {
            ledger.append_event(event).expect("append");
        }
        let directory = ledger.directory.clone();
        drop(ledger);
        let artifact_bytes = encode_json(&artifact, "terminal run artifact").expect("encode");
        write_new_synced(&directory.join("artifact.json.tmp"), &artifact_bytes)
            .expect("temporary artifact");
        sync_directory(&directory).expect("directory sync");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::OpenOrInterrupted);
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::BlockedIncomplete
        );
        assert_eq!(inspection.event_count, artifact.events.len() as u32);
        assert_eq!(
            inspection.last_sequence,
            artifact.events.last().map(|event| event.sequence)
        );
        assert!(inspection.artifact.is_none());
        assert!(directory.join("artifact.json.tmp").is_file());
        assert!(!directory.join("artifact.json").exists());

        match RunLedger::open_for_resume(&root, &request.run_id, "test")
            .expect("explicit terminal recovery")
        {
            RunResumeOpen::Terminal {
                artifact: recovered,
                recovered_temporary_artifact,
                ..
            } => {
                assert!(recovered_temporary_artifact);
                assert_eq!(recovered, artifact);
            }
            RunResumeOpen::Continue { .. } => panic!("temporary terminal artifact must not replay"),
        }
        assert!(!directory.join("artifact.json.tmp").exists());
        assert!(directory.join("artifact.json").is_file());
        assert_eq!(
            inspect_run(&root, &request.run_id)
                .expect("terminal inspect")
                .state,
            RunRecordState::Terminal
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn allows_exactly_one_concurrent_creator_for_a_run_identity() {
        let root = Arc::new(temporary_root());
        let request = Arc::new(request("run:concurrent-duplicate"));
        let barrier = Arc::new(Barrier::new(3));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let root = Arc::clone(&root);
            let request = Arc::clone(&request);
            let barrier = Arc::clone(&barrier);
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                RunLedger::create(root.as_path(), "test", request.as_ref(), &[])
            }));
        }
        barrier.wait();
        let outcomes: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().expect("worker"))
            .collect();
        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        let failure = outcomes
            .iter()
            .find_map(|outcome| outcome.as_ref().err())
            .expect("one creator must lose");
        assert!(failure.contains("cannot be executed again"));
        drop(outcomes);

        let inspection = inspect_run(root.as_path(), &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::OpenOrInterrupted);
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::ResumeAvailable
        );
        fs::remove_dir_all(root.as_path()).expect("cleanup");
    }

    #[test]
    fn publishes_initial_run_state_atomically_after_all_ledger_files_are_synced() {
        let root = temporary_root();
        let request = request("run:atomic-initialization");

        let failure = RunLedger::create_with_before_publish(
            &root,
            "test",
            &request,
            &[],
            |staged, destination| {
                assert!(!destination.exists());
                for name in [
                    "request.json",
                    "continuation.json",
                    "interactions.jsonl",
                    "events.jsonl",
                ] {
                    assert!(staged.join(name).is_file(), "missing staged {name}");
                }
                assert!(inspect_run(&root, &request.run_id).is_err());
                Err("fixture interrupted before publish".to_owned())
            },
        );
        let error = match failure {
            Ok(_) => panic!("fault fixture must stop publication"),
            Err(error) => error,
        };
        assert_eq!(error, "fixture interrupted before publish");

        let canonical_root = root.canonicalize().expect("canonical root");
        let directory = run_directory(&canonical_root, &request.run_id);
        assert!(!directory.exists());
        let parent = directory.parent().expect("run directory parent");
        let staging_entries = fs::read_dir(parent)
            .expect("run directory parent")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".initializing-")
            })
            .count();
        assert_eq!(staging_entries, 0);

        let ledger = RunLedger::create(&root, "test", &request, &[])
            .expect("a clean retry can publish the complete ledger");
        assert_eq!(ledger.directory, directory);
        drop(ledger);
        let inspection = inspect_run(&root, &request.run_id).expect("published run inspection");
        assert_eq!(inspection.state, RunRecordState::OpenOrInterrupted);
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::ResumeAvailable
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn an_orphaned_private_staging_directory_is_not_authoritative_or_retry_blocking() {
        let root = temporary_root();
        fs::create_dir_all(&root).expect("run store root");
        let canonical_root = root.canonicalize().expect("canonical root");
        let request = request("run:orphaned-initialization");
        let directory = run_directory(&canonical_root, &request.run_id);
        let orphan = directory
            .parent()
            .expect("run directory parent")
            .join(".initializing-crash-fixture");

        let failure = RunLedger::create_with_before_publish(
            &root,
            "test",
            &request,
            &[],
            |staged, destination| {
                assert_eq!(destination, directory);
                fs::rename(staged, &orphan).expect("simulate abandoned private staging");
                Err("fixture process stopped before publish".to_owned())
            },
        );
        let error = match failure {
            Ok(_) => panic!("fault fixture must stop publication"),
            Err(error) => error,
        };
        assert_eq!(error, "fixture process stopped before publish");
        assert!(orphan.is_dir());
        assert!(!directory.exists());
        assert!(inspect_run(&root, &request.run_id).is_err());

        let ledger = RunLedger::create(&root, "test", &request, &[])
            .expect("orphaned private staging must not block a clean retry");
        assert_eq!(ledger.directory, directory);
        drop(ledger);
        assert_eq!(
            inspect_run(&root, &request.run_id)
                .expect("published retry")
                .state,
            RunRecordState::OpenOrInterrupted
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn classifies_request_content_tampering_as_repair_required() {
        let root = temporary_root();
        let request = request("run:request-tampering");
        let ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        let request_path = ledger.directory.join("request.json");
        drop(ledger);
        let mut record: RunLedgerRequest =
            serde_json::from_slice(&fs::read(&request_path).expect("read request"))
                .expect("decode");
        record.request.task = "tampered task".to_owned();
        fs::write(
            &request_path,
            serde_json::to_vec(&record).expect("encode tampered request"),
        )
        .expect("write tampered request");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::RepairRequired);
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::RepairRequired
        );
        assert!(inspection.reason.contains("digest does not match"));
        assert!(inspection.artifact.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn refuses_to_reopen_an_existing_run_identity() {
        let root = temporary_root();
        let request = request("run:duplicate");
        let _ledger = RunLedger::create(&root, "test", &request, &[]).expect("first");
        let error = RunLedger::create(&root, "test", &request, &[])
            .err()
            .expect("duplicate must fail");
        assert!(error.contains("cannot be executed again"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn classifies_a_partial_event_frame_as_repair_required() {
        let root = temporary_root();
        let request = request("run:corrupt");
        let artifact = terminal_artifact(&request);
        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        ledger.append_event(&artifact.events[0]).expect("append");
        let directory = ledger.directory.clone();
        drop(ledger);
        let mut events = OpenOptions::new()
            .append(true)
            .open(directory.join("events.jsonl"))
            .expect("events");
        events.write_all(b"{\"partial\":true}").expect("corrupt");
        events.sync_all().expect("sync");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::RepairRequired);
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::RepairRequired
        );
        assert!(inspection.reason.contains("partial frame"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn accepts_the_runtime_all_or_nothing_accounting_for_partial_usage() {
        struct PartialUsagePlanner;
        impl TaskPlanner for PartialUsagePlanner {
            fn next(&mut self, _request: PlannerRequest) -> Result<PlannerTurn, RuntimeSignal> {
                let evidence = serde_json::from_value(serde_json::json!({
                    "schemaVersion": 1,
                    "requestId": "inference:partial",
                    "provider": "fixture",
                    "locality": "local",
                    "model": "fixture",
                    "finishReason": "stop",
                    "durationMs": 1,
                    "outputCharacters": 4,
                    "toolCallCount": 0,
                    "usage": { "inputTokens": 5 },
                    "cost": { "status": "not_applicable" },
                    "routing": {
                        "requestedProvider": "fixture",
                        "selectedProvider": "fixture",
                        "requestedModel": "fixture",
                        "selectedModel": "fixture",
                        "fallbackUsed": false
                    }
                }))
                .expect("evidence");
                Ok(PlannerTurn::Complete {
                    output: "done".to_owned(),
                    inference: Some(evidence),
                })
            }
        }

        let root = temporary_root();
        let request = request("run:partial-usage");
        let mut planner = PartialUsagePlanner;
        let mut policy = UnusedPolicy;
        let mut capabilities = NoCapabilities;
        let cancellation = NoCancellation;
        let mut sink = NoopEventSink;
        let artifact = Slice0Runtime {
            planner: &mut planner,
            approval_policy: &mut policy,
            capabilities: &mut capabilities,
            cancellation: &cancellation,
            event_sink: &mut sink,
        }
        .run(request.clone());
        assert_eq!(artifact.status, RunStatus::Failed);
        assert_eq!(artifact.execution_usage.inference_turns, 1);
        assert_eq!(artifact.execution_usage.reported_input_tokens, 0);
        assert_eq!(artifact.execution_usage.reported_output_tokens, 0);

        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        for event in &artifact.events {
            ledger.append_event(event).expect("append");
        }
        ledger.seal(&artifact).expect("seal");
        assert_eq!(
            inspect_run(&root, &request.run_id).expect("inspect").state,
            RunRecordState::Terminal
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
    #[test]
    fn hashes_run_ids_into_cross_platform_directory_components() {
        let root = temporary_root();
        let request = request("run:contains/windows:and/unix/separators");
        let ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        let relative = ledger
            .directory
            .strip_prefix(root.canonicalize().expect("root"))
            .expect("relative");
        let components: Vec<_> = relative
            .iter()
            .map(|component| component.to_string_lossy().into_owned())
            .collect();
        assert_eq!(components.len(), 2);
        assert_eq!(components[0].len(), 2);
        assert_eq!(components[1].len(), 64);
        assert!(components.iter().all(|component| {
            component
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        }));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn classifies_reordered_event_frames_as_repair_required() {
        let root = temporary_root();
        let request = request("run:reordered-events");
        let artifact = terminal_artifact(&request);
        let ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        let directory = ledger.directory.clone();
        drop(ledger);
        let mut events = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(directory.join("events.jsonl"))
            .expect("events");
        for event in [&artifact.events[1], &artifact.events[0]] {
            serde_json::to_writer(&mut events, event).expect("encode");
            events.write_all(b"\n").expect("newline");
        }
        events.sync_all().expect("sync");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::RepairRequired);
        assert!(inspection.reason.contains("sequence is invalid at event 1"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn classifies_a_sequence_gap_as_repair_required() {
        let root = temporary_root();
        let request = request("run:sequence-gap");
        let artifact = terminal_artifact(&request);
        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        ledger.append_event(&artifact.events[0]).expect("append");
        let directory = ledger.directory.clone();
        drop(ledger);
        let mut invalid = artifact.events[1].clone();
        invalid.sequence = 3;
        let mut events = OpenOptions::new()
            .append(true)
            .open(directory.join("events.jsonl"))
            .expect("events");
        serde_json::to_writer(&mut events, &invalid).expect("encode");
        events.write_all(b"\n").expect("newline");
        events.sync_all().expect("sync");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::RepairRequired);
        assert!(inspection.reason.contains("sequence is invalid"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_an_artifact_projection_that_disagrees_with_terminal_events() {
        let root = temporary_root();
        let request = request("run:artifact-mismatch");
        let artifact = terminal_artifact(&request);
        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        for event in &artifact.events {
            ledger.append_event(event).expect("append");
        }
        let directory = ledger.directory.clone();
        drop(ledger);
        let mut tampered = artifact;
        tampered.output = Some("tampered".to_owned());
        fs::write(
            directory.join("artifact.json"),
            serde_json::to_vec(&tampered).expect("encode"),
        )
        .expect("artifact");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::RepairRequired);
        assert!(inspection.reason.contains("final durable event"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn classifies_each_unresolved_interaction_by_explicit_replay_safety() {
        let cases = [
            (
                "planner",
                RunInteractionKind::Planner,
                InteractionReplaySafety::NeverRetry,
                RunContinuationDisposition::BlockedAmbiguousPlanner,
                Vec::new(),
            ),
            (
                "approval",
                RunInteractionKind::Approval,
                InteractionReplaySafety::NeverRetry,
                RunContinuationDisposition::BlockedAmbiguousApproval,
                Vec::new(),
            ),
            (
                "read",
                RunInteractionKind::Capability,
                InteractionReplaySafety::ReadOnlyRetryable,
                RunContinuationDisposition::RetryableCapability,
                vec![CapabilityDescriptor {
                    id: "workspace.read".to_owned(),
                    replay_safety: CapabilityReplaySafety::ReadOnlyRetryable,
                }],
            ),
            (
                "change",
                RunInteractionKind::Capability,
                InteractionReplaySafety::NonIdempotent,
                RunContinuationDisposition::BlockedNonIdempotent,
                vec![CapabilityDescriptor {
                    id: "workspace.change.execute".to_owned(),
                    replay_safety: CapabilityReplaySafety::NonIdempotent,
                }],
            ),
        ];

        for (name, kind, safety, expected, descriptors) in cases {
            let root = temporary_root();
            let request = request(&format!("run:pending-{name}"));
            let mut ledger =
                RunLedger::create(&root, "test", &request, &descriptors).expect("ledger");
            ledger
                .record_interaction_intent(
                    &format!("{name}:1"),
                    kind.clone(),
                    safety.clone(),
                    serde_json::json!({ "request": name }),
                )
                .expect("intent");
            drop(ledger);

            let continuation = inspect_run(&root, &request.run_id)
                .expect("inspect")
                .continuation
                .expect("continuation");
            assert_eq!(continuation.disposition, expected, "case {name}");
            assert_eq!(continuation.pending_kind, Some(kind), "case {name}");
            assert_eq!(
                continuation.pending_replay_safety,
                Some(safety),
                "case {name}"
            );
            fs::remove_dir_all(root).expect("cleanup");
        }
    }

    #[test]
    fn requires_a_provider_checkpoint_at_a_completed_planner_boundary() {
        for (name, checkpoint, expected) in [
            (
                "missing",
                None,
                RunContinuationDisposition::BlockedPlannerCheckpointUnavailable,
            ),
            (
                "present",
                Some(serde_json::json!({
                    "schemaVersion": 1,
                    "plannerId": "provider:ollama:fixture",
                    "state": { "messages": [] }
                })),
                RunContinuationDisposition::SafeBoundary,
            ),
        ] {
            let root = temporary_root();
            let request = request(&format!("run:planner-boundary-{name}"));
            let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
            ledger
                .record_interaction_intent(
                    "planner:1",
                    RunInteractionKind::Planner,
                    InteractionReplaySafety::NeverRetry,
                    serde_json::json!({ "request": { "turn": 1 } }),
                )
                .expect("intent");
            let mut completion = serde_json::json!({
                "type": "planner.turn",
                "protocolVersion": "test",
                "requestId": "bridge:test",
                "turn": { "kind": "complete", "output": "done" }
            });
            if let Some(checkpoint) = checkpoint {
                completion
                    .as_object_mut()
                    .expect("object")
                    .insert("plannerCheckpoint".to_owned(), checkpoint);
            }
            ledger
                .record_interaction_completion("planner:1", RunInteractionKind::Planner, completion)
                .expect("completion");
            drop(ledger);

            let continuation = inspect_run(&root, &request.run_id)
                .expect("inspect")
                .continuation
                .expect("continuation");
            assert_eq!(continuation.disposition, expected, "case {name}");
            assert_eq!(continuation.interaction_frame_count, 2);
            assert_eq!(continuation.completed_interaction_count, 1);
            fs::remove_dir_all(root).expect("cleanup");
        }
    }

    #[test]
    fn rejects_overlapping_or_mismatched_interaction_transitions() {
        let root = temporary_root();
        let request = request("run:interaction-transitions");
        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        ledger
            .record_interaction_intent(
                "planner:1",
                RunInteractionKind::Planner,
                InteractionReplaySafety::NeverRetry,
                serde_json::json!({ "request": { "turn": 1 } }),
            )
            .expect("intent");
        assert!(
            ledger
                .record_interaction_intent(
                    "planner:2",
                    RunInteractionKind::Planner,
                    InteractionReplaySafety::NeverRetry,
                    serde_json::json!({ "request": { "turn": 2 } }),
                )
                .expect_err("overlap must fail")
                .contains("second interaction")
        );
        assert!(
            ledger
                .record_interaction_completion(
                    "approval:wrong",
                    RunInteractionKind::Approval,
                    serde_json::json!({ "type": "approval.facts" }),
                )
                .expect_err("mismatch must fail")
                .contains("does not match")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn classifies_tampered_or_partial_interaction_ledgers_as_repair_required() {
        for (name, partial) in [("tampered", false), ("partial", true)] {
            let root = temporary_root();
            let request = request(&format!("run:interaction-{name}"));
            let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
            ledger
                .record_interaction_intent(
                    "planner:1",
                    RunInteractionKind::Planner,
                    InteractionReplaySafety::NeverRetry,
                    serde_json::json!({ "request": "original" }),
                )
                .expect("intent");
            let directory = ledger.directory.clone();
            drop(ledger);
            let path = directory.join("interactions.jsonl");
            if partial {
                let mut interactions = OpenOptions::new().append(true).open(&path).expect("open");
                interactions
                    .write_all(b"{\"partial\":true}")
                    .expect("append");
                interactions.sync_all().expect("sync");
            } else {
                let encoded = fs::read_to_string(&path).expect("read");
                let tampered = encoded.replace("original", "modified");
                assert_ne!(encoded, tampered);
                fs::write(&path, tampered).expect("tamper");
            }

            let inspection = inspect_run(&root, &request.run_id).expect("inspect");
            assert_eq!(
                inspection.state,
                RunRecordState::RepairRequired,
                "case {name}"
            );
            assert_eq!(
                inspection.resume_disposition,
                RunResumeDisposition::RepairRequired
            );
            assert!(inspection.continuation.is_none());
            fs::remove_dir_all(root).expect("cleanup");
        }
    }

    #[test]
    fn detects_replay_safety_manifest_tampering() {
        let root = temporary_root();
        let request = request("run:continuation-manifest-tamper");
        let ledger = RunLedger::create(
            &root,
            "test",
            &request,
            &[CapabilityDescriptor {
                id: "workspace.read".to_owned(),
                replay_safety: CapabilityReplaySafety::ReadOnlyRetryable,
            }],
        )
        .expect("ledger");
        let path = ledger.directory.join("continuation.json");
        drop(ledger);
        let encoded = fs::read_to_string(&path).expect("read");
        let tampered = encoded.replace("read_only_retryable", "non_idempotent");
        assert_ne!(encoded, tampered);
        fs::write(path, tampered).expect("tamper");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::RepairRequired);
        assert!(inspection.reason.contains("digest does not match"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn serializes_live_execution_ownership_with_an_os_released_lock() {
        let root = temporary_root();
        let first = RunExecutionLock::acquire(&root, "run:locked").expect("first lock");
        let canonical_root = root.canonicalize().expect("canonical root");
        assert!(!run_directory(&canonical_root, "run:locked").exists());
        let digest = crate::change_set_v2::sha256(b"run:locked");
        assert!(
            canonical_root
                .join(".locks")
                .join(&digest[..2])
                .join(format!("{digest}.lock"))
                .is_file()
        );
        let error = RunExecutionLock::acquire(&root, "run:locked")
            .err()
            .expect("second owner must fail");
        assert!(error.contains("live execution or resume owner"));
        drop(first);
        let reacquired = RunExecutionLock::acquire(&root, "run:locked").expect("reacquire");
        drop(reacquired);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reopens_a_safe_boundary_with_exact_recorded_completions() {
        let root = temporary_root();
        let request = request("run:replay-boundary");
        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        ledger
            .record_interaction_intent(
                "planner:1",
                RunInteractionKind::Planner,
                InteractionReplaySafety::NeverRetry,
                serde_json::json!({ "request": { "turn": 1 } }),
            )
            .expect("intent");
        ledger
            .record_interaction_completion(
                "planner:1",
                RunInteractionKind::Planner,
                serde_json::json!({
                    "type": "planner.turn",
                    "protocolVersion": "test",
                    "requestId": "bridge:test",
                    "turn": { "kind": "complete", "output": "done" },
                    "plannerCheckpoint": {
                        "schemaVersion": 1,
                        "plannerId": "fixture:resume",
                        "state": { "messages": [] }
                    }
                }),
            )
            .expect("completion");
        drop(ledger);

        let (ledger, replay) = open_continuation(&root, &request);
        assert_eq!(ledger.request(), &request);
        assert_eq!(
            replay.inspection.disposition,
            RunContinuationDisposition::SafeBoundary
        );
        assert_eq!(replay.interactions.len(), 1);
        assert!(replay.interactions[0].completion_payload.is_some());
        assert_eq!(
            replay
                .planner_checkpoint
                .as_ref()
                .and_then(|value| value.get("plannerId"))
                .and_then(Value::as_str),
            Some("fixture:resume")
        );
        drop(ledger);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn blocks_a_read_after_its_single_retry_is_interrupted() {
        let root = temporary_root();
        let request = request("run:retry-exhausted");
        let descriptors = [CapabilityDescriptor {
            id: "workspace.read".to_owned(),
            replay_safety: CapabilityReplaySafety::ReadOnlyRetryable,
        }];
        let payload = serde_json::json!({ "call": { "id": "call:read" } });
        let mut ledger = RunLedger::create(&root, "test", &request, &descriptors).expect("ledger");
        ledger
            .record_interaction_intent(
                "capability:call:read",
                RunInteractionKind::Capability,
                InteractionReplaySafety::ReadOnlyRetryable,
                payload.clone(),
            )
            .expect("intent");
        drop(ledger);
        let (mut ledger, _) = open_continuation(&root, &request);
        ledger
            .record_interaction_retry_intent(
                "capability:call:read",
                RunInteractionKind::Capability,
                InteractionReplaySafety::ReadOnlyRetryable,
                payload.clone(),
            )
            .expect("single retry");
        drop(ledger);

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(
            inspection.resume_disposition,
            RunResumeDisposition::BlockedIncomplete
        );
        assert_eq!(
            inspection.continuation.expect("continuation").disposition,
            RunContinuationDisposition::BlockedRetryExhausted
        );
        let (mut ledger, _) = open_continuation(&root, &request);
        assert!(
            ledger
                .record_interaction_retry_intent(
                    "capability:call:read",
                    RunInteractionKind::Capability,
                    InteractionReplaySafety::ReadOnlyRetryable,
                    payload,
                )
                .expect_err("second retry must fail")
                .contains("already consumed")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn records_an_authorized_read_retry_before_its_completion() {
        let root = temporary_root();
        let request = request("run:retry-attempt");
        let descriptors = [CapabilityDescriptor {
            id: "workspace.read".to_owned(),
            replay_safety: CapabilityReplaySafety::ReadOnlyRetryable,
        }];
        let payload = serde_json::json!({ "call": { "id": "call:read" } });
        let mut ledger = RunLedger::create(&root, "test", &request, &descriptors).expect("ledger");
        ledger
            .record_interaction_intent(
                "capability:call:read",
                RunInteractionKind::Capability,
                InteractionReplaySafety::ReadOnlyRetryable,
                payload.clone(),
            )
            .expect("intent");
        drop(ledger);

        let (mut ledger, replay) = open_continuation(&root, &request);
        assert_eq!(
            replay.inspection.disposition,
            RunContinuationDisposition::RetryableCapability
        );
        ledger
            .record_interaction_retry_intent(
                "capability:call:read",
                RunInteractionKind::Capability,
                InteractionReplaySafety::ReadOnlyRetryable,
                payload,
            )
            .expect("retry intent");
        ledger
            .record_interaction_completion(
                "capability:call:read",
                RunInteractionKind::Capability,
                serde_json::json!({
                    "type": "capability.result",
                    "protocolVersion": "test",
                    "requestId": "bridge:test",
                    "result": { "callId": "call:read", "success": true, "content": "ok" }
                }),
            )
            .expect("retry completion");
        drop(ledger);

        let continuation = inspect_run(&root, &request.run_id)
            .expect("inspect")
            .continuation
            .expect("continuation");
        assert_eq!(
            continuation.disposition,
            RunContinuationDisposition::SafeBoundary
        );
        assert_eq!(continuation.interaction_frame_count, 3);
        assert_eq!(continuation.completed_interaction_count, 1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn preserves_pending_interaction_evidence_on_a_terminal_failure() {
        let root = temporary_root();
        let request = request("run:terminal-with-pending");
        let artifact = terminal_artifact(&request);
        let mut ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        ledger
            .record_interaction_intent(
                "planner:1",
                RunInteractionKind::Planner,
                InteractionReplaySafety::NeverRetry,
                serde_json::json!({ "request": { "turn": 1 } }),
            )
            .expect("intent");
        for event in &artifact.events {
            ledger.append_event(event).expect("event");
        }
        ledger.seal(&artifact).expect("seal");
        drop(ledger);

        let continuation = inspect_run(&root, &request.run_id)
            .expect("inspect")
            .continuation
            .expect("continuation");
        assert_eq!(
            continuation.disposition,
            RunContinuationDisposition::Terminal
        );
        assert_eq!(continuation.pending_kind, Some(RunInteractionKind::Planner));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_an_oversized_event_ledger_before_allocating_it() {
        let root = temporary_root();
        let request = request("run:oversized");
        let ledger = RunLedger::create(&root, "test", &request, &[]).expect("ledger");
        let directory = ledger.directory.clone();
        drop(ledger);
        let events = OpenOptions::new()
            .write(true)
            .open(directory.join("events.jsonl"))
            .expect("events");
        events
            .set_len(MAX_EVENTS_BYTES + 1)
            .expect("sparse oversized ledger");

        let inspection = inspect_run(&root, &request.run_id).expect("inspect");
        assert_eq!(inspection.state, RunRecordState::RepairRequired);
        assert!(inspection.reason.contains("byte limit"));
        fs::remove_dir_all(root).expect("cleanup");
    }
}
