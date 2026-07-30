use std::{
    sync::{Arc, Barrier},
    thread,
};

use ed25519_dalek::{Signer, SigningKey};

use super::*;

fn fixture_root(name: &str) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "forge-host-authority-{name}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    if root.exists() {
        fs::remove_dir_all(&root).expect("remove stale fixture");
    }
    root
}

fn signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7_u8; 32])
}

fn trust() -> Vec<TrustedHostKey> {
    vec![TrustedHostKey {
        provider_id: "host.fixture".to_owned(),
        key_id: "key.primary".to_owned(),
        public_key_hex: encode_hex(signing_key().verifying_key().as_bytes()),
    }]
}

fn request() -> HostChallengeRequest {
    HostChallengeRequest {
        provider_id: "host.fixture".to_owned(),
        capability_digest: "11".repeat(32),
        policy_digest: "22".repeat(32),
        required_controls: vec![IsolationControl::Process, IsolationControl::Filesystem],
        ttl_ms: 10_000,
    }
}

fn signed(challenge: &HostIsolationChallenge, boundary: &str) -> SignedHostBoundaryStatement {
    let statement = HostBoundaryStatement {
        challenge_id: challenge.challenge_id.clone(),
        key_id: "key.primary".to_owned(),
        boundary_id: boundary.to_owned(),
        process_boundary_inherited: true,
        attested_controls: vec![IsolationControl::Filesystem, IsolationControl::Process],
    };
    let payload = host_attestation_signing_bytes(challenge, &statement).expect("payload");
    let signature = signing_key().sign(&payload);
    SignedHostBoundaryStatement {
        statement,
        signature_hex: encode_hex(&signature.to_bytes()),
    }
}

#[test]
fn issues_verifies_persists_and_rejects_restart_replay() {
    let root = fixture_root("restart");
    let ledger = HostChallengeLedger::new(root.clone(), trust()).expect("ledger");
    let challenge = ledger
        .issue_at(request(), 1_000, [3_u8; NONCE_BYTES])
        .expect("challenge");
    assert_eq!(
        challenge.challenge_id,
        "host-challenge:15df218011a72c63d997484bd87643a32aa6d33513f0444b714ce53e49f596b2"
    );
    let response = signed(&challenge, "boundary.fixture");
    let evidence = ledger
        .verify_and_consume_at(&response, 2_000)
        .expect("verified evidence");

    assert_eq!(evidence.challenge.capability_digest, "11".repeat(32));
    assert_eq!(evidence.challenge.policy_digest, "22".repeat(32));
    assert_eq!(evidence.statement.boundary_id, "boundary.fixture");
    assert_eq!(
        evidence.transcript_sha256,
        "7e50244a2fb368d15c0d1c3dc726fec298746fcf682df529c7fe4337f73a9bc5"
    );
    assert!(!ledger.pending_path(&challenge.challenge_id).exists());
    assert!(ledger.consumed_path(&challenge.challenge_id).is_file());
    assert_eq!(
        ledger
            .inspect_consumed(&challenge.challenge_id)
            .expect("inspect")
            .expect("evidence"),
        evidence
    );

    let restarted = HostChallengeLedger::new(root.clone(), trust()).expect("restart ledger");
    assert!(
        restarted
            .verify_and_consume_at(&response, 2_001)
            .unwrap_err()
            .contains("replay")
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn rejects_altered_wrong_key_and_stale_statements_without_consuming() {
    let root = fixture_root("invalid");
    let ledger = HostChallengeLedger::new(root.clone(), trust()).expect("ledger");
    let challenge = ledger
        .issue_at(request(), 10_000, [4_u8; NONCE_BYTES])
        .expect("challenge");
    let mut altered = signed(&challenge, "boundary.original");
    altered.statement.boundary_id = "boundary.altered".to_owned();
    assert!(
        ledger
            .verify_and_consume_at(&altered, 10_001)
            .unwrap_err()
            .contains("signature is invalid")
    );
    let mut wrong_key = signed(&challenge, "boundary.original");
    wrong_key.statement.key_id = "key.unknown".to_owned();
    assert!(
        ledger
            .verify_and_consume_at(&wrong_key, 10_001)
            .unwrap_err()
            .contains("not trusted")
    );
    let valid = signed(&challenge, "boundary.original");
    assert!(
        ledger
            .verify_and_consume_at(&valid, 9_999)
            .unwrap_err()
            .contains("not yet valid")
    );
    assert!(
        ledger
            .verify_and_consume_at(&valid, 20_000)
            .unwrap_err()
            .contains("expired")
    );
    assert!(ledger.pending_path(&challenge.challenge_id).is_file());
    assert!(!ledger.consumed_path(&challenge.challenge_id).exists());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn challenge_identity_binds_capability_policy_provider_and_controls() {
    let root = fixture_root("binding");
    let ledger = HostChallengeLedger::new(root.clone(), trust()).expect("ledger");
    let first = ledger
        .issue_at(request(), 50, [9_u8; NONCE_BYTES])
        .expect("first");
    let mut changed = request();
    changed.capability_digest = "33".repeat(32);
    let capability = ledger
        .issue_at(changed, 50, [9_u8; NONCE_BYTES])
        .expect("capability");
    let mut changed = request();
    changed.policy_digest = "44".repeat(32);
    let policy = ledger
        .issue_at(changed, 50, [9_u8; NONCE_BYTES])
        .expect("policy");
    let mut changed = request();
    changed.required_controls.push(IsolationControl::Network);
    let controls = ledger
        .issue_at(changed, 50, [9_u8; NONCE_BYTES])
        .expect("controls");

    assert_ne!(first.challenge_id, capability.challenge_id);
    assert_ne!(first.challenge_id, policy.challenge_id);
    assert_ne!(first.challenge_id, controls.challenge_id);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn concurrent_consumers_allow_exactly_one_success() {
    let root = fixture_root("race");
    let issuer = HostChallengeLedger::new(root.clone(), trust()).expect("ledger");
    let challenge = issuer
        .issue_at(request(), 100, [8_u8; NONCE_BYTES])
        .expect("challenge");
    let response = Arc::new(signed(&challenge, "boundary.race"));
    let barrier = Arc::new(Barrier::new(2));
    let mut handles = Vec::new();
    for _ in 0..2 {
        let ledger = HostChallengeLedger::new(root.clone(), trust()).expect("consumer");
        let response = Arc::clone(&response);
        let barrier = Arc::clone(&barrier);
        handles.push(thread::spawn(move || {
            barrier.wait();
            ledger.verify_and_consume_at(&response, 101)
        }));
    }
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().expect("consumer join"))
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
    assert!(
        results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .any(|error| error.contains("replay"))
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn public_issue_reaps_expired_pending_challenges_before_capacity_check() {
    let root = fixture_root("expired-pending");
    let ledger = HostChallengeLedger::new(root.clone(), trust()).expect("ledger");
    let expired = ledger
        .issue_at(request(), 1, [12_u8; NONCE_BYTES])
        .expect("expired fixture");
    assert!(ledger.pending_path(&expired.challenge_id).is_file());

    let current = ledger.issue(request()).expect("current challenge");

    assert!(!ledger.pending_path(&expired.challenge_id).exists());
    assert!(ledger.pending_path(&current.challenge_id).is_file());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn public_issue_rejects_unexpected_ledger_entries() {
    let root = fixture_root("capacity-shape");
    let ledger = HostChallengeLedger::new(root.clone(), trust()).expect("ledger");
    fs::write(root.join("pending").join("unexpected.tmp"), b"unexpected")
        .expect("unexpected entry");

    assert!(
        ledger
            .issue(request())
            .unwrap_err()
            .contains("unexpected entry")
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn inspect_reverifies_persisted_signature_and_transcript() {
    let root = fixture_root("tampered-audit");
    let ledger = HostChallengeLedger::new(root.clone(), trust()).expect("ledger");
    let challenge = ledger
        .issue_at(request(), 2_000, [5_u8; NONCE_BYTES])
        .expect("challenge");
    let response = signed(&challenge, "boundary.audit");
    let mut evidence = ledger
        .verify_and_consume_at(&response, 2_001)
        .expect("evidence");
    evidence.statement.boundary_id = "boundary.tampered".to_owned();
    fs::write(
        ledger.consumed_path(&challenge.challenge_id),
        serde_json::to_vec(&evidence).expect("serialize tamper"),
    )
    .expect("tamper audit record");

    assert!(
        ledger
            .inspect_consumed(&challenge.challenge_id)
            .unwrap_err()
            .contains("transcript digest is invalid")
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn rejects_traversal_and_corrupt_consumed_evidence() {
    let root = fixture_root("corrupt");
    let ledger = HostChallengeLedger::new(root.clone(), trust()).expect("ledger");
    assert!(ledger.inspect_consumed("../escape").is_err());
    let challenge = ledger
        .issue_at(request(), 1_000, [6_u8; NONCE_BYTES])
        .expect("challenge");
    fs::write(ledger.consumed_path(&challenge.challenge_id), b"{").expect("corrupt consumed");
    let response = signed(&challenge, "boundary.corrupt");
    assert!(
        ledger
            .verify_and_consume_at(&response, 1_001)
            .unwrap_err()
            .contains("evidence is invalid")
    );
    fs::remove_dir_all(root).expect("cleanup");
}
