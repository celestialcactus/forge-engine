use std::cell::Cell;

use forge_core::{
    ApplicationChange, AppliedChangeEvidence, ApplyEvidence, ApprovalFacts, BoundaryEvidence,
    BoundedTextEvidence, CandidateRetentionEvidence, CapabilityCall, ChangeApplicationManifest,
    ChangeTransactionAdapter, ChangeTransactionPhase, ChangeTransactionRequest,
    ChangeTransactionStatus, HostPolicyFact, HostPolicyPosture, IsolationEnforcement,
    IsolationEvidence, IsolationProfile, IsolationRequest, NoCancellation, UserConsentFact,
    UserConsentStatus, VerificationEvidence, VerificationSelection, execute_candidate_transaction,
    proposal_id_for_manifest,
};
use serde_json::json;
use sha2::{Digest, Sha256};

fn digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn manifest() -> ChangeApplicationManifest {
    let mut manifest = ChangeApplicationManifest {
        schema_version: 1,
        proposal_id: String::new(),
        snapshot_id: "workspace:fixture".to_owned(),
        changes: vec![ApplicationChange {
            path: "src/example.ts".to_owned(),
            before_sha256: digest("before\n"),
            after_sha256: digest("after\n"),
            replacement_text: "after\n".to_owned(),
        }],
    };
    manifest.proposal_id = proposal_id_for_manifest(&manifest);
    manifest
}

fn request(posture: HostPolicyPosture) -> ChangeTransactionRequest {
    ChangeTransactionRequest {
        transaction_id: "transaction:fixture".to_owned(),
        expected_base_revision: "fixture-revision".to_owned(),
        call: CapabilityCall {
            id: "call-apply".to_owned(),
            capability_id: "workspace.change.apply".to_owned(),
            input: json!({
                "transactionId": "transaction:fixture",
                "expectedBaseRevision": "fixture-revision",
                "proposalId": manifest().proposal_id,
                "snapshotId": "workspace:fixture",
                "verificationCheckId": "fixture.check",
                "isolationProfile": "trusted",
                "isolationProviderId": null,
                "isolationBoundaryId": null,
            }),
        },
        manifest: manifest(),
        approval_facts: ApprovalFacts {
            schema_version: 1,
            call_id: "call-apply".to_owned(),
            capability_id: "workspace.change.apply".to_owned(),
            host_policy: HostPolicyFact {
                posture,
                source: "fixture.host-policy".to_owned(),
                reason: "Fixture policy.".to_owned(),
            },
            user_consent: UserConsentFact {
                status: UserConsentStatus::NotRequired,
                source: "fixture.host-ui".to_owned(),
                reason: "Fixture consent is not interactive.".to_owned(),
            },
        },
        verification: VerificationSelection {
            check_id: "fixture.check".to_owned(),
            isolation: IsolationRequest::trusted(),
        },
    }
}

#[derive(Default)]
struct FakeAdapter {
    operations: Vec<&'static str>,
    fail_apply: bool,
    fail_recovery: bool,
    malformed_apply: bool,
    malformed_isolation: bool,
    verification_success: bool,
}

impl FakeAdapter {
    fn passing() -> Self {
        Self {
            verification_success: true,
            ..Self::default()
        }
    }
}

impl ChangeTransactionAdapter for FakeAdapter {
    fn prepare(
        &mut self,
        _manifest: &ChangeApplicationManifest,
    ) -> Result<BoundaryEvidence, String> {
        self.operations.push("prepare");
        Ok(BoundaryEvidence {
            boundary_id: "boundary:fixture".to_owned(),
            base_revision: "fixture-revision".to_owned(),
            original_workspace_unchanged: true,
        })
    }

    fn apply(
        &mut self,
        _boundary: &BoundaryEvidence,
        manifest: &ChangeApplicationManifest,
    ) -> Result<ApplyEvidence, String> {
        self.operations.push("apply");
        if self.fail_apply {
            return Err("fixture apply failure".to_owned());
        }
        let change = &manifest.changes[0];
        Ok(ApplyEvidence {
            changes: vec![AppliedChangeEvidence {
                path: if self.malformed_apply {
                    "other.ts".to_owned()
                } else {
                    change.path.clone()
                },
                after_sha256: change.after_sha256.clone(),
            }],
            diff: None,
        })
    }

    fn verify(
        &mut self,
        _boundary: &BoundaryEvidence,
        selection: &VerificationSelection,
        _cancellation: &dyn forge_core::Cancellation,
    ) -> Result<VerificationEvidence, String> {
        self.operations.push("verify");
        Ok(VerificationEvidence {
            check_id: selection.check_id.clone(),
            success: self.verification_success,
            exit_code: Some(if self.verification_success { 0 } else { 1 }),
            timed_out: false,
            cancelled: false,
            stdout_bytes: 7,
            stderr_bytes: 0,
            output_truncated: false,
            stdout: "fixture".to_owned(),
            stderr: String::new(),
            isolation: IsolationEvidence {
                requested_profile: IsolationProfile::Trusted,
                effective_profile: IsolationProfile::Trusted,
                enforcement: if self.malformed_isolation {
                    IsolationEnforcement::HostAttested
                } else {
                    IsolationEnforcement::None
                },
                provider_id: "fixture.provider".to_owned(),
                boundary_id: None,
                forge_enforced: false,
                controls: Vec::new(),
                limitations: vec!["Fixture executes without containment.".to_owned()],
            },
        })
    }

    fn retain(
        &mut self,
        boundary: &BoundaryEvidence,
    ) -> Result<CandidateRetentionEvidence, String> {
        self.operations.push("retain");
        Ok(CandidateRetentionEvidence {
            candidate_id: "candidate:fixture".to_owned(),
            boundary_id: boundary.boundary_id.clone(),
            retained: true,
            original_workspace_unchanged: true,
            final_diff: BoundedTextEvidence {
                text: "fixture diff".to_owned(),
                total_bytes: 12,
                sha256: digest("fixture diff"),
                truncated: false,
            },
        })
    }

    fn recover(&mut self, _boundary: &BoundaryEvidence, _cause: &str) -> Result<String, String> {
        self.operations.push("recover");
        if self.fail_recovery {
            Err("fixture cleanup failure".to_owned())
        } else {
            Ok("Candidate boundary removed.".to_owned())
        }
    }
}

struct CancelOnCheck {
    checks: Cell<u32>,
    cancel_at: u32,
}

impl forge_core::Cancellation for CancelOnCheck {
    fn reason(&self) -> Option<String> {
        let next = self.checks.get() + 1;
        self.checks.set(next);
        (next >= self.cancel_at).then(|| "Fixture cancellation.".to_owned())
    }
}

#[test]
fn verified_candidate_has_one_rust_owned_phase_sequence() {
    let mut adapter = FakeAdapter::passing();
    let artifact = execute_candidate_transaction(
        &request(HostPolicyPosture::Allow),
        &mut adapter,
        &NoCancellation,
    );

    assert_eq!(artifact.status, ChangeTransactionStatus::VerifiedCandidate);
    assert_eq!(adapter.operations, ["prepare", "apply", "verify", "retain"]);
    assert_eq!(
        artifact
            .steps
            .iter()
            .map(|step| &step.phase)
            .collect::<Vec<_>>(),
        [
            &ChangeTransactionPhase::ManifestValidated,
            &ChangeTransactionPhase::ApprovalResolved,
            &ChangeTransactionPhase::BoundaryPrepared,
            &ChangeTransactionPhase::CandidateApplied,
            &ChangeTransactionPhase::VerificationCompleted,
            &ChangeTransactionPhase::CandidateRetained,
            &ChangeTransactionPhase::CandidateVerified,
        ]
    );
    assert_eq!(
        artifact
            .steps
            .iter()
            .map(|step| step.sequence)
            .collect::<Vec<_>>(),
        [1, 2, 3, 4, 5, 6, 7]
    );
    assert!(artifact.recovery.is_none());
}

#[test]
fn denial_prevents_boundary_or_adapter_work() {
    let mut adapter = FakeAdapter::passing();
    let artifact = execute_candidate_transaction(
        &request(HostPolicyPosture::Deny),
        &mut adapter,
        &NoCancellation,
    );

    assert_eq!(artifact.status, ChangeTransactionStatus::NotAuthorized);
    assert!(adapter.operations.is_empty());
    assert_eq!(artifact.steps.len(), 2);
}

#[test]
fn tampered_replacement_fails_before_approval_or_adapter_work() {
    let mut request = request(HostPolicyPosture::Allow);
    request.manifest.changes[0].replacement_text = "tampered\n".to_owned();
    let mut adapter = FakeAdapter::passing();

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::Failed);
    assert!(adapter.operations.is_empty());
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("digest mismatch"))
    );
}

#[test]
fn apply_failure_recovers_the_candidate_boundary() {
    let mut adapter = FakeAdapter {
        fail_apply: true,
        ..FakeAdapter::passing()
    };
    let artifact = execute_candidate_transaction(
        &request(HostPolicyPosture::Allow),
        &mut adapter,
        &NoCancellation,
    );

    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert_eq!(adapter.operations, ["prepare", "apply", "recover"]);
    assert_eq!(
        artifact.recovery.as_ref().map(|item| item.success),
        Some(true)
    );
}

#[test]
fn failed_verification_recovers_instead_of_promoting() {
    let mut adapter = FakeAdapter::default();
    let artifact = execute_candidate_transaction(
        &request(HostPolicyPosture::Allow),
        &mut adapter,
        &NoCancellation,
    );

    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert_eq!(
        adapter.operations,
        ["prepare", "apply", "verify", "recover"]
    );
    assert_eq!(
        artifact.verification.as_ref().map(|item| item.success),
        Some(false)
    );
}

#[test]
fn malformed_apply_evidence_is_recovered_and_never_verified() {
    let mut adapter = FakeAdapter {
        malformed_apply: true,
        ..FakeAdapter::passing()
    };
    let artifact = execute_candidate_transaction(
        &request(HostPolicyPosture::Allow),
        &mut adapter,
        &NoCancellation,
    );

    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert_eq!(adapter.operations, ["prepare", "apply", "recover"]);
}

#[test]
fn inconsistent_isolation_evidence_is_recovered_before_retention() {
    let mut adapter = FakeAdapter {
        malformed_isolation: true,
        ..FakeAdapter::passing()
    };
    let artifact = execute_candidate_transaction(
        &request(HostPolicyPosture::Allow),
        &mut adapter,
        &NoCancellation,
    );

    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert_eq!(
        adapter.operations,
        ["prepare", "apply", "verify", "recover"]
    );
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("Verification evidence is inconsistent"))
    );
}
#[test]
fn cleanup_failure_is_terminal_and_explicit() {
    let mut adapter = FakeAdapter {
        fail_apply: true,
        fail_recovery: true,
        ..FakeAdapter::passing()
    };
    let artifact = execute_candidate_transaction(
        &request(HostPolicyPosture::Allow),
        &mut adapter,
        &NoCancellation,
    );

    assert_eq!(artifact.status, ChangeTransactionStatus::Failed);
    assert_eq!(
        artifact.recovery.as_ref().map(|item| item.success),
        Some(false)
    );
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("Recovery also failed"))
    );
}

#[test]
fn cancellation_after_boundary_preparation_triggers_recovery() {
    let cancellation = CancelOnCheck {
        checks: Cell::new(0),
        cancel_at: 3,
    };
    let mut adapter = FakeAdapter::passing();
    let artifact = execute_candidate_transaction(
        &request(HostPolicyPosture::Allow),
        &mut adapter,
        &cancellation,
    );

    assert_eq!(artifact.status, ChangeTransactionStatus::Cancelled);
    assert_eq!(
        artifact.cancellation_reason.as_deref(),
        Some("Fixture cancellation.")
    );
    assert!(artifact.failure.is_none());
    assert_eq!(adapter.operations, ["prepare", "recover"]);
    assert_eq!(
        artifact.recovery.as_ref().map(|item| item.success),
        Some(true)
    );
}
#[test]
fn proposal_identity_matches_the_typescript_slice_2a_contract() {
    assert_eq!(manifest().proposal_id, "change:53c6349f6e754aa91c10");
}
#[test]
fn approval_call_cannot_be_reused_for_a_different_proposal() {
    let mut request = request(HostPolicyPosture::Allow);
    request.call.input["proposalId"] = json!("change:swapped");
    let mut adapter = FakeAdapter::passing();

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::Failed);
    assert!(adapter.operations.is_empty());
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("approved capability call"))
    );
}

#[test]
fn prepared_boundary_must_match_the_approved_base_revision() {
    let mut request = request(HostPolicyPosture::Allow);
    request.expected_base_revision = "different-revision".to_owned();
    request.call.input["expectedBaseRevision"] = json!("different-revision");
    let mut adapter = FakeAdapter::passing();

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert_eq!(adapter.operations, ["prepare", "recover"]);
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("Boundary evidence"))
    );
}

#[test]
fn approval_call_cannot_be_reused_for_a_different_isolation_profile() {
    let mut request = request(HostPolicyPosture::Allow);
    request.verification.isolation = IsolationRequest {
        profile: IsolationProfile::Restricted,
        host_attestation: None,
    };
    let mut adapter = FakeAdapter::passing();

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::Failed);
    assert!(adapter.operations.is_empty());
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("approved capability call"))
    );
}
#[test]
fn application_manifest_retains_slice_2a_text_bounds() {
    let mut request = request(HostPolicyPosture::Allow);
    request.manifest.changes[0].replacement_text = "x".repeat(1_048_577);
    request.manifest.changes[0].after_sha256 =
        digest(&request.manifest.changes[0].replacement_text);
    request.manifest.proposal_id = proposal_id_for_manifest(&request.manifest);
    request.call.input["proposalId"] = json!(request.manifest.proposal_id);
    let mut adapter = FakeAdapter::passing();

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::Failed);
    assert!(adapter.operations.is_empty());
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("text bounds"))
    );
}
