use std::{
    io::{self, BufReader, BufWriter},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use forge_core::{
    Cancellation, ChangeTransactionRequest, CleanRevisionWorktreeAdapter, IsolationPolicy,
    IsolationProfile, VerificationCheck, WorktreeAdapterConfig, execute_candidate_transaction,
};
use serde::Deserialize;
use serde_json::json;

use crate::protocol::{
    MAX_HOST_FRAME_BYTES, TRANSACTION_PROTOCOL_VERSION, read_bounded_frame, send_json,
};

const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_CANCELLATION_REASON_BYTES: usize = 512;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransactionStart {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    request: ChangeTransactionRequest,
    configuration: TrustedTransactionConfiguration,
    #[serde(default)]
    initial_cancellation_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustedTransactionConfiguration {
    repository_root: PathBuf,
    candidate_parent: PathBuf,
    #[serde(default = "default_git_executable")]
    git_executable: PathBuf,
    verification_checks: Vec<TrustedVerificationCheck>,
    #[serde(default = "default_max_diff_bytes")]
    max_diff_bytes: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustedVerificationCheck {
    check_id: String,
    executable: PathBuf,
    #[serde(default)]
    arguments: Vec<String>,
    #[serde(default)]
    environment: Vec<EnvironmentEntry>,
    timeout_ms: u64,
    max_output_bytes: usize,
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

fn build_adapter(
    start: &TransactionStart,
) -> Result<CleanRevisionWorktreeAdapter, ProtocolFailure> {
    if start.request.verification.isolation.profile != IsolationProfile::Trusted
        || start
            .request
            .verification
            .isolation
            .host_attestation
            .is_some()
    {
        return Err(ProtocolFailure {
            request_id: Some(start.request_id.clone()),
            code: "unsupported_isolation_profile",
            message:
                "forge.kernel.transaction.v1 accepts only trusted verification without host attestation."
                    .to_owned(),
        });
    }
    let checks = start
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
            isolation_policy: IsolationPolicy::trusted(),
            timeout: Duration::from_millis(check.timeout_ms),
            max_output_bytes: check.max_output_bytes,
        })
        .collect();
    let mut config = WorktreeAdapterConfig::new(
        &start.configuration.repository_root,
        &start.configuration.candidate_parent,
        &start.request.expected_base_revision,
        checks,
    );
    config.git_executable = start.configuration.git_executable.clone();
    config.max_diff_bytes = start.configuration.max_diff_bytes;
    CleanRevisionWorktreeAdapter::try_new(config).map_err(|message| ProtocolFailure {
        request_id: Some(start.request_id.clone()),
        code: "invalid_transaction_configuration",
        message,
    })
}

fn cancellation_reader(
    mut reader: BufReader<io::Stdin>,
    request_id: String,
    cancellation: Arc<CancellationState>,
) {
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
            } else {
                cancellation.set_once(reason);
            }
        }
    }
}

pub fn execute(
    frame: &[u8],
    reader: BufReader<io::Stdin>,
    writer: &mut BufWriter<io::Stdout>,
) -> Result<(), ProtocolFailure> {
    let start = parse_start(frame)?;
    let mut adapter = build_adapter(&start)?;
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
    let reader_cancellation = Arc::clone(&cancellation);
    let reader_request_id = start.request_id.clone();
    thread::spawn(move || cancellation_reader(reader, reader_request_id, reader_cancellation));

    let artifact =
        execute_candidate_transaction(&start.request, &mut adapter, cancellation.as_ref());
    send_json(
        writer,
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
