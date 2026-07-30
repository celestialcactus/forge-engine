use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::{Signer, SigningKey};
use forge_core::{
    ApplicationChange, ApprovalFacts, AuthenticatedHostIsolationProvider, CapabilityCall,
    ChangeApplicationManifest, ChangeTransactionRequest, HostBoundaryNegotiator,
    HostBoundaryStatement, HostChallengeLedger, HostIsolationChallenge, HostPolicyFact,
    HostPolicyPosture, IsolatedProcessSpec, IsolationControl, IsolationEnforcement,
    IsolationPolicy, IsolationProvider, IsolationRequest, NoCancellation,
    SignedHostBoundaryStatement, TrustedHostKey, UserConsentFact, UserConsentStatus,
    VerificationCheck, VerificationSelection, derive_host_execution_binding,
    host_attestation_signing_bytes, proposal_id_for_manifest,
};
use serde_json::json;
use sha2::{Digest, Sha256};

static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn fixture_root(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "forge-host-provider-{label}-{}-{unique}-{sequence}",
        std::process::id()
    ));
    fs::create_dir_all(&root).unwrap();
    root
}

fn manifest() -> ChangeApplicationManifest {
    let mut manifest = ChangeApplicationManifest {
        schema_version: 1,
        proposal_id: String::new(),
        snapshot_id: "workspace:host-provider".to_owned(),
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

fn request() -> ChangeTransactionRequest {
    let manifest = manifest();
    ChangeTransactionRequest {
        transaction_id: "transaction:host-provider".to_owned(),
        expected_base_revision: "fixture-revision".to_owned(),
        call: CapabilityCall {
            id: "call-host-apply".to_owned(),
            capability_id: "workspace.change.apply".to_owned(),
            input: json!({
                "transactionId": "transaction:host-provider",
                "expectedBaseRevision": "fixture-revision",
                "proposalId": manifest.proposal_id,
                "snapshotId": manifest.snapshot_id,
                "verificationCheckId": "fixture.host-check",
                "isolationProfile": "host_managed",
                "isolationProviderId": "fixture.host",
                "isolationBoundaryId": null,
            }),
        },
        manifest,
        approval_facts: ApprovalFacts {
            schema_version: 1,
            call_id: "call-host-apply".to_owned(),
            capability_id: "workspace.change.apply".to_owned(),
            host_policy: HostPolicyFact {
                posture: HostPolicyPosture::Allow,
                source: "fixture.host-policy".to_owned(),
                reason: "Fixture policy allows this exact call.".to_owned(),
            },
            user_consent: UserConsentFact {
                status: UserConsentStatus::Granted,
                source: "fixture.host-ui".to_owned(),
                reason: "Fixture user approved the exact call.".to_owned(),
            },
        },
        verification: VerificationSelection {
            check_id: "fixture.host-check".to_owned(),
            isolation: IsolationRequest::host_managed("fixture.host"),
        },
    }
}

fn check() -> VerificationCheck {
    VerificationCheck {
        check_id: "fixture.host-check".to_owned(),
        executable: success_command().0,
        arguments: success_command().1,
        environment: Vec::new(),
        inherited_environment: Vec::new(),
        isolation_policy: IsolationPolicy::host_managed(
            vec!["fixture.host".to_owned()],
            vec![IsolationControl::Process, IsolationControl::Filesystem],
        ),
        timeout: Duration::from_secs(5),
        max_output_bytes: 4_096,
    }
}

#[cfg(windows)]
fn success_command() -> (PathBuf, Vec<String>) {
    (
        PathBuf::from("cmd.exe"),
        vec![
            "/d".to_owned(),
            "/c".to_owned(),
            "echo provider-ok".to_owned(),
        ],
    )
}

#[cfg(unix)]
fn success_command() -> (PathBuf, Vec<String>) {
    (
        PathBuf::from("/bin/sh"),
        vec!["-c".to_owned(), "printf provider-ok".to_owned()],
    )
}

struct SigningNegotiator {
    signing_key: SigningKey,
    calls: AtomicUsize,
}

impl HostBoundaryNegotiator for SigningNegotiator {
    fn negotiate(
        &self,
        challenge: &HostIsolationChallenge,
        _timeout: Duration,
        _cancellation: &dyn forge_core::Cancellation,
    ) -> Result<SignedHostBoundaryStatement, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let statement = HostBoundaryStatement {
            challenge_id: challenge.challenge_id.clone(),
            key_id: "fixture-key".to_owned(),
            boundary_id: "boundary:authenticated-host".to_owned(),
            process_boundary_inherited: true,
            attested_controls: vec![IsolationControl::Process, IsolationControl::Filesystem],
        };
        let transcript = host_attestation_signing_bytes(challenge, &statement)?;
        Ok(SignedHostBoundaryStatement {
            statement,
            signature_hex: hex(&self.signing_key.sign(&transcript).to_bytes()),
        })
    }
}

fn provider(root: &Path) -> (AuthenticatedHostIsolationProvider, Arc<SigningNegotiator>) {
    let signing_key = SigningKey::from_bytes(&[17_u8; 32]);
    let public_key_hex = hex(signing_key.verifying_key().as_bytes());
    let ledger = HostChallengeLedger::new(
        root.join("ledger"),
        vec![TrustedHostKey {
            provider_id: "fixture.host".to_owned(),
            key_id: "fixture-key".to_owned(),
            public_key_hex,
        }],
    )
    .unwrap();
    let negotiator = Arc::new(SigningNegotiator {
        signing_key,
        calls: AtomicUsize::new(0),
    });
    let provider = AuthenticatedHostIsolationProvider::try_new(
        "fixture.host",
        ledger,
        negotiator.clone(),
        Duration::from_secs(5),
    )
    .unwrap();
    (provider, negotiator)
}

fn process(root: &Path) -> IsolatedProcessSpec {
    let (executable, arguments) = success_command();
    IsolatedProcessSpec {
        executable,
        arguments,
        environment: Vec::new(),
        inherited_environment: Vec::new(),
        working_directory: root.to_path_buf(),
        timeout: Duration::from_secs(5),
        max_output_bytes: 4_096,
    }
}

#[test]
fn rust_binding_changes_with_capability_and_policy_semantics() {
    let request = request();
    let check = check();
    let baseline = derive_host_execution_binding(&request, &check, "fixture.host").unwrap();
    let repeated = derive_host_execution_binding(&request, &check, "fixture.host").unwrap();
    assert_eq!(baseline, repeated);

    let mut changed_call = request.clone();
    changed_call.transaction_id = "transaction:different".to_owned();
    changed_call.call.input["transactionId"] = json!("transaction:different");
    let changed_call =
        derive_host_execution_binding(&changed_call, &check, "fixture.host").unwrap();
    assert_ne!(
        baseline.capability_digest(),
        changed_call.capability_digest()
    );
    assert_eq!(baseline.policy_digest(), changed_call.policy_digest());

    let mut changed_policy = check.clone();
    changed_policy.timeout = Duration::from_secs(6);
    let changed_policy =
        derive_host_execution_binding(&request, &changed_policy, "fixture.host").unwrap();
    assert_eq!(
        baseline.capability_digest(),
        changed_policy.capability_digest()
    );
    assert_ne!(baseline.policy_digest(), changed_policy.policy_digest());
    let mut reordered_controls = check.clone();
    reordered_controls
        .isolation_policy
        .required_controls
        .reverse();
    let reordered_controls =
        derive_host_execution_binding(&request, &reordered_controls, "fixture.host").unwrap();
    assert_eq!(baseline.policy_digest(), reordered_controls.policy_digest());
}

#[test]
fn authenticated_provider_consumes_one_bound_grant_and_exports_full_evidence() {
    let root = fixture_root("success");
    let (provider, negotiator) = provider(&root);
    let request = request();
    let check = check();
    let binding = derive_host_execution_binding(&request, &check, "fixture.host").unwrap();

    assert!(
        provider
            .execute(
                &check.isolation_policy,
                &request.verification.isolation,
                &process(&root),
                &NoCancellation,
            )
            .unwrap_err()
            .contains("single-use execution grant")
    );

    let grant = provider
        .authorize_host_managed(
            &check.isolation_policy,
            &request.verification.isolation,
            &binding,
            &NoCancellation,
        )
        .unwrap();
    let challenge_id = grant.evidence().authority.challenge.challenge_id.clone();
    let outcome = provider
        .execute_host_managed(
            grant,
            &check.isolation_policy,
            &request.verification.isolation,
            &binding,
            &process(&root),
            &NoCancellation,
        )
        .unwrap();

    assert_eq!(negotiator.calls.load(Ordering::SeqCst), 1);
    assert!(outcome.status.is_some_and(|status| status.success()));
    assert_eq!(
        outcome.isolation.enforcement,
        IsolationEnforcement::HostAttested
    );
    assert!(!outcome.isolation.forge_enforced);
    assert_eq!(
        outcome.isolation.boundary_id.as_deref(),
        Some("boundary:authenticated-host")
    );
    let authority = outcome
        .isolation
        .host_authority
        .expect("host authority evidence");
    assert_eq!(authority.challenge.challenge_id, challenge_id);
    assert_eq!(
        authority.challenge.capability_digest,
        binding.capability_digest()
    );
    assert_eq!(authority.challenge.policy_digest, binding.policy_digest());
    assert!(
        root.join("ledger")
            .join("consumed")
            .join(format!("{challenge_id}.json"))
            .is_file()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn tampered_consumed_evidence_fails_before_verifier_launch() {
    let root = fixture_root("tamper");
    let (provider, _) = provider(&root);
    let request = request();
    let check = check();
    let binding = derive_host_execution_binding(&request, &check, "fixture.host").unwrap();
    let grant = provider
        .authorize_host_managed(
            &check.isolation_policy,
            &request.verification.isolation,
            &binding,
            &NoCancellation,
        )
        .unwrap();
    let challenge_id = grant.evidence().authority.challenge.challenge_id.clone();
    fs::write(
        root.join("ledger")
            .join("consumed")
            .join(format!("{challenge_id}.json")),
        b"{}",
    )
    .unwrap();

    let error = provider
        .execute_host_managed(
            grant,
            &check.isolation_policy,
            &request.verification.isolation,
            &binding,
            &process(&root),
            &NoCancellation,
        )
        .unwrap_err();
    assert!(error.contains("missing field") || error.contains("invalid"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn grant_for_one_rust_binding_cannot_execute_another() {
    let root = fixture_root("cross-binding");
    let (provider, _) = provider(&root);
    let request = request();
    let check = check();
    let binding = derive_host_execution_binding(&request, &check, "fixture.host").unwrap();
    let grant = provider
        .authorize_host_managed(
            &check.isolation_policy,
            &request.verification.isolation,
            &binding,
            &NoCancellation,
        )
        .unwrap();
    let mut changed_check = check.clone();
    changed_check.timeout = Duration::from_secs(6);
    let changed = derive_host_execution_binding(&request, &changed_check, "fixture.host").unwrap();

    assert!(
        provider
            .execute_host_managed(
                grant,
                &check.isolation_policy,
                &request.verification.isolation,
                &changed,
                &process(&root),
                &NoCancellation,
            )
            .unwrap_err()
            .contains("does not match")
    );
    fs::remove_dir_all(root).unwrap();
}
