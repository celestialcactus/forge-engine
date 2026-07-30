use std::{
    fs,
    io::{self, BufReader, BufWriter},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, RecvTimeoutError},
    },
    thread,
    time::{Duration, Instant},
};

use forge_core::{
    AuthenticatedHostIsolationProvider, Cancellation, ChangeTransactionRequest,
    CleanRevisionWorktreeAdapter, HostBoundaryNegotiator, HostChallengeLedger,
    HostIsolationChallenge, IsolationControl, IsolationPolicy, IsolationProfile,
    SignedHostBoundaryStatement, TrustedHostKey, VerificationCheck, WorktreeAdapterConfig,
    execute_candidate_transaction,
};
use serde::Deserialize;
use serde_json::json;

use crate::protocol::{
    MAX_HOST_FRAME_BYTES, TRANSACTION_PROTOCOL_VERSION, read_bounded_frame, send_json,
};

const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_CANCELLATION_REASON_BYTES: usize = 512;
const HOST_NEGOTIATION_POLL: Duration = Duration::from_millis(20);

type SharedWriter = Arc<Mutex<BufWriter<io::Stdout>>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransactionStart {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    request: ChangeTransactionRequest,
    configuration: TransactionConfiguration,
    #[serde(default)]
    initial_cancellation_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransactionConfiguration {
    repository_root: PathBuf,
    candidate_parent: PathBuf,
    #[serde(default = "default_git_executable")]
    git_executable: PathBuf,
    verification_checks: Vec<BridgeVerificationCheck>,
    #[serde(default = "default_max_diff_bytes")]
    max_diff_bytes: usize,
    #[serde(default)]
    host_authority: Option<HostAuthorityConfiguration>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeVerificationCheck {
    check_id: String,
    executable: PathBuf,
    #[serde(default)]
    arguments: Vec<String>,
    #[serde(default)]
    environment: Vec<EnvironmentEntry>,
    #[serde(default)]
    inherit_environment: Vec<String>,
    #[serde(default)]
    isolation_policy: Option<BridgeIsolationPolicy>,
    timeout_ms: u64,
    max_output_bytes: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeIsolationPolicy {
    profile: IsolationProfile,
    #[serde(default)]
    required_controls: Vec<IsolationControl>,
    #[serde(default)]
    allowed_host_provider_ids: Vec<String>,
}

impl BridgeIsolationPolicy {
    fn into_core(self) -> IsolationPolicy {
        IsolationPolicy {
            required_profile: self.profile,
            required_controls: self.required_controls,
            allowed_host_provider_ids: self.allowed_host_provider_ids,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostAuthorityConfiguration {
    ledger_root: PathBuf,
    trusted_keys: Vec<TrustedHostKey>,
    challenge_ttl_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvironmentEntry {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum TransactionHostMessage {
    #[serde(rename = "transaction.cancel")]
    Cancel {
        protocol_version: String,
        request_id: String,
        reason: String,
    },
    #[serde(rename = "transaction.host_statement")]
    HostStatement {
        protocol_version: String,
        request_id: String,
        signed_statement: SignedHostBoundaryStatement,
    },
}

pub struct ProtocolFailure {
    pub request_id: Option<String>,
    pub code: &'static str,
    pub message: String,
}

#[derive(Default)]
struct CancellationState {
    reason: Mutex<Option<String>>,
}

impl CancellationState {
    fn set_once(&self, reason: String) {
        let Ok(mut current) = self.reason.lock() else {
            return;
        };
        if current.is_none() {
            *current = Some(reason);
        }
    }
}

impl Cancellation for CancellationState {
    fn reason(&self) -> Option<String> {
        self.reason.lock().ok().and_then(|reason| reason.clone())
    }
}

struct ProtocolHostNegotiator {
    request_id: String,
    writer: SharedWriter,
    statements: Mutex<Receiver<SignedHostBoundaryStatement>>,
}

impl HostBoundaryNegotiator for ProtocolHostNegotiator {
    fn negotiate(
        &self,
        challenge: &HostIsolationChallenge,
        timeout: Duration,
        cancellation: &dyn Cancellation,
    ) -> Result<SignedHostBoundaryStatement, String> {
        send_shared(
            &self.writer,
            &json!({
                "type": "transaction.host_challenge",
                "protocolVersion": TRANSACTION_PROTOCOL_VERSION,
                "requestId": self.request_id,
                "challenge": challenge,
            }),
        )?;
        let started = Instant::now();
        let statements = self
            .statements
            .lock()
            .map_err(|_| "Host statement channel is unavailable.".to_owned())?;
        loop {
            if cancellation.reason().is_some() {
                return Err("Host negotiation was cancelled.".to_owned());
            }
            let Some(remaining) = timeout.checked_sub(started.elapsed()) else {
                return Err("Host negotiation timed out.".to_owned());
            };
            let wait = remaining.min(HOST_NEGOTIATION_POLL);
            match statements.recv_timeout(wait) {
                Ok(signed) => {
                    if signed.statement.challenge_id != challenge.challenge_id {
                        return Err(
                            "Host statement does not match the outstanding challenge.".to_owned()
                        );
                    }
                    return Ok(signed);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("Host statement channel closed before a response.".to_owned());
                }
            }
        }
    }
}

fn default_git_executable() -> PathBuf {
    PathBuf::from("git")
}

fn default_max_diff_bytes() -> usize {
    100_000
}

fn bounded_nonempty(value: &str, maximum_bytes: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum_bytes && !value.chars().any(char::is_control)
}

fn invalid_start(message: impl Into<String>) -> ProtocolFailure {
    ProtocolFailure {
        request_id: None,
        code: "invalid_transaction_start",
        message: message.into(),
    }
}

fn parse_start(frame: &[u8]) -> Result<TransactionStart, ProtocolFailure> {
    let start: TransactionStart = serde_json::from_slice(frame)
        .map_err(|_| invalid_start("Invalid transaction.start JSON."))?;
    if start.message_type != "transaction.start" {
        return Err(invalid_start("Expected transaction.start."));
    }
    if start.protocol_version != TRANSACTION_PROTOCOL_VERSION {
        return Err(invalid_start("Unsupported transaction protocol version."));
    }
    if !bounded_nonempty(&start.request_id, MAX_REQUEST_ID_BYTES) {
        return Err(invalid_start(
            "Transaction requestId must be bounded and non-empty.",
        ));
    }
    Ok(start)
}

fn build_checks(start: &TransactionStart) -> Vec<VerificationCheck> {
    start
        .configuration
        .verification_checks
        .iter()
        .map(|check| VerificationCheck {
            check_id: check.check_id.clone(),
            executable: check.executable.clone(),
            arguments: check.arguments.clone(),
            environment: check
                .environment
                .iter()
                .map(|entry| (entry.name.clone(), entry.value.clone()))
                .collect(),
            inherited_environment: check.inherit_environment.clone(),
            isolation_policy: check
                .isolation_policy
                .as_ref()
                .map(|policy| BridgeIsolationPolicy {
                    profile: policy.profile,
                    required_controls: policy.required_controls.clone(),
                    allowed_host_provider_ids: policy.allowed_host_provider_ids.clone(),
                })
                .map(BridgeIsolationPolicy::into_core)
                .unwrap_or_else(IsolationPolicy::trusted),
            timeout: Duration::from_millis(check.timeout_ms),
            max_output_bytes: check.max_output_bytes,
        })
        .collect()
}

fn resolve_ledger_location(
    ledger_root: &Path,
    repository_root: &Path,
    candidate_parent: &Path,
) -> Result<PathBuf, String> {
    if !ledger_root.is_absolute() {
        return Err("Host authority ledger root must be absolute.".to_owned());
    }
    let name = ledger_root
        .file_name()
        .ok_or_else(|| "Host authority ledger root must name one directory.".to_owned())?;
    let parent = ledger_root
        .parent()
        .ok_or_else(|| "Host authority ledger root has no parent directory.".to_owned())?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Cannot resolve host authority ledger parent: {error}"))?;
    let resolved = if ledger_root.exists() {
        fs::canonicalize(ledger_root)
            .map_err(|error| format!("Cannot resolve host authority ledger root: {error}"))?
    } else {
        canonical_parent.join(name)
    };
    let repository = fs::canonicalize(repository_root)
        .map_err(|error| format!("Cannot resolve repository root for host authority: {error}"))?;
    let candidates = fs::canonicalize(candidate_parent)
        .map_err(|error| format!("Cannot resolve candidate parent for host authority: {error}"))?;
    if resolved.starts_with(&repository) || resolved.starts_with(&candidates) {
        return Err(
            "Host authority ledger must be outside the governed repository and candidate parent."
                .to_owned(),
        );
    }
    Ok(resolved)
}

fn build_adapter(
    start: &TransactionStart,
    negotiator: Option<Arc<dyn HostBoundaryNegotiator>>,
) -> Result<CleanRevisionWorktreeAdapter, ProtocolFailure> {
    let checks = build_checks(start);
    let mut config = WorktreeAdapterConfig::new(
        &start.configuration.repository_root,
        &start.configuration.candidate_parent,
        &start.request.expected_base_revision,
        checks,
    );
    config.git_executable = start.configuration.git_executable.clone();
    config.max_diff_bytes = start.configuration.max_diff_bytes;

    match start.request.verification.isolation.profile {
        IsolationProfile::Trusted => {
            if start
                .request
                .verification
                .isolation
                .host_provider_id
                .is_some()
                || start.configuration.host_authority.is_some()
            {
                return Err(ProtocolFailure {
                    request_id: Some(start.request_id.clone()),
                    code: "invalid_host_authority_configuration",
                    message: "Trusted verification cannot configure host authority.".to_owned(),
                });
            }
            CleanRevisionWorktreeAdapter::try_new(config)
        }
        IsolationProfile::HostManaged => {
            let authority =
                start
                    .configuration
                    .host_authority
                    .as_ref()
                    .ok_or_else(|| ProtocolFailure {
                        request_id: Some(start.request_id.clone()),
                        code: "missing_host_authority_configuration",
                        message: "Host-managed verification requires host authority configuration."
                            .to_owned(),
                    })?;
            let ledger_root = resolve_ledger_location(
                &authority.ledger_root,
                &start.configuration.repository_root,
                &start.configuration.candidate_parent,
            )
            .map_err(|message| ProtocolFailure {
                request_id: Some(start.request_id.clone()),
                code: "invalid_host_authority_configuration",
                message,
            })?;
            let provider_id = start
                .request
                .verification
                .isolation
                .host_provider_id
                .clone()
                .ok_or_else(|| ProtocolFailure {
                    request_id: Some(start.request_id.clone()),
                    code: "missing_host_provider",
                    message: "Host-managed verification requires a provider selection.".to_owned(),
                })?;
            let ledger = HostChallengeLedger::new(ledger_root, authority.trusted_keys.clone())
                .map_err(|message| ProtocolFailure {
                    request_id: Some(start.request_id.clone()),
                    code: "invalid_host_authority_configuration",
                    message,
                })?;
            let provider = AuthenticatedHostIsolationProvider::try_new(
                provider_id,
                ledger,
                negotiator.ok_or_else(|| ProtocolFailure {
                    request_id: Some(start.request_id.clone()),
                    code: "host_negotiator_unavailable",
                    message: "Host negotiation transport is unavailable.".to_owned(),
                })?,
                Duration::from_millis(authority.challenge_ttl_ms),
            )
            .map_err(|message| ProtocolFailure {
                request_id: Some(start.request_id.clone()),
                code: "invalid_host_authority_configuration",
                message,
            })?;
            CleanRevisionWorktreeAdapter::try_new_with_isolation_provider(
                config,
                Arc::new(provider),
            )
        }
        IsolationProfile::Restricted => Err(
            "forge.kernel.transaction.v2 does not yet provide a restricted isolation backend."
                .to_owned(),
        ),
    }
    .map_err(|message| ProtocolFailure {
        request_id: Some(start.request_id.clone()),
        code: "invalid_transaction_configuration",
        message,
    })
}

fn input_router(
    mut reader: BufReader<io::Stdin>,
    request_id: String,
    cancellation: Arc<CancellationState>,
    statements: mpsc::Sender<SignedHostBoundaryStatement>,
) {
    loop {
        let frame = match read_bounded_frame(&mut reader, MAX_HOST_FRAME_BYTES) {
            Ok(Some(frame)) => frame,
            Ok(None) => return,
            Err(_) => {
                cancellation.set_once("Transaction protocol input became invalid.".to_owned());
                return;
            }
        };
        let message: TransactionHostMessage = match serde_json::from_slice(&frame) {
            Ok(message) => message,
            Err(_) => {
                cancellation.set_once("Transaction protocol input became invalid.".to_owned());
                return;
            }
        };
        match message {
            TransactionHostMessage::Cancel {
                protocol_version,
                request_id: incoming_request_id,
                reason,
            } => {
                if protocol_version != TRANSACTION_PROTOCOL_VERSION
                    || incoming_request_id != request_id
                    || !bounded_nonempty(&reason, MAX_CANCELLATION_REASON_BYTES)
                {
                    cancellation.set_once("Transaction protocol input became invalid.".to_owned());
                    return;
                }
                cancellation.set_once(reason);
            }
            TransactionHostMessage::HostStatement {
                protocol_version,
                request_id: incoming_request_id,
                signed_statement,
            } => {
                if protocol_version != TRANSACTION_PROTOCOL_VERSION
                    || incoming_request_id != request_id
                    || statements.send(signed_statement).is_err()
                {
                    cancellation.set_once("Transaction protocol input became invalid.".to_owned());
                    return;
                }
            }
        }
    }
}

fn send_shared(writer: &SharedWriter, message: &serde_json::Value) -> Result<(), String> {
    let mut writer = writer
        .lock()
        .map_err(|_| "Transaction protocol output is unavailable.".to_owned())?;
    send_json(&mut *writer, message)
}

pub fn execute(
    frame: &[u8],
    reader: BufReader<io::Stdin>,
    writer: SharedWriter,
) -> Result<(), ProtocolFailure> {
    let start = parse_start(frame)?;
    let cancellation = Arc::new(CancellationState::default());
    if let Some(reason) = start.initial_cancellation_reason.as_deref() {
        if !bounded_nonempty(reason, MAX_CANCELLATION_REASON_BYTES) {
            return Err(ProtocolFailure {
                request_id: Some(start.request_id),
                code: "invalid_cancellation_reason",
                message: "Initial cancellation reason must be bounded and non-empty.".to_owned(),
            });
        }
        cancellation.set_once(reason.to_owned());
    }
    let (statement_sender, statement_receiver) = mpsc::channel();
    let negotiator: Arc<dyn HostBoundaryNegotiator> = Arc::new(ProtocolHostNegotiator {
        request_id: start.request_id.clone(),
        writer: Arc::clone(&writer),
        statements: Mutex::new(statement_receiver),
    });
    let mut adapter = build_adapter(&start, Some(negotiator))?;
    let reader_cancellation = Arc::clone(&cancellation);
    let reader_request_id = start.request_id.clone();
    thread::spawn(move || {
        input_router(
            reader,
            reader_request_id,
            reader_cancellation,
            statement_sender,
        )
    });

    let artifact =
        execute_candidate_transaction(&start.request, &mut adapter, cancellation.as_ref());
    send_shared(
        &writer,
        &json!({
            "type": "transaction.result",
            "protocolVersion": TRANSACTION_PROTOCOL_VERSION,
            "requestId": start.request_id,
            "artifact": artifact,
        }),
    )
    .map_err(|message| ProtocolFailure {
        request_id: None,
        code: "transaction_output_failed",
        message,
    })
}
