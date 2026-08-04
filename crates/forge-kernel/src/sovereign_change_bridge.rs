use std::{
    io::{self, BufReader, BufWriter},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use forge_core::{
    ApprovalDecision, ApprovalFacts, ApprovalOutcome, Cancellation, CapabilityCall,
    IsolationPolicy, SOVEREIGN_CHANGE_PROPOSE_CAPABILITY_ID, SovereignChangeApproval,
    SovereignChangeConfig, SovereignChangeProposal, SovereignChangeService, VerificationCheck,
    resolve_approval,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::protocol::{
    MAX_CHANGE_START_FRAME_BYTES, MAX_HOST_FRAME_BYTES, SOVEREIGN_CHANGE_PROTOCOL_VERSION,
    read_bounded_frame, send_json,
};

const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_CANCELLATION_REASON_BYTES: usize = 512;

const CHANGE_ACCEPT_CAPABILITY_ID: &str = "workspace.change.accept";
const CHANGE_DISCARD_CAPABILITY_ID: &str = "workspace.change.discard";

fn project_prepare_artifact(mut artifact: Value) -> Value {
    let Some(operations) = artifact.get_mut("operations").and_then(Value::as_array_mut) else {
        return artifact;
    };
    for operation in operations {
        let Some(fields) = operation.as_object_mut() else {
            continue;
        };
        for (wire_name, host_name) in [
            ("before_sha256", "beforeSha256"),
            ("before_mode", "beforeMode"),
            ("after_mode", "afterMode"),
            ("from_path", "fromPath"),
            ("to_path", "toPath"),
        ] {
            if let Some(value) = fields.remove(wire_name) {
                fields.insert(host_name.to_owned(), value);
            }
        }
    }
    artifact
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SovereignChangeStart {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    config: SovereignChangeBridgeConfig,
    operation: SovereignChangeOperation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SovereignChangeBridgeConfig {
    repository_root: PathBuf,
    engine_root: PathBuf,
    #[serde(default = "default_git_executable")]
    git_executable: PathBuf,
    #[serde(default = "default_max_diff_bytes")]
    max_diff_bytes: usize,
    #[serde(default)]
    verification_checks: Vec<TrustedVerificationCheck>,
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
    #[serde(default)]
    inherit_environment: Vec<String>,
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
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum SovereignChangeOperation {
    Prepare {
        proposal: SovereignChangeProposal,
    },
    Propose {
        proposal: SovereignChangeProposal,
        expected_change_set_id: String,
        selected_check_ids: Vec<String>,
        call: CapabilityCall,
        approval_facts: ApprovalFacts,
        #[serde(default)]
        initial_cancellation_reason: Option<String>,
    },
    Inspect {
        transaction_id: String,
    },
    Accept {
        transaction_id: String,
        call: CapabilityCall,
        approval_facts: ApprovalFacts,
        #[serde(default)]
        initial_cancellation_reason: Option<String>,
    },
    Discard {
        transaction_id: String,
        call: CapabilityCall,
        approval_facts: ApprovalFacts,
        #[serde(default)]
        initial_cancellation_reason: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ChangeHostMessage {
    #[serde(rename = "change.cancel")]
    Cancel {
        protocol_version: String,
        request_id: String,
        reason: String,
    },
}

#[derive(Debug)]
pub struct SovereignChangeFailure {
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

fn invalid_start(message: impl Into<String>) -> SovereignChangeFailure {
    SovereignChangeFailure {
        request_id: None,
        code: "invalid_change_start",
        message: message.into(),
    }
}

fn validate_approval(
    call: &CapabilityCall,
    facts: &ApprovalFacts,
    expected_capability: &str,
    expected_input: Value,
) -> Result<ApprovalDecision, SovereignChangeFailure> {
    if call.capability_id != expected_capability
        || call.input != expected_input
        || facts.call_id != call.id
        || facts.capability_id != call.capability_id
    {
        return Err(SovereignChangeFailure {
            request_id: None,
            code: "invalid_change_approval",
            message: "Approval facts do not bind the exact sovereign change call.".into(),
        });
    }
    let decision = resolve_approval(facts).map_err(|message| SovereignChangeFailure {
        request_id: None,
        code: "invalid_change_approval",
        message,
    })?;
    if decision.outcome != ApprovalOutcome::Allow {
        return Err(SovereignChangeFailure {
            request_id: None,
            code: "change_not_authorized",
            message: decision.reason,
        });
    }
    Ok(decision)
}

fn build_service(
    config: &SovereignChangeBridgeConfig,
    request_id: &str,
) -> Result<SovereignChangeService, SovereignChangeFailure> {
    let mut service_config =
        SovereignChangeConfig::new(&config.repository_root, &config.engine_root);
    service_config.git_executable = config.git_executable.clone();
    service_config.max_diff_bytes = config.max_diff_bytes;
    SovereignChangeService::try_new(service_config).map_err(|message| SovereignChangeFailure {
        request_id: Some(request_id.to_owned()),
        code: "invalid_change_configuration",
        message,
    })
}

fn verification_checks(config: &SovereignChangeBridgeConfig) -> Vec<VerificationCheck> {
    config
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
            isolation_policy: IsolationPolicy::trusted(),
            timeout: Duration::from_millis(check.timeout_ms),
            max_output_bytes: check.max_output_bytes,
        })
        .collect()
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
            cancellation.set_once("Sovereign change protocol input became invalid.".into());
            return;
        }
    };
    let message: ChangeHostMessage = match serde_json::from_slice(&frame) {
        Ok(message) => message,
        Err(_) => {
            cancellation.set_once("Sovereign change protocol input became invalid.".into());
            return;
        }
    };
    match message {
        ChangeHostMessage::Cancel {
            protocol_version,
            request_id: incoming_request_id,
            reason,
        } => {
            if protocol_version != SOVEREIGN_CHANGE_PROTOCOL_VERSION
                || incoming_request_id != request_id
                || !bounded_nonempty(&reason, MAX_CANCELLATION_REASON_BYTES)
            {
                cancellation.set_once("Sovereign change protocol input became invalid.".into());
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
) -> Result<(), SovereignChangeFailure> {
    if frame.len() > MAX_CHANGE_START_FRAME_BYTES {
        return Err(invalid_start(
            "Sovereign change start frame exceeded the configured limit.",
        ));
    }
    let start: SovereignChangeStart = serde_json::from_slice(frame)
        .map_err(|_| invalid_start("Invalid sovereign change start JSON."))?;
    if start.message_type != "change.start"
        || start.protocol_version != SOVEREIGN_CHANGE_PROTOCOL_VERSION
        || !bounded_nonempty(&start.request_id, MAX_REQUEST_ID_BYTES)
    {
        return Err(invalid_start("Sovereign change start identity is invalid."));
    }
    let request_id = start.request_id.clone();
    let service = build_service(&start.config, &request_id)?;
    let cancellation = Arc::new(CancellationState::default());
    let (operation, artifact) = match start.operation {
        SovereignChangeOperation::Prepare { proposal } => {
            let artifact =
                service
                    .prepare(&proposal)
                    .map_err(|message| SovereignChangeFailure {
                        request_id: Some(request_id.clone()),
                        code: "change_prepare_failed",
                        message,
                    })?;
            (
                "prepare",
                serde_json::to_value(artifact).map(project_prepare_artifact),
            )
        }
        SovereignChangeOperation::Inspect { transaction_id } => {
            let artifact =
                service
                    .inspect(&transaction_id)
                    .map_err(|message| SovereignChangeFailure {
                        request_id: Some(request_id.clone()),
                        code: "change_inspection_failed",
                        message,
                    })?;
            ("inspect", serde_json::to_value(artifact))
        }
        SovereignChangeOperation::Propose {
            proposal,
            expected_change_set_id,
            selected_check_ids,
            call,
            approval_facts,
            initial_cancellation_reason,
        } => {
            let approval_decision = validate_approval(
                &call,
                &approval_facts,
                SOVEREIGN_CHANGE_PROPOSE_CAPABILITY_ID,
                json!({
                    "changeSetId": expected_change_set_id,
                    "selectedCheckIds": selected_check_ids,
                }),
            )?;
            if let Some(reason) = initial_cancellation_reason {
                if !bounded_nonempty(&reason, MAX_CANCELLATION_REASON_BYTES) {
                    return Err(invalid_start("Initial cancellation reason is invalid."));
                }
                cancellation.set_once(reason);
            }
            let reader_cancellation = Arc::clone(&cancellation);
            let reader_request_id = request_id.clone();
            thread::spawn(move || {
                cancellation_reader(reader, reader_request_id, reader_cancellation)
            });
            let approval = SovereignChangeApproval {
                expected_change_set_id,
                selected_check_ids,
                call,
                facts: approval_facts,
                decision: approval_decision,
            };
            let artifact = service.propose(
                &proposal,
                &approval,
                verification_checks(&start.config),
                cancellation.as_ref(),
            );
            ("propose", serde_json::to_value(artifact))
        }
        SovereignChangeOperation::Accept {
            transaction_id,
            call,
            approval_facts,
            initial_cancellation_reason,
        } => {
            validate_approval(
                &call,
                &approval_facts,
                CHANGE_ACCEPT_CAPABILITY_ID,
                json!({ "transactionId": transaction_id }),
            )?;
            if let Some(reason) = initial_cancellation_reason {
                if !bounded_nonempty(&reason, MAX_CANCELLATION_REASON_BYTES) {
                    return Err(invalid_start("Initial cancellation reason is invalid."));
                }
                cancellation.set_once(reason);
            }
            let reader_cancellation = Arc::clone(&cancellation);
            let reader_request_id = request_id.clone();
            thread::spawn(move || {
                cancellation_reader(reader, reader_request_id, reader_cancellation)
            });
            let artifact = service
                .accept(&transaction_id, cancellation.as_ref())
                .map_err(|message| SovereignChangeFailure {
                    request_id: Some(request_id.clone()),
                    code: "change_accept_failed",
                    message,
                })?;
            ("accept", serde_json::to_value(artifact))
        }
        SovereignChangeOperation::Discard {
            transaction_id,
            call,
            approval_facts,
            initial_cancellation_reason,
        } => {
            validate_approval(
                &call,
                &approval_facts,
                CHANGE_DISCARD_CAPABILITY_ID,
                json!({ "transactionId": transaction_id }),
            )?;
            if let Some(reason) = initial_cancellation_reason {
                if !bounded_nonempty(&reason, MAX_CANCELLATION_REASON_BYTES) {
                    return Err(invalid_start("Initial cancellation reason is invalid."));
                }
                cancellation.set_once(reason);
            }
            let reader_cancellation = Arc::clone(&cancellation);
            let reader_request_id = request_id.clone();
            thread::spawn(move || {
                cancellation_reader(reader, reader_request_id, reader_cancellation)
            });
            let artifact = service
                .discard(&transaction_id, cancellation.as_ref())
                .map_err(|message| SovereignChangeFailure {
                    request_id: Some(request_id.clone()),
                    code: "change_discard_failed",
                    message,
                })?;
            ("discard", serde_json::to_value(artifact))
        }
    };
    let artifact = artifact.map_err(|_| SovereignChangeFailure {
        request_id: Some(request_id.clone()),
        code: "change_result_encoding_failed",
        message: "Cannot encode sovereign change artifact.".into(),
    })?;
    send_json(
        writer,
        &json!({
            "type": "change.result",
            "protocolVersion": SOVEREIGN_CHANGE_PROTOCOL_VERSION,
            "requestId": request_id,
            "operation": operation,
            "artifact": artifact,
        }),
    )
    .map_err(|message| SovereignChangeFailure {
        request_id: None,
        code: "change_result_write_failed",
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn start(proposal: Value) -> Value {
        json!({
            "type": "change.start",
            "protocolVersion": SOVEREIGN_CHANGE_PROTOCOL_VERSION,
            "requestId": "change-bridge:test",
            "config": {
                "repositoryRoot": "/tmp/repository",
                "engineRoot": "/tmp/engine",
                "verificationChecks": [{
                    "checkId": "test",
                    "executable": "/usr/bin/test",
                    "arguments": [],
                    "timeoutMs": 1000,
                    "maxOutputBytes": 1024
                }]
            },
            "operation": {
                "kind": "propose",
                "proposal": proposal,
                "expectedChangeSetId": "changeset:test",
                "selectedCheckIds": ["test"],
                "call": {
                    "id": "call:test",
                    "capabilityId": SOVEREIGN_CHANGE_PROPOSE_CAPABILITY_ID,
                    "input": {
                        "changeSetId": "changeset:test",
                        "selectedCheckIds": ["test"]
                    }
                },
                "approvalFacts": {
                    "schemaVersion": 1,
                    "callId": "call:test",
                    "capabilityId": SOVEREIGN_CHANGE_PROPOSE_CAPABILITY_ID,
                    "hostPolicy": {
                        "posture": "ask",
                        "source": "test",
                        "reason": "test"
                    },
                    "userConsent": {
                        "status": "granted",
                        "source": "test",
                        "reason": "test"
                    }
                }
            }
        })
    }

    #[test]
    fn parses_the_camel_case_typescript_start_frame() {
        let value = start(json!({
            "schemaVersion": 1,
            "operations": [{
                "kind": "replace",
                "path": "message.txt",
                "after": { "encoding": "utf8", "value": "after\n" },
                "afterMode": "regular"
            }]
        }));
        let parsed: SovereignChangeStart = serde_json::from_value(value).expect("start frame");
        assert!(matches!(
            parsed.operation,
            SovereignChangeOperation::Propose { .. }
        ));
    }

    #[test]
    fn projects_prepared_operation_fields_to_the_camel_case_host_contract() {
        let projected = project_prepare_artifact(json!({
            "schemaVersion": 2,
            "operations": [{
                "kind": "move",
                "from_path": "before.txt",
                "to_path": "after.txt",
                "before_sha256": "digest",
                "before_mode": "regular",
                "after_mode": "regular"
            }]
        }));
        assert_eq!(projected["operations"][0]["fromPath"], "before.txt");
        assert_eq!(projected["operations"][0]["toPath"], "after.txt");
        assert_eq!(projected["operations"][0]["beforeSha256"], "digest");
        assert_eq!(projected["operations"][0]["beforeMode"], "regular");
        assert_eq!(projected["operations"][0]["afterMode"], "regular");
        assert!(projected["operations"][0].get("before_sha256").is_none());
    }

    #[test]
    fn proposal_cannot_supply_verification_commands() {
        let value = start(json!({
            "schemaVersion": 1,
            "operations": [{
                "kind": "delete",
                "path": "message.txt"
            }],
            "verificationChecks": [{ "executable": "untrusted" }]
        }));
        assert!(serde_json::from_value::<SovereignChangeStart>(value).is_err());
    }
}
