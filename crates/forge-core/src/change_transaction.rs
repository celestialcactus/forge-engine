use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    ApprovalDecision, ApprovalFacts, ApprovalOutcome, Cancellation, CapabilityCall,
    IsolationEvidence, IsolationProfile, IsolationRequest, ProcessEnvironmentEvidence,
    resolve_approval,
};

pub const CHANGE_APPLY_CAPABILITY_ID: &str = "workspace.change.apply";
const MAXIMUM_CHANGES: usize = 20;
const MAXIMUM_REPLACEMENT_BYTES: usize = 1_048_576;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeApplicationManifest {
    pub schema_version: u8,
    pub proposal_id: String,
    pub snapshot_id: String,
    pub changes: Vec<ApplicationChange>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationChange {
    pub path: String,
    pub before_sha256: String,
    pub after_sha256: String,
    pub replacement_text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerificationSelection {
    pub check_id: String,
    pub isolation: IsolationRequest,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeTransactionRequest {
    pub transaction_id: String,
    pub expected_base_revision: String,
    pub call: CapabilityCall,
    pub manifest: ChangeApplicationManifest,
    pub approval_facts: ApprovalFacts,
    pub verification: VerificationSelection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChangeApplyCallInput {
    transaction_id: String,
    expected_base_revision: String,
    proposal_id: String,
    snapshot_id: String,
    verification_check_id: String,
    isolation_profile: IsolationProfile,
    isolation_provider_id: Option<String>,
    isolation_boundary_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundaryEvidence {
    pub boundary_id: String,
    pub base_revision: String,
    pub original_workspace_unchanged: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppliedChangeEvidence {
    pub path: String,
    pub after_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundedTextEvidence {
    pub text: String,
    pub total_bytes: u64,
    pub sha256: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyEvidence {
    pub changes: Vec<AppliedChangeEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<BoundedTextEvidence>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerificationEvidence {
    pub check_id: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub stdout_bytes: u64,
    pub stderr_bytes: u64,
    pub output_truncated: bool,
    pub stdout: String,
    pub stderr: String,
    pub isolation: IsolationEvidence,
    pub environment: ProcessEnvironmentEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateRetentionEvidence {
    pub candidate_id: String,
    pub boundary_id: String,
    pub retained: bool,
    pub original_workspace_unchanged: bool,
    pub final_diff: BoundedTextEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryEvidence {
    pub attempted: bool,
    pub success: bool,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeTransactionStatus {
    NotAuthorized,
    Cancelled,
    Failed,
    Recovered,
    VerifiedCandidate,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChangeTransactionPhase {
    #[serde(rename = "manifest.validated")]
    ManifestValidated,
    #[serde(rename = "approval.resolved")]
    ApprovalResolved,
    #[serde(rename = "boundary.prepared")]
    BoundaryPrepared,
    #[serde(rename = "candidate.applied")]
    CandidateApplied,
    #[serde(rename = "verification.completed")]
    VerificationCompleted,
    #[serde(rename = "candidate.retained")]
    CandidateRetained,
    #[serde(rename = "candidate.verified")]
    CandidateVerified,
    #[serde(rename = "recovery.completed")]
    RecoveryCompleted,
    #[serde(rename = "transaction.cancelled")]
    TransactionCancelled,
    #[serde(rename = "transaction.failed")]
    TransactionFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeTransactionStep {
    pub sequence: u32,
    pub phase: ChangeTransactionPhase,
    pub success: bool,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeTransactionArtifact {
    pub schema_version: u8,
    pub transaction_id: String,
    pub proposal_id: String,
    pub snapshot_id: String,
    pub requested_isolation: IsolationRequest,
    pub status: ChangeTransactionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval: Option<ApprovalDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<BoundaryEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application: Option<ApplyEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification: Option<VerificationEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention: Option<CandidateRetentionEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<RecoveryEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancellation_reason: Option<String>,
    pub steps: Vec<ChangeTransactionStep>,
}

pub trait ChangeTransactionAdapter {
    fn prepare(&mut self, manifest: &ChangeApplicationManifest)
    -> Result<BoundaryEvidence, String>;
    fn apply(
        &mut self,
        boundary: &BoundaryEvidence,
        manifest: &ChangeApplicationManifest,
    ) -> Result<ApplyEvidence, String>;
    fn verify(
        &mut self,
        boundary: &BoundaryEvidence,
        selection: &VerificationSelection,
        cancellation: &dyn Cancellation,
    ) -> Result<VerificationEvidence, String>;
    fn retain(&mut self, boundary: &BoundaryEvidence)
    -> Result<CandidateRetentionEvidence, String>;
    fn recover(&mut self, boundary: &BoundaryEvidence, cause: &str) -> Result<String, String>;
}

fn digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_path(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains(':')
        && !value.contains('\0')
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProposalIdentityChange<'a> {
    path: &'a str,
    before_sha256: &'a str,
    after_sha256: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProposalIdentity<'a> {
    snapshot_id: &'a str,
    status: &'static str,
    changes: Vec<ProposalIdentityChange<'a>>,
    conflicts: [(); 0],
}

pub fn proposal_id_for_manifest(manifest: &ChangeApplicationManifest) -> String {
    let identity = ProposalIdentity {
        snapshot_id: &manifest.snapshot_id,
        status: "ready",
        changes: manifest
            .changes
            .iter()
            .map(|change| ProposalIdentityChange {
                path: &change.path,
                before_sha256: &change.before_sha256,
                after_sha256: &change.after_sha256,
            })
            .collect(),
        conflicts: [],
    };
    let full: String =
        Sha256::digest(serde_json::to_vec(&identity).expect("identity serialization"))
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
    format!("change:{}", &full[..20])
}

fn validate(request: &ChangeTransactionRequest) -> Result<(), String> {
    if request.transaction_id.trim().is_empty() || request.call.id.trim().is_empty() {
        return Err("Transaction and call IDs must not be empty.".to_owned());
    }
    if request.expected_base_revision.trim().is_empty()
        || request.expected_base_revision.len() > 128
        || request.expected_base_revision.chars().any(char::is_control)
    {
        return Err("expectedBaseRevision must be a bounded non-empty revision.".to_owned());
    }
    if request.call.capability_id != CHANGE_APPLY_CAPABILITY_ID {
        return Err(format!(
            "Slice 2B requires capabilityId {CHANGE_APPLY_CAPABILITY_ID}."
        ));
    }
    let call_input: ChangeApplyCallInput = serde_json::from_value(request.call.input.clone())
        .map_err(|error| format!("Invalid workspace.change.apply input: {error}"))?;
    if call_input.transaction_id != request.transaction_id
        || call_input.expected_base_revision != request.expected_base_revision
        || call_input.proposal_id != request.manifest.proposal_id
        || call_input.snapshot_id != request.manifest.snapshot_id
        || call_input.verification_check_id != request.verification.check_id
        || call_input.isolation_profile != request.verification.isolation.profile
        || call_input.isolation_provider_id.as_deref()
            != request
                .verification
                .isolation
                .host_attestation
                .as_ref()
                .map(|attestation| attestation.provider_id.as_str())
        || call_input.isolation_boundary_id.as_deref()
            != request
                .verification
                .isolation
                .host_attestation
                .as_ref()
                .map(|attestation| attestation.boundary_id.as_str())
    {
        return Err(
            "The approved capability call does not match the transaction manifest and verification."
                .to_owned(),
        );
    }
    if request.manifest.schema_version != 1 || request.manifest.snapshot_id.trim().is_empty() {
        return Err("Unsupported or incomplete application manifest.".to_owned());
    }
    if request.manifest.changes.is_empty() || request.manifest.changes.len() > MAXIMUM_CHANGES {
        return Err(format!(
            "Application manifest must contain 1 to {MAXIMUM_CHANGES} changes."
        ));
    }
    if request.verification.check_id.trim().is_empty() {
        return Err("verification.checkId must not be empty.".to_owned());
    }
    if request.verification.isolation.profile != IsolationProfile::HostManaged
        && request.verification.isolation.host_attestation.is_some()
    {
        return Err(
            "Host isolation attestation is valid only for host-managed execution.".to_owned(),
        );
    }
    if request.approval_facts.call_id != request.call.id
        || request.approval_facts.capability_id != request.call.capability_id
    {
        return Err("Approval facts do not match the exact change capability call.".to_owned());
    }

    let mut paths = HashSet::new();
    for change in &request.manifest.changes {
        if !is_path(&change.path) || !paths.insert(change.path.clone()) {
            return Err(format!(
                "Invalid or duplicate application path: {}.",
                change.path
            ));
        }
        if !is_digest(&change.before_sha256) || !is_digest(&change.after_sha256) {
            return Err(format!("Invalid application digest: {}.", change.path));
        }
        if change.before_sha256 == change.after_sha256 {
            return Err(format!(
                "Application manifest contains a no-op: {}.",
                change.path
            ));
        }
        if change.replacement_text.len() > MAXIMUM_REPLACEMENT_BYTES
            || change.replacement_text.contains('\0')
        {
            return Err(format!(
                "Replacement content exceeds Slice 2A text bounds: {}.",
                change.path
            ));
        }
        if digest(&change.replacement_text) != change.after_sha256 {
            return Err(format!(
                "Replacement content digest mismatch: {}.",
                change.path
            ));
        }
    }
    let expected = proposal_id_for_manifest(&request.manifest);
    if request.manifest.proposal_id != expected {
        return Err(format!(
            "Application manifest proposalId {} does not match {expected}.",
            request.manifest.proposal_id
        ));
    }
    Ok(())
}

fn step(
    artifact: &mut ChangeTransactionArtifact,
    phase: ChangeTransactionPhase,
    success: bool,
    message: impl Into<String>,
) {
    artifact.steps.push(ChangeTransactionStep {
        sequence: artifact.steps.len() as u32 + 1,
        phase,
        success,
        message: message.into(),
    });
}

fn failed(
    artifact: &mut ChangeTransactionArtifact,
    message: impl Into<String>,
) -> ChangeTransactionArtifact {
    let message = message.into();
    artifact.status = ChangeTransactionStatus::Failed;
    artifact.failure = Some(message.clone());
    step(
        artifact,
        ChangeTransactionPhase::TransactionFailed,
        false,
        message,
    );
    artifact.clone()
}

fn cancelled(
    artifact: &mut ChangeTransactionArtifact,
    reason: String,
) -> ChangeTransactionArtifact {
    artifact.status = ChangeTransactionStatus::Cancelled;
    artifact.cancellation_reason = Some(reason.clone());
    step(
        artifact,
        ChangeTransactionPhase::TransactionCancelled,
        false,
        reason,
    );
    artifact.clone()
}

fn recover<A: ChangeTransactionAdapter>(
    artifact: &mut ChangeTransactionArtifact,
    adapter: &mut A,
    boundary: &BoundaryEvidence,
    cause: String,
    was_cancelled: bool,
) -> ChangeTransactionArtifact {
    match adapter.recover(boundary, &cause) {
        Ok(message) => {
            artifact.recovery = Some(RecoveryEvidence {
                attempted: true,
                success: true,
                message: message.clone(),
            });
            if was_cancelled {
                artifact.cancellation_reason = Some(cause);
            } else {
                artifact.failure = Some(cause);
            }
            artifact.status = if was_cancelled {
                ChangeTransactionStatus::Cancelled
            } else {
                ChangeTransactionStatus::Recovered
            };
            step(
                artifact,
                ChangeTransactionPhase::RecoveryCompleted,
                true,
                message,
            );
            if was_cancelled {
                step(
                    artifact,
                    ChangeTransactionPhase::TransactionCancelled,
                    false,
                    "Cancellation recovered the candidate boundary.",
                );
            }
            artifact.clone()
        }
        Err(error) => {
            artifact.recovery = Some(RecoveryEvidence {
                attempted: true,
                success: false,
                message: error.clone(),
            });
            failed(artifact, format!("{cause} Recovery also failed: {error}"))
        }
    }
}

fn application_matches(manifest: &ChangeApplicationManifest, evidence: &ApplyEvidence) -> bool {
    evidence.changes.len() == manifest.changes.len()
        && evidence.changes.iter().all(|applied| {
            manifest.changes.iter().any(|change| {
                change.path == applied.path && change.after_sha256 == applied.after_sha256
            })
        })
        && evidence
            .changes
            .iter()
            .map(|change| &change.path)
            .collect::<HashSet<_>>()
            .len()
            == evidence.changes.len()
}

pub fn execute_candidate_transaction<A: ChangeTransactionAdapter>(
    request: &ChangeTransactionRequest,
    adapter: &mut A,
    cancellation: &dyn Cancellation,
) -> ChangeTransactionArtifact {
    let mut artifact = ChangeTransactionArtifact {
        schema_version: 1,
        transaction_id: request.transaction_id.clone(),
        proposal_id: request.manifest.proposal_id.clone(),
        snapshot_id: request.manifest.snapshot_id.clone(),
        requested_isolation: request.verification.isolation.clone(),
        status: ChangeTransactionStatus::Failed,
        approval: None,
        boundary: None,
        application: None,
        verification: None,
        retention: None,
        recovery: None,
        failure: None,
        cancellation_reason: None,
        steps: Vec::new(),
    };

    if let Err(error) = validate(request) {
        return failed(&mut artifact, error);
    }
    step(
        &mut artifact,
        ChangeTransactionPhase::ManifestValidated,
        true,
        "Manifest identity and content digests match.",
    );
    if let Some(reason) = cancellation.reason() {
        return cancelled(&mut artifact, reason);
    }

    let approval = match resolve_approval(&request.approval_facts) {
        Ok(value) => value,
        Err(error) => return failed(&mut artifact, error),
    };
    let authorized = approval.outcome == ApprovalOutcome::Allow;
    step(
        &mut artifact,
        ChangeTransactionPhase::ApprovalResolved,
        authorized,
        approval.reason.clone(),
    );
    artifact.approval = Some(approval);
    if !authorized {
        artifact.status = ChangeTransactionStatus::NotAuthorized;
        return artifact;
    }
    if let Some(reason) = cancellation.reason() {
        return cancelled(&mut artifact, reason);
    }

    let boundary = match adapter.prepare(&request.manifest) {
        Ok(value) => value,
        Err(error) => {
            return failed(
                &mut artifact,
                format!("Boundary preparation failed: {error}"),
            );
        }
    };
    artifact.boundary = Some(boundary.clone());
    if boundary.boundary_id.trim().is_empty()
        || boundary.base_revision != request.expected_base_revision
        || !boundary.original_workspace_unchanged
    {
        return recover(
            &mut artifact,
            adapter,
            &boundary,
            "Boundary evidence did not preserve the original workspace.".to_owned(),
            false,
        );
    }
    step(
        &mut artifact,
        ChangeTransactionPhase::BoundaryPrepared,
        true,
        format!("Prepared boundary {}.", boundary.boundary_id),
    );
    if let Some(reason) = cancellation.reason() {
        return recover(&mut artifact, adapter, &boundary, reason, true);
    }

    let application = match adapter.apply(&boundary, &request.manifest) {
        Ok(value) => value,
        Err(error) => {
            return recover(
                &mut artifact,
                adapter,
                &boundary,
                format!("Candidate application failed: {error}"),
                false,
            );
        }
    };
    if !application_matches(&request.manifest, &application) {
        return recover(
            &mut artifact,
            adapter,
            &boundary,
            "Apply evidence does not match every manifest change.".to_owned(),
            false,
        );
    }
    artifact.application = Some(application);
    step(
        &mut artifact,
        ChangeTransactionPhase::CandidateApplied,
        true,
        "Every manifest change was applied inside the candidate boundary.",
    );
    if let Some(reason) = cancellation.reason() {
        return recover(&mut artifact, adapter, &boundary, reason, true);
    }

    let verification = match adapter.verify(&boundary, &request.verification, cancellation) {
        Ok(value) => value,
        Err(error) => {
            return recover(
                &mut artifact,
                adapter,
                &boundary,
                format!("Verification adapter failed: {error}"),
                false,
            );
        }
    };
    if verification.check_id != request.verification.check_id
        || !verification
            .isolation
            .is_consistent_with(&request.verification.isolation)
        || (verification.success
            && (verification.exit_code != Some(0)
                || verification.timed_out
                || verification.cancelled))
    {
        return recover(
            &mut artifact,
            adapter,
            &boundary,
            "Verification evidence is inconsistent with the selected check.".to_owned(),
            false,
        );
    }
    let verification_cancelled = verification.cancelled;
    let verified = verification.success;
    artifact.verification = Some(verification);
    step(
        &mut artifact,
        ChangeTransactionPhase::VerificationCompleted,
        verified,
        if verified {
            "The policy-named verification check passed."
        } else {
            "The policy-named verification check failed."
        },
    );
    if verification_cancelled {
        let reason = cancellation
            .reason()
            .unwrap_or_else(|| "Candidate verification was cancelled.".to_owned());
        return recover(&mut artifact, adapter, &boundary, reason, true);
    }
    if !verified {
        return recover(
            &mut artifact,
            adapter,
            &boundary,
            "Candidate verification failed.".to_owned(),
            false,
        );
    }

    let retention = match adapter.retain(&boundary) {
        Ok(value) => value,
        Err(error) => {
            return recover(
                &mut artifact,
                adapter,
                &boundary,
                format!("Candidate retention failed: {error}"),
                false,
            );
        }
    };
    if retention.candidate_id.trim().is_empty()
        || retention.boundary_id != boundary.boundary_id
        || !retention.retained
        || !retention.original_workspace_unchanged
    {
        return recover(
            &mut artifact,
            adapter,
            &boundary,
            "Candidate retention evidence is inconsistent with the prepared boundary.".to_owned(),
            false,
        );
    }
    artifact.retention = Some(retention);
    step(
        &mut artifact,
        ChangeTransactionPhase::CandidateRetained,
        true,
        "The verified candidate boundary was retained for explicit later promotion.",
    );

    artifact.status = ChangeTransactionStatus::VerifiedCandidate;
    step(
        &mut artifact,
        ChangeTransactionPhase::CandidateVerified,
        true,
        "The verified candidate remains isolated; promotion requires a later explicit gate.",
    );
    artifact
}
