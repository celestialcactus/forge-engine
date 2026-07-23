mod protocol;
mod transaction_bridge;

use std::cell::RefCell;
use std::collections::HashSet;
use std::io::{self, BufReader, BufWriter};
use std::rc::Rc;

use forge_core::{
    ApprovalDecision, ApprovalFacts, ApprovalPolicy, Cancellation, CapabilityAdapter,
    CapabilityCall, CapabilityResult, PlannerRequest, PlannerTurn, RunArtifact, RunEvent,
    RunRequest, RuntimeSignal, Slice0Runtime, TaskPlanner, WorkspaceSnapshot, resolve_approval,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::protocol::{
    MAX_HOST_FRAME_BYTES, MAX_START_FRAME_BYTES, RUN_PROTOCOL_VERSION, StartDiscriminator,
    read_bounded_frame, send_json, send_protocol_error,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunStart {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    request: RunRequest,
    capability_ids: Vec<String>,
    #[serde(default)]
    initial_cancellation_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum HostMessage {
    #[serde(rename = "planner.turn")]
    PlannerTurn {
        protocol_version: String,
        request_id: String,
        turn: PlannerTurn,
    },
    #[serde(rename = "capability.result")]
    CapabilityResult {
        protocol_version: String,
        request_id: String,
        result: CapabilityResult,
    },
    #[serde(rename = "approval.facts")]
    ApprovalFacts {
        protocol_version: String,
        request_id: String,
        facts: ApprovalFacts,
    },
    #[serde(rename = "runtime.error")]
    RuntimeError {
        protocol_version: String,
        request_id: String,
        message: String,
    },
    #[serde(rename = "run.cancel")]
    RunCancel {
        protocol_version: String,
        request_id: String,
        reason: String,
    },
}

struct BridgeIo {
    reader: BufReader<io::Stdin>,
    writer: BufWriter<io::Stdout>,
    request_id: String,
}

impl BridgeIo {
    fn send(&mut self, message: &Value) -> Result<(), String> {
        send_json(&mut self.writer, message)
    }

    fn receive(&mut self) -> Result<HostMessage, String> {
        let frame =
            read_bounded_frame(&mut self.reader, MAX_HOST_FRAME_BYTES)?.ok_or_else(|| {
                "TypeScript adapter closed before returning a terminal response.".to_owned()
            })?;
        let message: HostMessage = serde_json::from_slice(&frame)
            .map_err(|error| format!("Invalid bridge JSON: {error}"))?;
        let (protocol_version, request_id) = match &message {
            HostMessage::PlannerTurn {
                protocol_version,
                request_id,
                ..
            }
            | HostMessage::CapabilityResult {
                protocol_version,
                request_id,
                ..
            }
            | HostMessage::ApprovalFacts {
                protocol_version,
                request_id,
                ..
            }
            | HostMessage::RuntimeError {
                protocol_version,
                request_id,
                ..
            }
            | HostMessage::RunCancel {
                protocol_version,
                request_id,
                ..
            } => (protocol_version, request_id),
        };
        if protocol_version != RUN_PROTOCOL_VERSION {
            return Err(format!("Unsupported bridge protocol: {protocol_version}"));
        }
        if request_id != &self.request_id {
            return Err(format!("Mismatched bridge request ID: {request_id}"));
        }
        Ok(message)
    }
}

struct BridgePlanner {
    io: Rc<RefCell<BridgeIo>>,
}

impl TaskPlanner for BridgePlanner {
    fn next(&mut self, request: PlannerRequest) -> Result<PlannerTurn, RuntimeSignal> {
        let incoming = {
            let mut io = self.io.borrow_mut();
            let request_id = io.request_id.clone();
            io.send(&json!({
                "type": "planner.next",
                "protocolVersion": RUN_PROTOCOL_VERSION,
                "requestId": request_id,
                "request": request,
            }))
            .map_err(RuntimeSignal::Failed)?;
            io.receive().map_err(RuntimeSignal::Failed)?
        };
        match incoming {
            HostMessage::PlannerTurn { turn, .. } => Ok(turn),
            HostMessage::RunCancel { reason, .. } => Err(RuntimeSignal::Cancelled(reason)),
            HostMessage::CapabilityResult { .. } => Err(RuntimeSignal::Failed(
                "Received capability.result while awaiting planner.turn.".to_owned(),
            )),
            HostMessage::ApprovalFacts { .. } => Err(RuntimeSignal::Failed(
                "Received approval.facts while awaiting planner.turn.".to_owned(),
            )),
            HostMessage::RuntimeError { message, .. } => Err(RuntimeSignal::Failed(message)),
        }
    }
}

struct BridgeCapabilities {
    io: Rc<RefCell<BridgeIo>>,
    supported: HashSet<String>,
}

impl CapabilityAdapter for BridgeCapabilities {
    fn supports(&self, capability_id: &str) -> bool {
        self.supported.contains(capability_id)
    }

    fn invoke(
        &mut self,
        call: &CapabilityCall,
        snapshot: &WorkspaceSnapshot,
    ) -> Result<CapabilityResult, RuntimeSignal> {
        let incoming = {
            let mut io = self.io.borrow_mut();
            let request_id = io.request_id.clone();
            io.send(&json!({
                "type": "capability.invoke",
                "protocolVersion": RUN_PROTOCOL_VERSION,
                "requestId": request_id,
                "call": call,
                "snapshot": snapshot,
            }))
            .map_err(RuntimeSignal::Failed)?;
            io.receive().map_err(RuntimeSignal::Failed)?
        };
        match incoming {
            HostMessage::CapabilityResult { result, .. } => {
                if result.call_id != call.id {
                    return Err(RuntimeSignal::Failed(format!(
                        "Capability result call ID {} does not match {}.",
                        result.call_id, call.id
                    )));
                }
                Ok(result)
            }
            HostMessage::RunCancel { reason, .. } => Err(RuntimeSignal::Cancelled(reason)),
            HostMessage::PlannerTurn { .. } => Err(RuntimeSignal::Failed(
                "Received planner.turn while awaiting capability.result.".to_owned(),
            )),
            HostMessage::ApprovalFacts { .. } => Err(RuntimeSignal::Failed(
                "Received approval.facts while awaiting capability.result.".to_owned(),
            )),
            HostMessage::RuntimeError { message, .. } => Err(RuntimeSignal::Failed(message)),
        }
    }
}

struct BridgePolicy {
    io: Rc<RefCell<BridgeIo>>,
}

impl ApprovalPolicy for BridgePolicy {
    fn decide(&mut self, call: &CapabilityCall) -> Result<ApprovalDecision, RuntimeSignal> {
        let incoming = {
            let mut io = self.io.borrow_mut();
            let request_id = io.request_id.clone();
            io.send(&json!({
                "type": "approval.facts.request",
                "protocolVersion": RUN_PROTOCOL_VERSION,
                "requestId": request_id,
                "call": call,
            }))
            .map_err(RuntimeSignal::Failed)?;
            io.receive().map_err(RuntimeSignal::Failed)?
        };
        match incoming {
            HostMessage::ApprovalFacts { facts, .. } => {
                if facts.call_id != call.id || facts.capability_id != call.capability_id {
                    return Err(RuntimeSignal::Failed(format!(
                        "Approval facts target {}/{} does not match capability call {}/{}.",
                        facts.call_id, facts.capability_id, call.id, call.capability_id
                    )));
                }
                resolve_approval(&facts).map_err(RuntimeSignal::Failed)
            }
            HostMessage::RunCancel { reason, .. } => Err(RuntimeSignal::Cancelled(reason)),
            HostMessage::PlannerTurn { .. } => Err(RuntimeSignal::Failed(
                "Received planner.turn while awaiting approval.facts.".to_owned(),
            )),
            HostMessage::CapabilityResult { .. } => Err(RuntimeSignal::Failed(
                "Received capability.result while awaiting approval.facts.".to_owned(),
            )),
            HostMessage::RuntimeError { message, .. } => Err(RuntimeSignal::Failed(message)),
        }
    }
}

struct InitialCancellation(Option<String>);

impl Cancellation for InitialCancellation {
    fn reason(&self) -> Option<String> {
        self.0.clone()
    }
}

struct BridgeEventSink {
    io: Rc<RefCell<BridgeIo>>,
}

impl forge_core::runtime::EventSink for BridgeEventSink {
    fn on_event(&mut self, event: &RunEvent) {
        let mut io = self.io.borrow_mut();
        let request_id = io.request_id.clone();
        io.send(&json!({
            "type": "run.event",
            "protocolVersion": RUN_PROTOCOL_VERSION,
            "requestId": request_id,
            "event": event,
        }))
        .expect("bridge event output must remain writable");
    }
}

fn parse_run_start(frame: &[u8]) -> Result<RunStart, String> {
    let start: RunStart = serde_json::from_slice(frame)
        .map_err(|error| format!("Invalid run.start JSON: {error}"))?;
    if start.message_type != "run.start" {
        return Err(format!(
            "Expected run.start, received {}.",
            start.message_type
        ));
    }
    if start.protocol_version != RUN_PROTOCOL_VERSION {
        return Err(format!(
            "Unsupported bridge protocol: {}",
            start.protocol_version
        ));
    }
    if start.request_id.trim().is_empty() {
        return Err("Bridge requestId must not be empty.".to_owned());
    }
    Ok(start)
}

fn send_terminal(io: &Rc<RefCell<BridgeIo>>, artifact: &RunArtifact) -> Result<(), String> {
    let mut io = io.borrow_mut();
    let request_id = io.request_id.clone();
    io.send(&json!({
        "type": "run.result",
        "protocolVersion": RUN_PROTOCOL_VERSION,
        "requestId": request_id,
        "artifact": artifact,
    }))
}

fn execute_run(
    start: RunStart,
    reader: BufReader<io::Stdin>,
    writer: BufWriter<io::Stdout>,
) -> Result<(), String> {
    let request = start.request;
    let cancellation = InitialCancellation(start.initial_cancellation_reason);
    let capability_ids = start.capability_ids;
    let io = Rc::new(RefCell::new(BridgeIo {
        reader,
        writer,
        request_id: start.request_id,
    }));
    let mut planner = BridgePlanner { io: Rc::clone(&io) };
    let mut capabilities = BridgeCapabilities {
        io: Rc::clone(&io),
        supported: capability_ids.into_iter().collect(),
    };
    let mut policy = BridgePolicy { io: Rc::clone(&io) };
    let mut sink = BridgeEventSink { io: Rc::clone(&io) };
    let artifact = Slice0Runtime {
        planner: &mut planner,
        approval_policy: &mut policy,
        capabilities: &mut capabilities,
        cancellation: &cancellation,
        event_sink: &mut sink,
    }
    .run(request);

    send_terminal(&io, &artifact)
}

fn main() {
    let mut reader = BufReader::new(io::stdin());
    let mut writer = BufWriter::new(io::stdout());
    let frame = match read_bounded_frame(&mut reader, MAX_START_FRAME_BYTES) {
        Ok(Some(frame)) => frame,
        Ok(None) => {
            send_protocol_error(
                &mut writer,
                RUN_PROTOCOL_VERSION,
                None,
                "missing_start",
                "Expected a protocol start frame before end of input.",
            );
            std::process::exit(2);
        }
        Err(message) => {
            send_protocol_error(
                &mut writer,
                RUN_PROTOCOL_VERSION,
                None,
                "invalid_start_frame",
                &message,
            );
            std::process::exit(2);
        }
    };
    let discriminator: StartDiscriminator = match serde_json::from_slice(&frame) {
        Ok(discriminator) => discriminator,
        Err(_) => {
            send_protocol_error(
                &mut writer,
                RUN_PROTOCOL_VERSION,
                None,
                "invalid_start_json",
                "Invalid protocol start JSON.",
            );
            std::process::exit(2);
        }
    };

    if discriminator.message_type == "run.start"
        && discriminator.protocol_version == RUN_PROTOCOL_VERSION
    {
        let start = match parse_run_start(&frame) {
            Ok(start) => start,
            Err(message) => {
                send_protocol_error(
                    &mut writer,
                    RUN_PROTOCOL_VERSION,
                    None,
                    "invalid_run_start",
                    &message,
                );
                std::process::exit(2);
            }
        };
        if let Err(message) = execute_run(start, reader, writer) {
            eprintln!("forge-kernel failed to return terminal artifact: {message}");
            std::process::exit(3);
        }
        return;
    }

    if discriminator.message_type == "transaction.start"
        && discriminator.protocol_version == protocol::TRANSACTION_PROTOCOL_VERSION
    {
        if let Err(failure) = transaction_bridge::execute(&frame, reader, &mut writer) {
            send_protocol_error(
                &mut writer,
                protocol::TRANSACTION_PROTOCOL_VERSION,
                failure.request_id.as_deref(),
                failure.code,
                &failure.message,
            );
            std::process::exit(2);
        }
        return;
    }

    send_protocol_error(
        &mut writer,
        RUN_PROTOCOL_VERSION,
        None,
        "unsupported_protocol",
        "Unsupported protocol start type or version.",
    );
    std::process::exit(2);
}
