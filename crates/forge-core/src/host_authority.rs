use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::IsolationControl;

const HOST_AUTHORITY_SCHEMA_VERSION: u8 = 1;
const TRANSCRIPT_DOMAIN: &[u8] = b"forge.host-isolation.attestation.v1\0";
const MAX_IDENTIFIER_BYTES: usize = 128;
const MAX_LEDGER_FILE_BYTES: u64 = 64 * 1024;
const MAX_PENDING_RECORDS: usize = 1_024;
const MAX_CONSUMED_RECORDS: usize = 10_000;
const MAX_TRUSTED_KEYS: usize = 64;
const MAX_CHALLENGE_TTL_MS: u64 = 5 * 60 * 1_000;
const NONCE_BYTES: usize = 32;
const DIGEST_BYTES: usize = 32;
const SIGNATURE_BYTES: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedHostKey {
    pub provider_id: String,
    pub key_id: String,
    pub public_key_hex: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostChallengeRequest {
    pub provider_id: String,
    pub capability_digest: String,
    pub policy_digest: String,
    pub required_controls: Vec<IsolationControl>,
    pub ttl_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostIsolationChallenge {
    pub schema_version: u8,
    pub challenge_id: String,
    pub nonce_hex: String,
    pub issued_at_unix_ms: u64,
    pub expires_at_unix_ms: u64,
    pub provider_id: String,
    pub capability_digest: String,
    pub policy_digest: String,
    pub required_controls: Vec<IsolationControl>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostBoundaryStatement {
    pub challenge_id: String,
    pub key_id: String,
    pub boundary_id: String,
    pub process_boundary_inherited: bool,
    pub attested_controls: Vec<IsolationControl>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedHostBoundaryStatement {
    pub statement: HostBoundaryStatement,
    pub signature_hex: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthenticatedHostAuthorityEvidence {
    pub schema_version: u8,
    pub challenge: HostIsolationChallenge,
    pub statement: HostBoundaryStatement,
    pub consumed_at_unix_ms: u64,
    pub transcript_sha256: String,
    pub signature_hex: String,
    pub verifying_key_sha256: String,
}

#[derive(Clone)]
pub struct HostChallengeLedger {
    root: PathBuf,
    trusted_keys: Vec<TrustedHostKey>,
}

impl HostChallengeLedger {
    pub fn new(root: PathBuf, trusted_keys: Vec<TrustedHostKey>) -> Result<Self, String> {
        if !root.is_absolute() {
            return Err("Host authority ledger root must be absolute.".to_owned());
        }
        validate_trusted_keys(&trusted_keys)?;
        ensure_directory(&root)?;
        ensure_directory(&root.join("pending"))?;
        ensure_directory(&root.join("consumed"))?;
        Ok(Self { root, trusted_keys })
    }

    pub fn issue(&self, request: HostChallengeRequest) -> Result<HostIsolationChallenge, String> {
        let now = system_time_ms()?;
        self.enforce_issue_capacity(now)?;
        let mut nonce = [0_u8; NONCE_BYTES];
        getrandom::fill(&mut nonce)
            .map_err(|error| format!("Cannot obtain host challenge randomness: {error}"))?;
        self.issue_at(request, now, nonce)
    }

    pub fn verify_and_consume(
        &self,
        signed: &SignedHostBoundaryStatement,
    ) -> Result<AuthenticatedHostAuthorityEvidence, String> {
        self.verify_and_consume_at(signed, system_time_ms()?)
    }

    pub fn inspect_consumed(
        &self,
        challenge_id: &str,
    ) -> Result<Option<AuthenticatedHostAuthorityEvidence>, String> {
        validate_identifier("Host challenge ID", challenge_id)?;
        let path = self.consumed_path(challenge_id);
        if !path.exists() {
            return Ok(None);
        }
        let evidence: AuthenticatedHostAuthorityEvidence = read_bounded_json(&path)?;
        self.validate_consumed_evidence(challenge_id, &evidence)?;
        Ok(Some(evidence))
    }

    fn issue_at(
        &self,
        mut request: HostChallengeRequest,
        now: u64,
        nonce: [u8; NONCE_BYTES],
    ) -> Result<HostIsolationChallenge, String> {
        validate_identifier("Host provider ID", &request.provider_id)?;
        validate_digest("Capability digest", &request.capability_digest)?;
        validate_digest("Policy digest", &request.policy_digest)?;
        request.required_controls = canonical_controls(&request.required_controls)?;
        if request.required_controls.is_empty() {
            return Err("Host challenge requires at least one isolation control.".to_owned());
        }
        if request.ttl_ms == 0 || request.ttl_ms > MAX_CHALLENGE_TTL_MS {
            return Err(format!(
                "Host challenge TTL must be from 1 to {MAX_CHALLENGE_TTL_MS} ms."
            ));
        }
        let expires = now
            .checked_add(request.ttl_ms)
            .ok_or_else(|| "Host challenge expiry overflowed.".to_owned())?;
        let nonce_hex = encode_hex(&nonce);
        let challenge_id = derive_challenge_id(
            &nonce,
            now,
            expires,
            &request.provider_id,
            &request.capability_digest,
            &request.policy_digest,
            &request.required_controls,
        )?;
        let challenge = HostIsolationChallenge {
            schema_version: HOST_AUTHORITY_SCHEMA_VERSION,
            challenge_id,
            nonce_hex,
            issued_at_unix_ms: now,
            expires_at_unix_ms: expires,
            provider_id: request.provider_id,
            capability_digest: request.capability_digest,
            policy_digest: request.policy_digest,
            required_controls: request.required_controls,
        };
        validate_challenge(&challenge)?;
        let pending = self.pending_path(&challenge.challenge_id);
        if self.consumed_path(&challenge.challenge_id).exists() {
            return Err("Host challenge identity was already consumed.".to_owned());
        }
        match write_new_json(&pending, &challenge, "host challenge") {
            Ok(()) => Ok(challenge),
            Err(WriteNewError::AlreadyExists) => {
                Err("Host challenge identity collision was rejected.".to_owned())
            }
            Err(WriteNewError::Failed(error)) => Err(error),
        }
    }

    fn verify_and_consume_at(
        &self,
        signed: &SignedHostBoundaryStatement,
        now: u64,
    ) -> Result<AuthenticatedHostAuthorityEvidence, String> {
        validate_statement(&signed.statement)?;
        let challenge_id = &signed.statement.challenge_id;
        self.reject_replay_if_consumed(challenge_id)?;
        let pending = self.pending_path(challenge_id);
        if !pending.exists() {
            self.reject_replay_if_consumed(challenge_id)?;
            return Err("Host challenge is missing or was never issued.".to_owned());
        }
        let challenge: HostIsolationChallenge = match read_bounded_json(&pending) {
            Ok(challenge) => challenge,
            Err(error) => {
                self.reject_replay_if_consumed(challenge_id)?;
                return Err(error);
            }
        };
        validate_challenge(&challenge)?;
        if challenge.challenge_id != *challenge_id {
            return Err(
                "Persisted host challenge identity does not match the response.".to_owned(),
            );
        }
        if now < challenge.issued_at_unix_ms {
            return Err("Host challenge is not yet valid.".to_owned());
        }
        if now >= challenge.expires_at_unix_ms {
            return Err("Host challenge has expired.".to_owned());
        }
        if !signed.statement.process_boundary_inherited {
            return Err(
                "The host did not bind child processes to the attested boundary.".to_owned(),
            );
        }
        let attested = canonical_controls(&signed.statement.attested_controls)?;
        if !challenge
            .required_controls
            .iter()
            .all(|control| attested.contains(control))
        {
            return Err("Host statement omits a challenge-required control.".to_owned());
        }
        let trusted = self
            .trusted_keys
            .iter()
            .find(|key| {
                key.provider_id == challenge.provider_id && key.key_id == signed.statement.key_id
            })
            .ok_or_else(|| "Host signing key is not trusted for this provider.".to_owned())?;
        let public_key =
            decode_array::<DIGEST_BYTES>("Trusted host public key", &trusted.public_key_hex)?;
        let verifying_key = VerifyingKey::from_bytes(&public_key)
            .map_err(|_| "Trusted host public key is invalid.".to_owned())?;
        if verifying_key.is_weak() {
            return Err("Trusted host public key is weak and cannot be used.".to_owned());
        }
        let signature_bytes =
            decode_array::<SIGNATURE_BYTES>("Host signature", &signed.signature_hex)?;
        let signature = Signature::from_bytes(&signature_bytes);
        let transcript = host_attestation_signing_bytes(&challenge, &signed.statement)?;
        verifying_key
            .verify_strict(&transcript, &signature)
            .map_err(|_| "Host statement signature is invalid.".to_owned())?;

        let mut statement = signed.statement.clone();
        statement.attested_controls = attested;
        let evidence = AuthenticatedHostAuthorityEvidence {
            schema_version: HOST_AUTHORITY_SCHEMA_VERSION,
            challenge,
            statement,
            consumed_at_unix_ms: now,
            transcript_sha256: digest_hex(&transcript),
            signature_hex: signed.signature_hex.clone(),
            verifying_key_sha256: digest_hex(&public_key),
        };
        let consumed = self.consumed_path(challenge_id);
        match write_new_json(&consumed, &evidence, "consumed host challenge") {
            Ok(()) => {}
            Err(WriteNewError::AlreadyExists) => {
                self.reject_replay_if_consumed(challenge_id)?;
                return Err(
                    "Consumed host challenge disappeared during replay validation.".to_owned(),
                );
            }
            Err(WriteNewError::Failed(error)) => return Err(error),
        }
        fs::remove_file(&pending).map_err(|error| {
            format!("Consumed host challenge was recorded but pending cleanup failed: {error}")
        })?;
        Ok(evidence)
    }

    fn reject_replay_if_consumed(&self, challenge_id: &str) -> Result<(), String> {
        match self.inspect_consumed(challenge_id).map_err(|error| {
            format!("Host challenge is already consumed and its evidence is invalid: {error}")
        })? {
            Some(_) => Err("Host challenge replay was rejected.".to_owned()),
            None => Ok(()),
        }
    }

    fn validate_consumed_evidence(
        &self,
        challenge_id: &str,
        evidence: &AuthenticatedHostAuthorityEvidence,
    ) -> Result<(), String> {
        if evidence.schema_version != HOST_AUTHORITY_SCHEMA_VERSION
            || evidence.challenge.challenge_id != challenge_id
            || evidence.statement.challenge_id != challenge_id
        {
            return Err("Consumed host challenge evidence is inconsistent.".to_owned());
        }
        validate_challenge(&evidence.challenge)?;
        validate_statement(&evidence.statement)?;
        if !evidence.statement.process_boundary_inherited
            || evidence.consumed_at_unix_ms < evidence.challenge.issued_at_unix_ms
            || evidence.consumed_at_unix_ms >= evidence.challenge.expires_at_unix_ms
        {
            return Err(
                "Consumed host challenge timing or boundary evidence is invalid.".to_owned(),
            );
        }
        let attested = canonical_controls(&evidence.statement.attested_controls)?;
        if !evidence
            .challenge
            .required_controls
            .iter()
            .all(|control| attested.contains(control))
        {
            return Err("Consumed host evidence omits a challenge-required control.".to_owned());
        }
        let trusted = self
            .trusted_keys
            .iter()
            .find(|key| {
                key.provider_id == evidence.challenge.provider_id
                    && key.key_id == evidence.statement.key_id
            })
            .ok_or_else(|| "Consumed host evidence references an untrusted key.".to_owned())?;
        let public_key =
            decode_array::<DIGEST_BYTES>("Trusted host public key", &trusted.public_key_hex)?;
        if evidence.verifying_key_sha256 != digest_hex(&public_key) {
            return Err("Consumed host evidence key fingerprint is invalid.".to_owned());
        }
        let transcript = host_attestation_signing_bytes(&evidence.challenge, &evidence.statement)?;
        if evidence.transcript_sha256 != digest_hex(&transcript) {
            return Err("Consumed host evidence transcript digest is invalid.".to_owned());
        }
        let verifying_key = VerifyingKey::from_bytes(&public_key)
            .map_err(|_| "Consumed host evidence key is invalid.".to_owned())?;
        let signature_bytes =
            decode_array::<SIGNATURE_BYTES>("Host signature", &evidence.signature_hex)?;
        verifying_key
            .verify_strict(&transcript, &Signature::from_bytes(&signature_bytes))
            .map_err(|_| "Consumed host evidence signature is invalid.".to_owned())
    }

    fn enforce_issue_capacity(&self, now: u64) -> Result<(), String> {
        self.reap_expired_pending(now)?;
        ensure_record_capacity(
            &self.root.join("pending"),
            MAX_PENDING_RECORDS,
            "pending host challenge",
        )?;
        ensure_record_capacity(
            &self.root.join("consumed"),
            MAX_CONSUMED_RECORDS,
            "consumed host challenge",
        )
    }

    fn reap_expired_pending(&self, now: u64) -> Result<(), String> {
        for entry in fs::read_dir(self.root.join("pending"))
            .map_err(|error| format!("Cannot inspect pending host challenge ledger: {error}"))?
        {
            let entry = entry.map_err(|error| {
                format!("Cannot inspect pending host challenge record: {error}")
            })?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                format!("Cannot inspect pending host challenge record: {error}")
            })?;
            if !metadata.file_type().is_file()
                || metadata.file_type().is_symlink()
                || path.extension().and_then(|value| value.to_str()) != Some("json")
            {
                return Err(
                    "pending host challenge ledger contains an unexpected entry.".to_owned(),
                );
            }
            let challenge: HostIsolationChallenge = read_bounded_json(&path)?;
            validate_challenge(&challenge)?;
            if path != self.pending_path(&challenge.challenge_id) {
                return Err(
                    "Pending host challenge filename does not match its identity.".to_owned(),
                );
            }
            if challenge.expires_at_unix_ms <= now {
                fs::remove_file(&path).map_err(|error| {
                    format!("Cannot remove expired pending host challenge: {error}")
                })?;
            }
        }
        Ok(())
    }

    fn pending_path(&self, challenge_id: &str) -> PathBuf {
        self.root
            .join("pending")
            .join(format!("{challenge_id}.json"))
    }

    fn consumed_path(&self, challenge_id: &str) -> PathBuf {
        self.root
            .join("consumed")
            .join(format!("{challenge_id}.json"))
    }
}

pub fn host_attestation_signing_bytes(
    challenge: &HostIsolationChallenge,
    statement: &HostBoundaryStatement,
) -> Result<Vec<u8>, String> {
    validate_challenge(challenge)?;
    validate_statement(statement)?;
    if statement.challenge_id != challenge.challenge_id {
        return Err("Host statement challenge ID does not match the challenge.".to_owned());
    }
    let required = canonical_controls(&challenge.required_controls)?;
    let attested = canonical_controls(&statement.attested_controls)?;
    let nonce = decode_array::<NONCE_BYTES>("Host challenge nonce", &challenge.nonce_hex)?;
    let capability =
        decode_array::<DIGEST_BYTES>("Capability digest", &challenge.capability_digest)?;
    let policy = decode_array::<DIGEST_BYTES>("Policy digest", &challenge.policy_digest)?;

    let mut bytes = Vec::with_capacity(512);
    bytes.extend_from_slice(TRANSCRIPT_DOMAIN);
    bytes.push(challenge.schema_version);
    append_field(&mut bytes, challenge.challenge_id.as_bytes())?;
    append_field(&mut bytes, &nonce)?;
    bytes.extend_from_slice(&challenge.issued_at_unix_ms.to_be_bytes());
    bytes.extend_from_slice(&challenge.expires_at_unix_ms.to_be_bytes());
    append_field(&mut bytes, challenge.provider_id.as_bytes())?;
    append_field(&mut bytes, &capability)?;
    append_field(&mut bytes, &policy)?;
    append_controls(&mut bytes, &required);
    append_field(&mut bytes, statement.challenge_id.as_bytes())?;
    append_field(&mut bytes, statement.key_id.as_bytes())?;
    append_field(&mut bytes, statement.boundary_id.as_bytes())?;
    bytes.push(u8::from(statement.process_boundary_inherited));
    append_controls(&mut bytes, &attested);
    Ok(bytes)
}

fn validate_trusted_keys(keys: &[TrustedHostKey]) -> Result<(), String> {
    if keys.is_empty() || keys.len() > MAX_TRUSTED_KEYS {
        return Err("Host trust store must contain from 1 to 64 keys.".to_owned());
    }
    let mut identities = HashSet::new();
    for key in keys {
        validate_identifier("Host provider ID", &key.provider_id)?;
        validate_identifier("Host key ID", &key.key_id)?;
        if !identities.insert((key.provider_id.as_str(), key.key_id.as_str())) {
            return Err("Host trust store contains a duplicate provider/key identity.".to_owned());
        }
        let bytes = decode_array::<DIGEST_BYTES>("Trusted host public key", &key.public_key_hex)?;
        let verifying_key = VerifyingKey::from_bytes(&bytes)
            .map_err(|_| "Trusted host public key is invalid.".to_owned())?;
        if verifying_key.is_weak() {
            return Err("Trusted host public key is weak and cannot be used.".to_owned());
        }
    }
    Ok(())
}

fn validate_challenge(challenge: &HostIsolationChallenge) -> Result<(), String> {
    if challenge.schema_version != HOST_AUTHORITY_SCHEMA_VERSION {
        return Err("Unsupported host challenge schema version.".to_owned());
    }
    validate_identifier("Host challenge ID", &challenge.challenge_id)?;
    validate_identifier("Host provider ID", &challenge.provider_id)?;
    let nonce = decode_array::<NONCE_BYTES>("Host challenge nonce", &challenge.nonce_hex)?;
    validate_digest("Capability digest", &challenge.capability_digest)?;
    validate_digest("Policy digest", &challenge.policy_digest)?;
    let controls = canonical_controls(&challenge.required_controls)?;
    if controls.is_empty() || controls != challenge.required_controls {
        return Err("Host challenge controls are empty or non-canonical.".to_owned());
    }
    if challenge.expires_at_unix_ms <= challenge.issued_at_unix_ms
        || challenge.expires_at_unix_ms - challenge.issued_at_unix_ms > MAX_CHALLENGE_TTL_MS
    {
        return Err("Host challenge validity window is invalid.".to_owned());
    }
    let expected = derive_challenge_id(
        &nonce,
        challenge.issued_at_unix_ms,
        challenge.expires_at_unix_ms,
        &challenge.provider_id,
        &challenge.capability_digest,
        &challenge.policy_digest,
        &controls,
    )?;
    if expected != challenge.challenge_id {
        return Err("Host challenge identity does not match its bound facts.".to_owned());
    }
    Ok(())
}

fn validate_statement(statement: &HostBoundaryStatement) -> Result<(), String> {
    validate_identifier("Host challenge ID", &statement.challenge_id)?;
    validate_identifier("Host key ID", &statement.key_id)?;
    validate_identifier("Host boundary ID", &statement.boundary_id)?;
    if statement.attested_controls.is_empty() {
        return Err("Host statement requires at least one isolation control.".to_owned());
    }
    canonical_controls(&statement.attested_controls)?;
    Ok(())
}

fn derive_challenge_id(
    nonce: &[u8; NONCE_BYTES],
    issued: u64,
    expires: u64,
    provider_id: &str,
    capability_digest: &str,
    policy_digest: &str,
    controls: &[IsolationControl],
) -> Result<String, String> {
    let capability = decode_array::<DIGEST_BYTES>("Capability digest", capability_digest)?;
    let policy = decode_array::<DIGEST_BYTES>("Policy digest", policy_digest)?;
    let mut bytes = Vec::with_capacity(256);
    bytes.extend_from_slice(b"forge.host-isolation.challenge.v1\0");
    append_field(&mut bytes, nonce)?;
    bytes.extend_from_slice(&issued.to_be_bytes());
    bytes.extend_from_slice(&expires.to_be_bytes());
    append_field(&mut bytes, provider_id.as_bytes())?;
    append_field(&mut bytes, &capability)?;
    append_field(&mut bytes, &policy)?;
    append_controls(&mut bytes, controls);
    Ok(format!("host-challenge:{}", digest_hex(&bytes)))
}

fn canonical_controls(controls: &[IsolationControl]) -> Result<Vec<IsolationControl>, String> {
    if controls.len() > 5 {
        return Err("Isolation control list exceeds five entries.".to_owned());
    }
    let mut result = controls.to_vec();
    result.sort_by_key(control_code);
    result.dedup();
    if result.len() != controls.len() {
        return Err("Isolation control list contains duplicates.".to_owned());
    }
    Ok(result)
}

fn control_code(control: &IsolationControl) -> u8 {
    match control {
        IsolationControl::Process => 1,
        IsolationControl::Filesystem => 2,
        IsolationControl::Network => 3,
        IsolationControl::Credentials => 4,
        IsolationControl::Resources => 5,
    }
}

fn append_controls(bytes: &mut Vec<u8>, controls: &[IsolationControl]) {
    bytes.push(controls.len() as u8);
    bytes.extend(controls.iter().map(control_code));
}

fn append_field(bytes: &mut Vec<u8>, value: &[u8]) -> Result<(), String> {
    let length =
        u32::try_from(value.len()).map_err(|_| "Transcript field is too large.".to_owned())?;
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(value);
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_BYTES
        || !value.is_ascii()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(format!("{label} is invalid."));
    }
    Ok(())
}

fn validate_digest(label: &str, value: &str) -> Result<(), String> {
    decode_array::<DIGEST_BYTES>(label, value).map(|_| ())
}

fn decode_array<const N: usize>(label: &str, value: &str) -> Result<[u8; N], String> {
    if value.len() != N * 2 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("{label} must be exactly {} hexadecimal bytes.", N));
    }
    let mut output = [0_u8; N];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Ok(output)
}

fn hex_nibble(byte: u8) -> Result<u8, String> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err("Invalid hexadecimal character.".to_owned()),
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn digest_hex(bytes: &[u8]) -> String {
    encode_hex(&Sha256::digest(bytes))
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Cannot inspect host authority directory: {error}"))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err("Host authority path is not a real directory.".to_owned());
        }
    } else {
        fs::create_dir_all(path)
            .map_err(|error| format!("Cannot create host authority directory: {error}"))?;
    }
    Ok(())
}

#[derive(Debug)]
enum WriteNewError {
    AlreadyExists,
    Failed(String),
}

fn write_new_json<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<(), WriteNewError> {
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| WriteNewError::Failed(format!("Cannot serialize {label}: {error}")))?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_LEDGER_FILE_BYTES {
        return Err(WriteNewError::Failed(format!(
            "Serialized {label} exceeds the ledger bound."
        )));
    }
    let ledger_root = path
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| WriteNewError::Failed(format!("Cannot locate {label} ledger root.")))?;
    let mut staging_nonce = [0_u8; 16];
    getrandom::fill(&mut staging_nonce).map_err(|error| {
        WriteNewError::Failed(format!("Cannot obtain {label} staging randomness: {error}"))
    })?;
    let staging = ledger_root.join(format!(
        ".host-authority-write-{}-{}.tmp",
        std::process::id(),
        encode_hex(&staging_nonce)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging)
        .map_err(|error| WriteNewError::Failed(format!("Cannot stage {label}: {error}")))?;
    let staging_result = file
        .write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("Cannot write and synchronize {label}: {error}"));
    drop(file);
    if let Err(error) = staging_result {
        return match fs::remove_file(&staging) {
            Ok(()) => Err(WriteNewError::Failed(error)),
            Err(cleanup_error) => Err(WriteNewError::Failed(format!(
                "{error}; staged-record cleanup also failed: {cleanup_error}"
            ))),
        };
    }
    let publish = fs::hard_link(&staging, path);
    let cleanup = fs::remove_file(&staging);
    match (publish, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(WriteNewError::AlreadyExists)
        }
        (Err(error), Ok(())) => Err(WriteNewError::Failed(format!(
            "Cannot atomically publish {label}: {error}"
        ))),
        (Ok(()), Err(error)) => Err(WriteNewError::Failed(format!(
            "Published {label}, but staged-record cleanup failed: {error}"
        ))),
        (Err(publish_error), Err(cleanup_error)) => Err(WriteNewError::Failed(format!(
            "Cannot atomically publish {label}: {publish_error}; staged-record cleanup also failed: {cleanup_error}"
        ))),
    }
}

fn ensure_record_capacity(path: &Path, maximum: usize, label: &str) -> Result<(), String> {
    let mut count = 0_usize;
    for entry in
        fs::read_dir(path).map_err(|error| format!("Cannot inspect {label} ledger: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Cannot inspect {label} record: {error}"))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| format!("Cannot inspect {label} record: {error}"))?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("json")
        {
            return Err(format!("{label} ledger contains an unexpected entry."));
        }
        count += 1;
        if count >= maximum {
            return Err(format!("{label} ledger reached its bounded capacity."));
        }
    }
    Ok(())
}

fn read_bounded_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect host authority record: {error}"))?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() == 0
        || metadata.len() > MAX_LEDGER_FILE_BYTES
    {
        return Err("Host authority record is not a bounded regular file.".to_owned());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Cannot read host authority record: {error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "Host authority record is corrupt or has an unknown schema.".to_owned())
}

fn system_time_ms() -> Result<u64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "System clock is before the Unix epoch.".to_owned())?;
    u64::try_from(duration.as_millis()).map_err(|_| "System clock value overflowed.".to_owned())
}

#[cfg(test)]
mod tests;
