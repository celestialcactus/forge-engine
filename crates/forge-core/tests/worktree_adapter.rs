use std::{
    cell::Cell,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use forge_core::{
    ApplicationChange, ApprovalFacts, CandidateLeaseState, CapabilityCall,
    ChangeApplicationManifest, ChangeTransactionRequest, ChangeTransactionStatus,
    CleanRevisionWorktreeAdapter, FileCandidateLeaseStore, HostIsolationAttestation,
    HostPolicyFact, HostPolicyPosture, IsolationControl, IsolationEnforcement, IsolationPolicy,
    IsolationProfile, IsolationRequest, NoCancellation, UserConsentFact, UserConsentStatus,
    VerificationCheck, VerificationSelection, WorktreeAdapterConfig, execute_candidate_transaction,
    proposal_id_for_manifest, workspace_snapshot_id,
};
use serde_json::json;
use sha2::{Digest, Sha256};

static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    root: PathBuf,
    repository: PathBuf,
    candidates: PathBuf,
    base_revision: String,
    manifest: ChangeApplicationManifest,
}

impl Fixture {
    fn new() -> Self {
        let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!(
            "forge-worktree-adapter-{}-{unique}-{sequence}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let candidates = root.join("candidates");
        fs::create_dir_all(&repository).unwrap();
        fs::create_dir_all(&candidates).unwrap();
        git(&repository, &["init", "--quiet"]);
        git(&repository, &["config", "user.name", "Forge Fixture"]);
        git(
            &repository,
            &["config", "user.email", "fixture@forge.invalid"],
        );
        fs::write(repository.join(".gitattributes"), "* text eol=lf\n").unwrap();
        fs::write(repository.join(".gitignore"), ".env\n").unwrap();
        fs::write(repository.join("evidence.txt"), "before\n").unwrap();
        git(&repository, &["add", "."]);
        git(&repository, &["commit", "--quiet", "-m", "fixture base"]);
        let base_revision = git_output(&repository, &["rev-parse", "HEAD"])
            .trim()
            .to_owned();
        let mut manifest = ChangeApplicationManifest {
            schema_version: 1,
            proposal_id: String::new(),
            snapshot_id: workspace_snapshot_id(&repository).unwrap(),
            changes: vec![ApplicationChange {
                path: "evidence.txt".to_owned(),
                before_sha256: digest(b"before\n"),
                after_sha256: digest(b"after\n"),
                replacement_text: "after\n".to_owned(),
            }],
        };
        manifest.proposal_id = proposal_id_for_manifest(&manifest);
        Self {
            root,
            repository,
            candidates,
            base_revision,
            manifest,
        }
    }

    fn adapter(&self, check: VerificationCheck) -> CleanRevisionWorktreeAdapter {
        CleanRevisionWorktreeAdapter::try_new(WorktreeAdapterConfig::new(
            &self.repository,
            &self.candidates,
            &self.base_revision,
            vec![check],
        ))
        .unwrap()
    }

    fn request(&self, check_id: &str) -> ChangeTransactionRequest {
        ChangeTransactionRequest {
            transaction_id: "transaction:fixture".to_owned(),
            expected_base_revision: self.base_revision.clone(),
            call: CapabilityCall {
                id: "call-apply".to_owned(),
                capability_id: "workspace.change.apply".to_owned(),
                input: json!({
                    "transactionId": "transaction:fixture",
                    "expectedBaseRevision": self.base_revision,
                    "proposalId": self.manifest.proposal_id,
                    "snapshotId": self.manifest.snapshot_id,
                    "verificationCheckId": check_id,
                    "isolationProfile": "trusted",
                    "isolationProviderId": null,
                    "isolationBoundaryId": null,
                }),
            },
            manifest: self.manifest.clone(),
            approval_facts: ApprovalFacts {
                schema_version: 1,
                call_id: "call-apply".to_owned(),
                capability_id: "workspace.change.apply".to_owned(),
                host_policy: HostPolicyFact {
                    posture: HostPolicyPosture::Allow,
                    source: "fixture.policy".to_owned(),
                    reason: "Fixture allows the exact call.".to_owned(),
                },
                user_consent: UserConsentFact {
                    status: UserConsentStatus::NotRequired,
                    source: "fixture.ui".to_owned(),
                    reason: "Fixture consent is not interactive.".to_owned(),
                },
            },
            verification: VerificationSelection {
                check_id: check_id.to_owned(),
                isolation: IsolationRequest::trusted(),
            },
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .current_dir(root)
        .args(arguments)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_output(root: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(root)
        .args(arguments)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn check(helper: &str, timeout: Duration) -> VerificationCheck {
    VerificationCheck {
        check_id: "fixture.check".to_owned(),
        executable: env::current_exe().unwrap(),
        arguments: vec![
            "--exact".to_owned(),
            helper.to_owned(),
            "--ignored".to_owned(),
            "--nocapture".to_owned(),
        ],
        environment: Vec::new(),
        isolation_policy: IsolationPolicy::trusted(),
        timeout,
        max_output_bytes: 1_024,
    }
}

#[test]
fn clean_revision_is_applied_verified_and_retained_without_mutating_the_workspace() {
    let fixture = Fixture::new();
    let mut adapter = fixture.adapter(check("verifier_pass_helper", Duration::from_secs(5)));
    let artifact = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &NoCancellation,
    );

    assert_eq!(
        artifact.status,
        ChangeTransactionStatus::VerifiedCandidate,
        "{:?}",
        artifact.failure
    );
    assert_eq!(
        fs::read_to_string(fixture.repository.join("evidence.txt")).unwrap(),
        "before\n"
    );
    let candidate = adapter.retained_candidate_path().unwrap();
    assert_eq!(
        fs::read_to_string(candidate.join("evidence.txt")).unwrap(),
        "after\n"
    );
    let isolation = &artifact.verification.as_ref().unwrap().isolation;
    assert_eq!(isolation.requested_profile, IsolationProfile::Trusted);
    assert_eq!(isolation.enforcement, IsolationEnforcement::None);
    assert!(!isolation.forge_enforced);
    assert!(
        isolation
            .limitations
            .iter()
            .any(|item| item.contains("does not restrict filesystem"))
    );
    let retention = artifact.retention.as_ref().unwrap();
    assert!(retention.final_diff.text.contains("+after"));
    assert!(!retention.final_diff.truncated);
    adapter.discard_retained_candidate().unwrap();
    assert!(adapter.retained_candidate_path().is_none());
}

#[test]
fn retained_candidate_is_restart_discoverable_and_discardable_by_opaque_id() {
    let fixture = Fixture::new();
    let (candidate_id, candidate_path) = {
        let mut adapter = fixture.adapter(check("verifier_pass_helper", Duration::from_secs(5)));
        let artifact = execute_candidate_transaction(
            &fixture.request("fixture.check"),
            &mut adapter,
            &NoCancellation,
        );
        assert_eq!(artifact.status, ChangeTransactionStatus::VerifiedCandidate);
        let retention = artifact.retention.unwrap();
        assert_eq!(
            adapter.retained_candidate_id(),
            Some(retention.candidate_id.as_str())
        );
        (
            retention.candidate_id,
            adapter.retained_candidate_path().unwrap().to_path_buf(),
        )
    };

    let state_root = fixture.candidates.join(".forge-leases");
    let retained_files = fs::read_dir(&state_root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|value| value == "json"))
        .collect::<Vec<_>>();
    assert_eq!(retained_files.len(), 1);
    let stored = fs::read_to_string(&retained_files[0]).unwrap();
    assert!(!stored.contains("replacementText"));
    assert!(!stored.contains("after\\n"));

    let store =
        FileCandidateLeaseStore::try_new(&fixture.repository, &fixture.candidates, &state_root)
            .unwrap();
    let retained = store.load(&candidate_id).unwrap();
    assert_eq!(retained.state, CandidateLeaseState::Retained);
    assert_eq!(Path::new(&retained.candidate_path), candidate_path);

    let missing_git = fixture.candidates.join("missing-git");
    assert!(store.discard(&candidate_id, &missing_git).is_err());
    let cleanup_failed = store.load(&candidate_id).unwrap();
    assert_eq!(cleanup_failed.state, CandidateLeaseState::CleanupFailed);
    assert!(cleanup_failed.cleanup_failure.is_some());
    assert!(candidate_path.exists());

    let discarded = store.discard(&candidate_id, "git").unwrap();
    assert_eq!(discarded.state, CandidateLeaseState::Discarded);
    assert!(!candidate_path.exists());
    assert_eq!(
        store.load(&candidate_id).unwrap().state,
        CandidateLeaseState::Discarded
    );
    assert_eq!(
        store.discard(&candidate_id, "git").unwrap().state,
        CandidateLeaseState::Discarded
    );
    assert_eq!(
        fs::read_to_string(fixture.repository.join("evidence.txt")).unwrap(),
        "before\n"
    );
}

#[test]
fn host_managed_execution_records_attestation_without_claiming_forge_enforcement() {
    let fixture = Fixture::new();
    let mut host_check = check("verifier_pass_helper", Duration::from_secs(5));
    host_check.isolation_policy = IsolationPolicy::host_managed(
        vec!["fixture.host".to_owned()],
        vec![IsolationControl::Process, IsolationControl::Filesystem],
    );
    let mut request = fixture.request("fixture.check");
    request.call.input["isolationProfile"] = json!("host_managed");
    request.call.input["isolationProviderId"] = json!("fixture.host");
    request.call.input["isolationBoundaryId"] = json!("boundary:host-fixture");
    request.verification.isolation = IsolationRequest {
        profile: IsolationProfile::HostManaged,
        host_attestation: Some(HostIsolationAttestation {
            provider_id: "fixture.host".to_owned(),
            boundary_id: "boundary:host-fixture".to_owned(),
            process_boundary_inherited: true,
            attested_controls: vec![IsolationControl::Process, IsolationControl::Filesystem],
        }),
    };
    let mut adapter = fixture.adapter(host_check);

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::VerifiedCandidate);
    let isolation = &artifact.verification.as_ref().unwrap().isolation;
    assert_eq!(isolation.enforcement, IsolationEnforcement::HostAttested);
    assert_eq!(isolation.provider_id, "fixture.host");
    assert_eq!(
        isolation.boundary_id.as_deref(),
        Some("boundary:host-fixture")
    );
    assert!(!isolation.forge_enforced);
    assert!(
        isolation
            .limitations
            .iter()
            .any(|item| item.contains("not independently enforced"))
    );
    adapter.discard_retained_candidate().unwrap();
}

#[test]
fn host_managed_execution_must_satisfy_every_policy_required_control() {
    let fixture = Fixture::new();
    let mut host_check = check("verifier_pass_helper", Duration::from_secs(5));
    host_check.isolation_policy = IsolationPolicy::host_managed(
        vec!["fixture.host".to_owned()],
        vec![IsolationControl::Process, IsolationControl::Network],
    );
    let mut request = fixture.request("fixture.check");
    request.call.input["isolationProfile"] = json!("host_managed");
    request.call.input["isolationProviderId"] = json!("fixture.host");
    request.call.input["isolationBoundaryId"] = json!("boundary:host-fixture");
    request.verification.isolation = IsolationRequest {
        profile: IsolationProfile::HostManaged,
        host_attestation: Some(HostIsolationAttestation {
            provider_id: "fixture.host".to_owned(),
            boundary_id: "boundary:host-fixture".to_owned(),
            process_boundary_inherited: true,
            attested_controls: vec![IsolationControl::Process],
        }),
    };
    let mut adapter = fixture.adapter(host_check);

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert_eq!(
        artifact.requested_isolation.profile,
        IsolationProfile::HostManaged
    );
    assert!(
        artifact.failure.as_deref().is_some_and(
            |message| message.contains("does not satisfy every policy-required control")
        )
    );
    assert!(artifact.verification.is_none());
}
#[test]
fn unsupported_restricted_execution_fails_closed_and_recovers_the_candidate() {
    let fixture = Fixture::new();
    let mut restricted_check = check("verifier_pass_helper", Duration::from_secs(5));
    restricted_check.isolation_policy =
        IsolationPolicy::restricted(vec![IsolationControl::Process]);
    let mut request = fixture.request("fixture.check");
    request.call.input["isolationProfile"] = json!("restricted");
    request.verification.isolation = IsolationRequest {
        profile: IsolationProfile::Restricted,
        host_attestation: None,
    };
    let mut adapter = fixture.adapter(restricted_check);

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert_eq!(
        artifact.requested_isolation.profile,
        IsolationProfile::Restricted
    );
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("cannot enforce the restricted profile"))
    );
    assert!(artifact.verification.is_none());
    assert!(adapter.retained_candidate_path().is_none());
}

#[test]
fn unapproved_host_isolation_provider_fails_closed() {
    let fixture = Fixture::new();
    let mut host_check = check("verifier_pass_helper", Duration::from_secs(5));
    host_check.isolation_policy = IsolationPolicy::host_managed(
        vec!["approved.host".to_owned()],
        vec![IsolationControl::Process],
    );
    let mut request = fixture.request("fixture.check");
    request.call.input["isolationProfile"] = json!("host_managed");
    request.call.input["isolationProviderId"] = json!("unapproved.host");
    request.call.input["isolationBoundaryId"] = json!("boundary:host-fixture");
    request.verification.isolation = IsolationRequest {
        profile: IsolationProfile::HostManaged,
        host_attestation: Some(HostIsolationAttestation {
            provider_id: "unapproved.host".to_owned(),
            boundary_id: "boundary:host-fixture".to_owned(),
            process_boundary_inherited: true,
            attested_controls: vec![IsolationControl::Process],
        }),
    };
    let mut adapter = fixture.adapter(host_check);

    let artifact = execute_candidate_transaction(&request, &mut adapter, &NoCancellation);

    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert!(
        artifact
            .failure
            .as_deref()
            .is_some_and(|message| message.contains("is not allowed by policy"))
    );
    assert!(artifact.verification.is_none());
}
#[test]
fn dirty_workspace_is_rejected_before_a_boundary_exists() {
    let fixture = Fixture::new();
    fs::write(fixture.repository.join("evidence.txt"), "dirty\n").unwrap();
    let mut adapter = fixture.adapter(check("verifier_pass_helper", Duration::from_secs(5)));
    let artifact = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &NoCancellation,
    );
    assert_eq!(artifact.status, ChangeTransactionStatus::Failed);
    assert!(artifact.failure.unwrap().contains("Git-clean"));
    assert!(adapter.retained_candidate_path().is_none());
}

#[test]
fn stale_expected_revision_is_rejected_before_worktree_creation() {
    let fixture = Fixture::new();
    let mut adapter = CleanRevisionWorktreeAdapter::try_new(WorktreeAdapterConfig::new(
        &fixture.repository,
        &fixture.candidates,
        "0000000000000000000000000000000000000000",
        vec![check("verifier_pass_helper", Duration::from_secs(5))],
    ))
    .unwrap();
    let artifact = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &NoCancellation,
    );
    assert_eq!(artifact.status, ChangeTransactionStatus::Failed);
    assert!(
        artifact
            .failure
            .unwrap()
            .contains("does not match expected base")
    );
    assert!(adapter.retained_candidate_path().is_none());
}

#[test]
fn ignored_snapshot_dependency_is_rejected_as_not_reproducible_from_the_revision() {
    let mut fixture = Fixture::new();
    fs::write(fixture.repository.join(".env"), "local-only\n").unwrap();
    fixture.manifest.snapshot_id = workspace_snapshot_id(&fixture.repository).unwrap();
    fixture.manifest.proposal_id = proposal_id_for_manifest(&fixture.manifest);
    let mut adapter = fixture.adapter(check("verifier_pass_helper", Duration::from_secs(5)));
    let artifact = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &NoCancellation,
    );
    assert_eq!(artifact.status, ChangeTransactionStatus::Failed);
    assert!(
        artifact
            .failure
            .unwrap()
            .contains("absent from a clean revision")
    );
}

#[test]
fn missing_or_failing_verifier_recovers_the_candidate_boundary() {
    let fixture = Fixture::new();
    let mut missing = check("verifier_pass_helper", Duration::from_secs(5));
    missing.executable = fixture.root.join("missing-verifier");
    let mut adapter = fixture.adapter(missing);
    let artifact = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &NoCancellation,
    );
    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert!(
        artifact
            .failure
            .unwrap()
            .contains("Could not start isolated process")
    );

    let fixture = Fixture::new();
    let mut adapter = fixture.adapter(check("verifier_fail_helper", Duration::from_secs(5)));
    let artifact = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &NoCancellation,
    );
    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert_eq!(artifact.verification.unwrap().exit_code, Some(101));
}

#[test]
fn timeout_and_in_flight_cancellation_are_distinct_and_recover() {
    let fixture = Fixture::new();
    let marker = fixture.root.join("descendant-marker.txt");
    let mut timeout_check = check("verifier_tree_helper", Duration::from_millis(100));
    timeout_check.environment.push((
        "FORGE_DESCENDANT_MARKER".to_owned(),
        marker.to_string_lossy().into_owned(),
    ));
    let mut adapter = fixture.adapter(timeout_check);
    let timed_out = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &NoCancellation,
    );
    assert_eq!(timed_out.status, ChangeTransactionStatus::Recovered);
    assert!(timed_out.verification.unwrap().timed_out);
    thread::sleep(Duration::from_millis(1_200));
    assert!(!marker.exists(), "verification descendant survived timeout");

    let fixture = Fixture::new();
    let cancellation = CancelAfterChecks {
        checks: Cell::new(0),
        cancel_at: 8,
    };
    let mut adapter = fixture.adapter(check("verifier_sleep_helper", Duration::from_secs(5)));
    let cancelled = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &cancellation,
    );
    assert_eq!(cancelled.status, ChangeTransactionStatus::Cancelled);
    assert!(cancelled.verification.unwrap().cancelled);
    assert!(cancelled.cancellation_reason.is_some());
}

#[test]
fn verifier_side_effect_outside_the_manifest_prevents_retention_and_recovers() {
    let fixture = Fixture::new();
    let mut adapter = fixture.adapter(check("verifier_extra_file_helper", Duration::from_secs(5)));
    let artifact = execute_candidate_transaction(
        &fixture.request("fixture.check"),
        &mut adapter,
        &NoCancellation,
    );
    assert_eq!(artifact.status, ChangeTransactionStatus::Recovered);
    assert!(artifact.failure.unwrap().contains("retention failed"));
    assert!(adapter.retained_candidate_path().is_none());
}

struct CancelAfterChecks {
    checks: Cell<u32>,
    cancel_at: u32,
}

impl forge_core::Cancellation for CancelAfterChecks {
    fn reason(&self) -> Option<String> {
        let next = self.checks.get() + 1;
        self.checks.set(next);
        (next >= self.cancel_at).then(|| "Fixture in-flight cancellation.".to_owned())
    }
}

#[test]
#[ignore]
fn verifier_pass_helper() {
    println!("verification passed");
}

#[test]
#[ignore]
fn verifier_fail_helper() {
    panic!("verification failed");
}

#[test]
#[ignore]
fn verifier_sleep_helper() {
    thread::sleep(Duration::from_secs(10));
}

#[test]
#[ignore]
#[allow(clippy::zombie_processes)]
fn verifier_tree_helper() {
    let _descendant = Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "verifier_descendant_helper",
            "--ignored",
            "--nocapture",
        ])
        .spawn()
        .unwrap();
    thread::sleep(Duration::from_secs(10));
}

#[test]
#[ignore]
fn verifier_descendant_helper() {
    thread::sleep(Duration::from_millis(800));
    fs::write(env::var("FORGE_DESCENDANT_MARKER").unwrap(), "survived\n").unwrap();
}

#[test]
#[ignore]
fn verifier_extra_file_helper() {
    fs::write("unexpected.txt", "unexpected\n").unwrap();
}
