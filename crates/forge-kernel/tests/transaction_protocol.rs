use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use forge_core::{
    ApplicationChange, ApprovalFacts, CapabilityCall, ChangeApplicationManifest,
    ChangeTransactionRequest, HostPolicyFact, HostPolicyPosture, IsolationRequest, UserConsentFact,
    UserConsentStatus, VerificationSelection, proposal_id_for_manifest, workspace_snapshot_id,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PROTOCOL_VERSION: &str = "forge.kernel.transaction.v1";
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
            .expect("clock")
            .as_nanos();
        let root = env::temp_dir().join(format!(
            "forge-kernel-transaction-{}-{unique}-{sequence}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let candidates = root.join("candidates");
        fs::create_dir_all(&repository).expect("repository");
        fs::create_dir_all(&candidates).expect("candidates");
        git(&repository, &["init", "--quiet"]);
        git(&repository, &["config", "user.name", "Forge Fixture"]);
        git(
            &repository,
            &["config", "user.email", "fixture@forge.invalid"],
        );
        fs::write(repository.join(".gitattributes"), "* text eol=lf\n").expect("attributes");
        fs::write(repository.join("evidence.txt"), "before\n").expect("evidence");
        git(&repository, &["add", "."]);
        git(&repository, &["commit", "--quiet", "-m", "fixture base"]);
        let base_revision = git_output(&repository, &["rev-parse", "HEAD"])
            .trim()
            .to_owned();
        let mut manifest = ChangeApplicationManifest {
            schema_version: 1,
            proposal_id: String::new(),
            snapshot_id: workspace_snapshot_id(&repository).expect("snapshot"),
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

    fn request(&self) -> ChangeTransactionRequest {
        ChangeTransactionRequest {
            transaction_id: "transaction:protocol-fixture".to_owned(),
            expected_base_revision: self.base_revision.clone(),
            call: CapabilityCall {
                id: "call-apply".to_owned(),
                capability_id: "workspace.change.apply".to_owned(),
                input: json!({
                    "transactionId": "transaction:protocol-fixture",
                    "expectedBaseRevision": self.base_revision,
                    "proposalId": self.manifest.proposal_id,
                    "snapshotId": self.manifest.snapshot_id,
                    "verificationCheckId": "fixture.check",
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
                    reason: "Fixture allows this exact call.".to_owned(),
                },
                user_consent: UserConsentFact {
                    status: UserConsentStatus::NotRequired,
                    source: "fixture.ui".to_owned(),
                    reason: "Fixture consent is non-interactive.".to_owned(),
                },
            },
            verification: VerificationSelection {
                check_id: "fixture.check".to_owned(),
                isolation: IsolationRequest::trusted(),
            },
        }
    }

    fn start(&self, helper: &str, environment: Value) -> Value {
        json!({
            "type": "transaction.start",
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": "request:protocol-fixture",
            "request": self.request(),
            "configuration": {
                "repositoryRoot": self.repository,
                "candidateParent": self.candidates,
                "gitExecutable": "git",
                "verificationChecks": [{
                    "checkId": "fixture.check",
                    "executable": env::current_exe().expect("test executable"),
                    "arguments": ["--exact", helper, "--ignored", "--nocapture"],
                    "environment": environment,
                    "timeoutMs": 10_000,
                    "maxOutputBytes": 4_096
                }],
                "maxDiffBytes": 100_000
            }
        })
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
        .expect("git");
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
        .expect("git");
    assert!(
        output.status.success(),
        "Git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("git stdout")
}

fn spawn_kernel() -> Child {
    Command::new(env!("CARGO_BIN_EXE_forge-kernel"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("kernel")
}

fn run_frame(frame: &[u8]) -> Output {
    let mut child = spawn_kernel();
    {
        let mut stdin = child.stdin.take().expect("stdin");
        stdin.write_all(frame).expect("frame");
        stdin.write_all(b"\n").expect("newline");
    }
    child.wait_with_output().expect("kernel output")
}

fn output_json(output: &Output) -> Value {
    assert!(
        output.stderr.is_empty(),
        "unexpected stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("single JSON output")
}

#[test]
fn trusted_transaction_returns_a_retained_candidate_without_mutating_the_workspace() {
    let fixture = Fixture::new();
    let start = fixture.start("verifier_pass_helper", json!([]));
    let output = run_frame(&serde_json::to_vec(&start).expect("start"));
    assert!(output.status.success());
    let result = output_json(&output);
    assert_eq!(result["type"], "transaction.result");
    assert_eq!(result["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(result["artifact"]["status"], "verified_candidate");
    assert_eq!(
        fs::read_to_string(fixture.repository.join("evidence.txt")).expect("original"),
        "before\n"
    );
    assert!(
        result["artifact"]["retention"]["candidateId"]
            .as_str()
            .is_some_and(|candidate_id| candidate_id.starts_with("candidate:"))
    );
}

#[test]
fn non_trusted_isolation_fails_closed_before_candidate_creation() {
    let fixture = Fixture::new();
    let mut start = fixture.start("verifier_pass_helper", json!([]));
    start["request"]["verification"]["isolation"] = json!({
        "profile": "host_managed",
        "hostAttestation": {
            "providerId": "fixture.host",
            "boundaryId": "boundary:fixture",
            "processBoundaryInherited": true,
            "attestedControls": ["filesystem"]
        }
    });
    start["request"]["call"]["input"]["isolationProfile"] = json!("host_managed");
    start["request"]["call"]["input"]["isolationProviderId"] = json!("fixture.host");
    start["request"]["call"]["input"]["isolationBoundaryId"] = json!("boundary:fixture");

    let output = run_frame(&serde_json::to_vec(&start).expect("start"));
    assert_eq!(output.status.code(), Some(2));
    let result = output_json(&output);
    assert_eq!(result["type"], "protocol.error");
    assert_eq!(result["code"], "unsupported_isolation_profile");
    assert_eq!(
        fs::read_dir(&fixture.candidates)
            .expect("candidate directory")
            .count(),
        0
    );
}

#[test]
fn malformed_start_does_not_echo_replacement_text() {
    let secret = "REPLACEMENT_SECRET_MUST_NOT_BE_ECHOED";
    let frame = format!(
        r#"{{"type":"transaction.start","protocolVersion":"{PROTOCOL_VERSION}","requestId":"request:redaction","request":{{"manifest":{{"replacementText":"{secret}"}}}}}}"#
    );
    let output = run_frame(frame.as_bytes());
    assert_eq!(output.status.code(), Some(2));
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!combined.contains(secret), "{combined}");
    let result = output_json(&output);
    assert_eq!(result["code"], "invalid_transaction_start");
}

#[test]
fn cancellation_during_verification_recovers_the_candidate_boundary() {
    let fixture = Fixture::new();
    let marker = fixture.root.join("verifier-started");
    let environment = json!([{
        "name": "FORGE_TEST_MARKER",
        "value": marker
    }]);
    let start = fixture.start("verifier_wait_helper", environment);
    let mut child = spawn_kernel();
    let mut stdin = child.stdin.take().expect("stdin");
    stdin
        .write_all(&serde_json::to_vec(&start).expect("start"))
        .expect("start");
    stdin.write_all(b"\n").expect("newline");
    stdin.flush().expect("flush");

    let deadline = Instant::now() + Duration::from_secs(5);
    while !marker.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    assert!(marker.exists(), "verifier did not start");
    let cancellation = json!({
        "type": "transaction.cancel",
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": "request:protocol-fixture",
        "reason": "Fixture requested cancellation."
    });
    stdin
        .write_all(&serde_json::to_vec(&cancellation).expect("cancel"))
        .expect("cancel");
    stdin.write_all(b"\n").expect("newline");
    drop(stdin);

    let output = child.wait_with_output().expect("kernel output");
    assert!(output.status.success());
    let result = output_json(&output);
    assert_eq!(result["artifact"]["status"], "cancelled");
    assert_eq!(result["artifact"]["recovery"]["success"], true);
    assert_eq!(
        fs::read_to_string(fixture.repository.join("evidence.txt")).expect("original"),
        "before\n"
    );
    let candidate_entries = fs::read_dir(&fixture.candidates)
        .expect("candidate directory")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name() != ".forge-leases")
        .count();
    assert_eq!(candidate_entries, 0);
}

#[test]
#[ignore]
fn verifier_pass_helper() {
    assert_eq!(
        fs::read_to_string("evidence.txt").expect("candidate evidence"),
        "after\n"
    );
}

#[test]
#[ignore]
fn verifier_wait_helper() {
    let marker = env::var_os("FORGE_TEST_MARKER").expect("marker");
    fs::write(marker, "started").expect("marker write");
    thread::sleep(Duration::from_secs(10));
}
