mod candidate_bridge;
mod protocol;
mod run_store_bridge;
mod sovereign_change_bridge;
mod transaction_bridge;

use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{self, BufReader, BufWriter};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use forge_core::{
    ApprovalDecision, ApprovalFacts, ApprovalPolicy, BaselineIsolationProvider, Cancellation,
    CapabilityAdapter, CapabilityCall, CapabilityContext, CapabilityDescriptor,
    CapabilityReplaySafety, CapabilityResult, InteractionReplaySafety, IsolationProvider,
    IsolationProviderStatus, PlannerRequest, PlannerTurn, RecordedRunInteraction, RunArtifact,
    RunContinuationDisposition, RunEvent, RunExecutionLock, RunInteractionKind, RunLedger,
    RunRecoveryCheckpoint, RunRequest, RunResumeOpen, RuntimeSignal, Slice0Runtime, TaskPlanner,
    WorkspaceSnapshot, isolation_provider_restricted_ready, resolve_approval,
};
#[cfg(windows)]
use forge_core::{WindowsAppContainerIsolationProvider, WindowsManagedIsolationProvider};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::protocol::{
    MAX_HOST_FRAME_BYTES, MAX_START_FRAME_BYTES, PROBE_PROTOCOL_VERSION, RUN_PROTOCOL_VERSION,
    RUN_STORE_PROTOCOL_VERSION, StartDiscriminator, read_bounded_frame, send_json,
    send_protocol_error,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunStart {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    request: RunRequest,
    capabilities: Vec<CapabilityDescriptor>,
    run_store_root: std::path::PathBuf,
    #[serde(default)]
    initial_cancellation_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunResume {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    run_id: String,
    capabilities: Vec<CapabilityDescriptor>,
    run_store_root: std::path::PathBuf,
    #[serde(default)]
    allow_retryable_capability_retry: bool,
    #[serde(default)]
    initial_cancellation_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
        turn: Box<PlannerTurn>,
        #[serde(skip_serializing_if = "Option::is_none")]
        planner_checkpoint: Option<Value>,
    },
    #[serde(rename = "capability.result")]
    CapabilityResult {
        protocol_version: String,
        request_id: String,
        result: CapabilityResult,
    },
    #[serde(rename = "capability.progress")]
    CapabilityProgress {
        protocol_version: String,
        request_id: String,
        call_id: String,
        checkpoint: Value,
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
    #[serde(rename = "run.resume.accepted")]
    ResumeAccepted {
        protocol_version: String,
        request_id: String,
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
            | HostMessage::CapabilityProgress {
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
            }
            | HostMessage::ResumeAccepted {
                protocol_version,
                request_id,
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

enum ReplayDecision {
    Recorded(Box<HostMessage>),
    LiveNew,
    LiveRetry,
}

struct ReplayCursor {
    interactions: Vec<RecordedRunInteraction>,
    next: usize,
    allow_retryable_capability_retry: bool,
}

impl ReplayCursor {
    fn fresh() -> Self {
        Self {
            interactions: Vec::new(),
            next: 0,
            allow_retryable_capability_retry: false,
        }
    }

    fn resumed(
        interactions: Vec<RecordedRunInteraction>,
        allow_retryable_capability_retry: bool,
    ) -> Self {
        Self {
            interactions,
            next: 0,
            allow_retryable_capability_retry,
        }
    }

    fn resolve(
        &mut self,
        interaction_id: &str,
        kind: RunInteractionKind,
        replay_safety: InteractionReplaySafety,
        intent_payload: &Value,
    ) -> Result<ReplayDecision, RuntimeSignal> {
        let Some(recorded) = self.interactions.get(self.next) else {
            return Ok(ReplayDecision::LiveNew);
        };
        if recorded.interaction_id != interaction_id
            || recorded.kind != kind
            || recorded.replay_safety != replay_safety
            || &recorded.intent_payload != intent_payload
        {
            return Err(RuntimeSignal::Failed(format!(
                "Continuation replay diverged at interaction {}.",
                self.next + 1
            )));
        }
        self.next = self.next.saturating_add(1);
        if let Some(completion) = &recorded.completion_payload {
            let incoming: HostMessage =
                serde_json::from_value(completion.clone()).map_err(|error| {
                    RuntimeSignal::Failed(format!(
                        "Recorded interaction completion is invalid: {error}"
                    ))
                })?;
            return Ok(ReplayDecision::Recorded(Box::new(incoming)));
        }
        if kind == RunInteractionKind::Capability
            && replay_safety == InteractionReplaySafety::ReadOnlyRetryable
            && self.allow_retryable_capability_retry
        {
            self.allow_retryable_capability_retry = false;
            return Ok(ReplayDecision::LiveRetry);
        }
        Err(RuntimeSignal::Failed(
            "Continuation reached an unresolved interaction that cannot be retried.".to_owned(),
        ))
    }

    fn ensure_consumed(&self) -> Result<(), String> {
        if self.next == self.interactions.len() {
            Ok(())
        } else {
            Err(format!(
                "Continuation runtime consumed {} of {} recorded interactions.",
                self.next,
                self.interactions.len()
            ))
        }
    }
}

struct BridgePlanner {
    io: Rc<RefCell<BridgeIo>>,
    ledger: Rc<RefCell<RunLedger>>,
    replay: Rc<RefCell<ReplayCursor>>,
}

impl TaskPlanner for BridgePlanner {
    fn next(&mut self, request: PlannerRequest) -> Result<PlannerTurn, RuntimeSignal> {
        let interaction_id = format!("planner:{}", request.turn);
        let intent_payload = json!({ "request": &request });
        let incoming = match self.replay.borrow_mut().resolve(
            &interaction_id,
            RunInteractionKind::Planner,
            InteractionReplaySafety::NeverRetry,
            &intent_payload,
        )? {
            ReplayDecision::Recorded(incoming) => *incoming,
            ReplayDecision::LiveNew => {
                self.ledger
                    .borrow_mut()
                    .record_interaction_intent(
                        &interaction_id,
                        RunInteractionKind::Planner,
                        InteractionReplaySafety::NeverRetry,
                        intent_payload,
                    )
                    .map_err(RuntimeSignal::Failed)?;
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
                let completion = serde_json::to_value(&incoming).map_err(|error| {
                    RuntimeSignal::Failed(format!("Cannot encode planner completion: {error}"))
                })?;
                self.ledger
                    .borrow_mut()
                    .record_interaction_completion(
                        &interaction_id,
                        RunInteractionKind::Planner,
                        completion,
                    )
                    .map_err(RuntimeSignal::Failed)?;
                incoming
            }
            ReplayDecision::LiveRetry => {
                return Err(RuntimeSignal::Failed(
                    "Planner interactions cannot be retried during continuation.".to_owned(),
                ));
            }
        };
        match incoming {
            HostMessage::PlannerTurn { turn, .. } => Ok(*turn),
            HostMessage::RunCancel { reason, .. } => Err(RuntimeSignal::Cancelled(reason)),
            HostMessage::CapabilityResult { .. } => Err(RuntimeSignal::Failed(
                "Received capability.result while awaiting planner.turn.".to_owned(),
            )),
            HostMessage::CapabilityProgress { .. } => Err(RuntimeSignal::Failed(
                "Received capability.progress while awaiting planner.turn.".to_owned(),
            )),
            HostMessage::ApprovalFacts { .. } => Err(RuntimeSignal::Failed(
                "Received approval.facts while awaiting planner.turn.".to_owned(),
            )),
            HostMessage::RuntimeError { message, .. } => Err(RuntimeSignal::Failed(message)),
            HostMessage::ResumeAccepted { .. } => Err(RuntimeSignal::Failed(
                "Received run.resume.accepted while awaiting planner.turn.".to_owned(),
            )),
        }
    }
}

struct BridgeCapabilities {
    io: Rc<RefCell<BridgeIo>>,
    ledger: Rc<RefCell<RunLedger>>,
    replay: Rc<RefCell<ReplayCursor>>,
    supported: HashMap<String, CapabilityReplaySafety>,
}

impl CapabilityAdapter for BridgeCapabilities {
    fn supports(&self, capability_id: &str) -> bool {
        self.supported.contains_key(capability_id)
    }

    fn invoke(
        &mut self,
        call: &CapabilityCall,
        snapshot: &WorkspaceSnapshot,
        context: &CapabilityContext,
    ) -> Result<CapabilityResult, RuntimeSignal> {
        let replay_safety = match self.supported.get(&call.capability_id) {
            Some(CapabilityReplaySafety::ReadOnlyRetryable) => {
                InteractionReplaySafety::ReadOnlyRetryable
            }
            Some(CapabilityReplaySafety::NonIdempotent) => InteractionReplaySafety::NonIdempotent,
            None => {
                return Err(RuntimeSignal::Failed(format!(
                    "Capability {} has no registered replay-safety descriptor.",
                    call.capability_id
                )));
            }
        };
        let interaction_id = format!("capability:{}", call.id);
        let intent_payload = json!({
            "call": call,
            "snapshot": snapshot,
            "context": context,
        });
        let decision = self.replay.borrow_mut().resolve(
            &interaction_id,
            RunInteractionKind::Capability,
            replay_safety.clone(),
            &intent_payload,
        )?;
        let incoming = match decision {
            ReplayDecision::Recorded(incoming) => *incoming,
            ReplayDecision::LiveNew | ReplayDecision::LiveRetry => {
                match decision {
                    ReplayDecision::LiveNew => self.ledger.borrow_mut().record_interaction_intent(
                        &interaction_id,
                        RunInteractionKind::Capability,
                        replay_safety.clone(),
                        intent_payload,
                    ),
                    ReplayDecision::LiveRetry => {
                        self.ledger.borrow_mut().record_interaction_retry_intent(
                            &interaction_id,
                            RunInteractionKind::Capability,
                            replay_safety.clone(),
                            intent_payload,
                        )
                    }
                    ReplayDecision::Recorded(_) => unreachable!("recorded handled above"),
                }
                .map_err(RuntimeSignal::Failed)?;
                let incoming = {
                    let mut io = self.io.borrow_mut();
                    let request_id = io.request_id.clone();
                    io.send(&json!({
                        "type": "capability.invoke",
                        "protocolVersion": RUN_PROTOCOL_VERSION,
                        "requestId": request_id,
                        "call": call,
                        "snapshot": snapshot,
                        "context": context,
                    }))
                    .map_err(RuntimeSignal::Failed)?;
                    loop {
                        match io.receive().map_err(RuntimeSignal::Failed)? {
                            HostMessage::CapabilityProgress {
                                call_id,
                                checkpoint,
                                ..
                            } => {
                                let recorded = (|| -> Result<RunRecoveryCheckpoint, String> {
                                    if call_id != call.id {
                                        return Err(format!(
                                            "Capability progress call ID {call_id} does not match {}.",
                                            call.id
                                        ));
                                    }
                                    let checkpoint: RunRecoveryCheckpoint =
                                        serde_json::from_value(checkpoint).map_err(|error| {
                                            format!(
                                                "Capability recovery checkpoint is invalid: {error}"
                                            )
                                        })?;
                                    self.ledger.borrow_mut().record_interaction_checkpoint(
                                        &interaction_id,
                                        checkpoint.clone(),
                                    )?;
                                    Ok(checkpoint)
                                })();
                                match recorded {
                                    Ok(checkpoint) => io
                                        .send(&json!({
                                            "type": "capability.progress.recorded",
                                            "protocolVersion": RUN_PROTOCOL_VERSION,
                                            "requestId": request_id,
                                            "callId": call.id,
                                            "checkpoint": checkpoint,
                                        }))
                                        .map_err(RuntimeSignal::Failed)?,
                                    Err(message) => io
                                        .send(&json!({
                                            "type": "capability.progress.rejected",
                                            "protocolVersion": RUN_PROTOCOL_VERSION,
                                            "requestId": request_id,
                                            "callId": call_id,
                                            "message": message,
                                        }))
                                        .map_err(RuntimeSignal::Failed)?,
                                }
                            }
                            incoming => break incoming,
                        }
                    }
                };
                let completion = serde_json::to_value(&incoming).map_err(|error| {
                    RuntimeSignal::Failed(format!("Cannot encode capability completion: {error}"))
                })?;
                self.ledger
                    .borrow_mut()
                    .record_interaction_completion(
                        &interaction_id,
                        RunInteractionKind::Capability,
                        completion,
                    )
                    .map_err(RuntimeSignal::Failed)?;
                incoming
            }
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
            HostMessage::CapabilityProgress { .. } => Err(RuntimeSignal::Failed(
                "Received capability.progress outside its progress loop.".to_owned(),
            )),
            HostMessage::PlannerTurn { .. } => Err(RuntimeSignal::Failed(
                "Received planner.turn while awaiting capability.result.".to_owned(),
            )),
            HostMessage::ApprovalFacts { .. } => Err(RuntimeSignal::Failed(
                "Received approval.facts while awaiting capability.result.".to_owned(),
            )),
            HostMessage::RuntimeError { message, .. } => Err(RuntimeSignal::Failed(message)),
            HostMessage::ResumeAccepted { .. } => Err(RuntimeSignal::Failed(
                "Received run.resume.accepted while awaiting capability.result.".to_owned(),
            )),
        }
    }
}

struct BridgePolicy {
    io: Rc<RefCell<BridgeIo>>,
    ledger: Rc<RefCell<RunLedger>>,
    replay: Rc<RefCell<ReplayCursor>>,
}

impl ApprovalPolicy for BridgePolicy {
    fn decide(
        &mut self,
        call: &CapabilityCall,
        context: &CapabilityContext,
    ) -> Result<ApprovalDecision, RuntimeSignal> {
        let interaction_id = format!("approval:{}", call.id);
        let intent_payload = json!({ "call": call, "context": context });
        let incoming = match self.replay.borrow_mut().resolve(
            &interaction_id,
            RunInteractionKind::Approval,
            InteractionReplaySafety::NeverRetry,
            &intent_payload,
        )? {
            ReplayDecision::Recorded(incoming) => *incoming,
            ReplayDecision::LiveNew => {
                self.ledger
                    .borrow_mut()
                    .record_interaction_intent(
                        &interaction_id,
                        RunInteractionKind::Approval,
                        InteractionReplaySafety::NeverRetry,
                        intent_payload,
                    )
                    .map_err(RuntimeSignal::Failed)?;
                let incoming = {
                    let mut io = self.io.borrow_mut();
                    let request_id = io.request_id.clone();
                    io.send(&json!({
                        "type": "approval.facts.request",
                        "protocolVersion": RUN_PROTOCOL_VERSION,
                        "requestId": request_id,
                        "call": call,
                        "context": context,
                    }))
                    .map_err(RuntimeSignal::Failed)?;
                    io.receive().map_err(RuntimeSignal::Failed)?
                };
                let completion = serde_json::to_value(&incoming).map_err(|error| {
                    RuntimeSignal::Failed(format!("Cannot encode approval completion: {error}"))
                })?;
                self.ledger
                    .borrow_mut()
                    .record_interaction_completion(
                        &interaction_id,
                        RunInteractionKind::Approval,
                        completion,
                    )
                    .map_err(RuntimeSignal::Failed)?;
                incoming
            }
            ReplayDecision::LiveRetry => {
                return Err(RuntimeSignal::Failed(
                    "Approval interactions cannot be retried during continuation.".to_owned(),
                ));
            }
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
            HostMessage::CapabilityProgress { .. } => Err(RuntimeSignal::Failed(
                "Received capability.progress while awaiting approval.facts.".to_owned(),
            )),
            HostMessage::PlannerTurn { .. } => Err(RuntimeSignal::Failed(
                "Received planner.turn while awaiting approval.facts.".to_owned(),
            )),
            HostMessage::CapabilityResult { .. } => Err(RuntimeSignal::Failed(
                "Received capability.result while awaiting approval.facts.".to_owned(),
            )),
            HostMessage::RuntimeError { message, .. } => Err(RuntimeSignal::Failed(message)),
            HostMessage::ResumeAccepted { .. } => Err(RuntimeSignal::Failed(
                "Received run.resume.accepted while awaiting approval.facts.".to_owned(),
            )),
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
    ledger: Rc<RefCell<RunLedger>>,
    durable_prefix: Vec<RunEvent>,
    reproduced_prefix: usize,
    failure: Option<String>,
}

impl BridgeEventSink {
    fn validate_replay(&self) -> Result<(), String> {
        if let Some(failure) = &self.failure {
            return Err(failure.clone());
        }
        if self.reproduced_prefix != self.durable_prefix.len() {
            return Err(format!(
                "Continuation reproduced {} of {} durable events.",
                self.reproduced_prefix,
                self.durable_prefix.len()
            ));
        }
        Ok(())
    }
}

impl forge_core::runtime::EventSink for BridgeEventSink {
    fn on_event(&mut self, event: &RunEvent) {
        if self.failure.is_some() {
            return;
        }
        if let Some(expected) = self.durable_prefix.get(self.reproduced_prefix) {
            if expected != event {
                self.failure = Some(format!(
                    "Continuation event {} does not match the durable prefix.",
                    event.sequence
                ));
                return;
            }
            self.reproduced_prefix = self.reproduced_prefix.saturating_add(1);
            return;
        }
        if let Err(error) = self.ledger.borrow_mut().append_event(event) {
            self.failure = Some(error);
            return;
        }
        let mut io = self.io.borrow_mut();
        let request_id = io.request_id.clone();
        if let Err(error) = io.send(&json!({
            "type": "run.event",
            "protocolVersion": RUN_PROTOCOL_VERSION,
            "requestId": request_id,
            "event": event,
        })) {
            self.failure = Some(error);
        }
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

fn parse_run_resume(frame: &[u8]) -> Result<RunResume, String> {
    let start: RunResume = serde_json::from_slice(frame)
        .map_err(|error| format!("Invalid run.resume JSON: {error}"))?;
    if start.message_type != "run.resume" {
        return Err(format!(
            "Expected run.resume, received {}.",
            start.message_type
        ));
    }
    if start.protocol_version != RUN_PROTOCOL_VERSION {
        return Err(format!(
            "Unsupported bridge protocol: {}",
            start.protocol_version
        ));
    }
    if start.request_id.trim().is_empty() || start.run_id.trim().is_empty() {
        return Err("Bridge requestId and runId must not be empty.".to_owned());
    }
    Ok(start)
}

fn execute_canonical_runtime(
    request: RunRequest,
    capability_descriptors: Vec<CapabilityDescriptor>,
    ledger: Rc<RefCell<RunLedger>>,
    io: Rc<RefCell<BridgeIo>>,
    replay: ReplayCursor,
    cancellation: InitialCancellation,
    durable_prefix: Vec<RunEvent>,
) -> Result<(), String> {
    let replay = Rc::new(RefCell::new(replay));
    let mut planner = BridgePlanner {
        io: Rc::clone(&io),
        ledger: Rc::clone(&ledger),
        replay: Rc::clone(&replay),
    };
    let mut capabilities = BridgeCapabilities {
        io: Rc::clone(&io),
        ledger: Rc::clone(&ledger),
        replay: Rc::clone(&replay),
        supported: capability_descriptors
            .into_iter()
            .map(|descriptor| (descriptor.id, descriptor.replay_safety))
            .collect(),
    };
    let mut policy = BridgePolicy {
        io: Rc::clone(&io),
        ledger: Rc::clone(&ledger),
        replay: Rc::clone(&replay),
    };
    let mut sink = BridgeEventSink {
        io: Rc::clone(&io),
        ledger: Rc::clone(&ledger),
        durable_prefix,
        reproduced_prefix: 0,
        failure: None,
    };
    let artifact = Slice0Runtime {
        planner: &mut planner,
        approval_policy: &mut policy,
        capabilities: &mut capabilities,
        cancellation: &cancellation,
        event_sink: &mut sink,
    }
    .run(request);

    replay.borrow().ensure_consumed()?;
    sink.validate_replay()?;
    ledger.borrow_mut().seal(&artifact)?;
    send_terminal(&io, &artifact)
}

fn execute_run(
    start: RunStart,
    reader: BufReader<io::Stdin>,
    writer: BufWriter<io::Stdout>,
) -> Result<(), String> {
    let request = start.request;
    let _execution_lock = RunExecutionLock::acquire(&start.run_store_root, &request.run_id)?;
    let cancellation = InitialCancellation(start.initial_cancellation_reason);
    let capability_descriptors = start.capabilities;
    let ledger = Rc::new(RefCell::new(RunLedger::create(
        &start.run_store_root,
        RUN_PROTOCOL_VERSION,
        &request,
        &capability_descriptors,
    )?));
    let io = Rc::new(RefCell::new(BridgeIo {
        reader,
        writer,
        request_id: start.request_id,
    }));
    execute_canonical_runtime(
        request,
        capability_descriptors,
        ledger,
        io,
        ReplayCursor::fresh(),
        cancellation,
        Vec::new(),
    )
}

fn accept_resume_checkpoint(
    io: &Rc<RefCell<BridgeIo>>,
    request: &RunRequest,
    durable_event_count: usize,
    planner_checkpoint: Option<Value>,
    recovered_temporary_artifact: bool,
) -> Result<(), String> {
    let mut ready = json!({
        "type": "run.resume.ready",
        "protocolVersion": RUN_PROTOCOL_VERSION,
        "request": request,
        "durableEventCount": durable_event_count,
        "recoveredTemporaryArtifact": recovered_temporary_artifact,
    });
    let mut bridge = io.borrow_mut();
    let request_id = bridge.request_id.clone();
    ready
        .as_object_mut()
        .expect("resume handshake is an object")
        .insert("requestId".to_owned(), Value::String(request_id));
    if let Some(checkpoint) = planner_checkpoint {
        ready
            .as_object_mut()
            .expect("resume handshake is an object")
            .insert("plannerCheckpoint".to_owned(), checkpoint);
    }
    bridge.send(&ready)?;
    match bridge.receive()? {
        HostMessage::ResumeAccepted { .. } => Ok(()),
        _ => Err("Host did not accept the validated resume checkpoint.".to_owned()),
    }
}

fn execute_resume(
    mut start: RunResume,
    reader: BufReader<io::Stdin>,
    writer: BufWriter<io::Stdout>,
) -> Result<(), String> {
    let _execution_lock = RunExecutionLock::acquire(&start.run_store_root, &start.run_id)?;
    let opened =
        RunLedger::open_for_resume(&start.run_store_root, &start.run_id, RUN_PROTOCOL_VERSION)?;
    let io = Rc::new(RefCell::new(BridgeIo {
        reader,
        writer,
        request_id: start.request_id,
    }));
    match opened {
        RunResumeOpen::Terminal {
            request,
            artifact,
            recovered_temporary_artifact,
        } => {
            accept_resume_checkpoint(
                &io,
                &request,
                artifact.events.len(),
                None,
                recovered_temporary_artifact,
            )?;
            send_terminal(&io, &artifact)
        }
        RunResumeOpen::Continue { ledger, replay } => {
            start
                .capabilities
                .sort_by(|left, right| left.id.cmp(&right.id));
            if start
                .capabilities
                .windows(2)
                .any(|pair| pair[0].id == pair[1].id)
                || start.capabilities != replay.inspection.capability_descriptors
            {
                return Err(
                    "Resume capability descriptors do not match the durable run manifest."
                        .to_owned(),
                );
            }
            match replay.inspection.disposition {
                RunContinuationDisposition::SafeBoundary => {}
                RunContinuationDisposition::RetryableCapability
                    if start.allow_retryable_capability_retry => {}
                RunContinuationDisposition::RetryableCapability => {
                    return Err(
                        "The unresolved read-only capability requires an explicit retry authorization."
                            .to_owned(),
                    );
                }
                _ => return Err(replay.inspection.reason.clone()),
            }
            let request = ledger.request().clone();
            let durable_prefix = ledger.durable_events().to_vec();
            accept_resume_checkpoint(
                &io,
                &request,
                durable_prefix.len(),
                replay.planner_checkpoint,
                false,
            )?;
            execute_canonical_runtime(
                request,
                start.capabilities,
                Rc::new(RefCell::new(ledger)),
                io,
                ReplayCursor::resumed(replay.interactions, start.allow_retryable_capability_retry),
                InitialCancellation(start.initial_cancellation_reason),
                durable_prefix,
            )
        }
    }
}
fn isolation_provider_probe(status: IsolationProviderStatus) -> Value {
    let restricted_ready = isolation_provider_restricted_ready(&status);
    json!({
        "providerId": status.capabilities.provider_id,
        "providerClass": status.provider_class,
        "availability": status.availability,
        "supportedProfiles": status.capabilities.supported_profiles,
        "restrictedControls": status.capabilities.restricted_controls,
        "restrictedReady": restricted_ready,
        "limitations": status.limitations,
    })
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

    if discriminator.message_type == "probe.start"
        && discriminator.protocol_version == PROBE_PROTOCOL_VERSION
    {
        let isolation = BaselineIsolationProvider::default().status();
        #[cfg(windows)]
        let isolation_candidates = vec![
            isolation_provider_probe(WindowsManagedIsolationProvider::preview_status()),
            isolation_provider_probe(WindowsAppContainerIsolationProvider::preview_status()),
        ];
        #[cfg(not(windows))]
        let isolation_candidates: Vec<Value> = Vec::new();
        if send_json(
            &mut writer,
            &json!({
                "type": "probe.result",
                "protocolVersion": PROBE_PROTOCOL_VERSION,
                "kernelVersion": env!("CARGO_PKG_VERSION"),
                "runProtocolVersion": RUN_PROTOCOL_VERSION,
                "runStoreProtocolVersion": RUN_STORE_PROTOCOL_VERSION,
                "transactionProtocolVersion": protocol::TRANSACTION_PROTOCOL_VERSION,
                "candidateProtocolVersion": protocol::CANDIDATE_PROTOCOL_VERSION,
                "sovereignChangeProtocolVersion": protocol::SOVEREIGN_CHANGE_PROTOCOL_VERSION,
                "isolationProvider": isolation_provider_probe(isolation),
                "isolationCandidates": isolation_candidates,
            }),
        )
        .is_err()
        {
            std::process::exit(3);
        }
        return;
    }

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

    if discriminator.message_type == "run.resume"
        && discriminator.protocol_version == RUN_PROTOCOL_VERSION
    {
        let start = match parse_run_resume(&frame) {
            Ok(start) => start,
            Err(message) => {
                send_protocol_error(
                    &mut writer,
                    RUN_PROTOCOL_VERSION,
                    None,
                    "invalid_run_resume",
                    &message,
                );
                std::process::exit(2);
            }
        };
        if let Err(message) = execute_resume(start, reader, writer) {
            eprintln!("forge-kernel failed to resume run: {message}");
            std::process::exit(3);
        }
        return;
    }

    if discriminator.message_type == "run_store.inspect"
        && discriminator.protocol_version == RUN_STORE_PROTOCOL_VERSION
    {
        if let Err(failure) = run_store_bridge::execute(&frame, &mut writer) {
            send_protocol_error(
                &mut writer,
                RUN_STORE_PROTOCOL_VERSION,
                failure.request_id.as_deref(),
                failure.code,
                &failure.message,
            );
            std::process::exit(2);
        }
        return;
    }

    if discriminator.message_type == "change.start"
        && discriminator.protocol_version == protocol::SOVEREIGN_CHANGE_PROTOCOL_VERSION
    {
        if let Err(failure) = sovereign_change_bridge::execute(&frame, reader, &mut writer) {
            send_protocol_error(
                &mut writer,
                protocol::SOVEREIGN_CHANGE_PROTOCOL_VERSION,
                failure.request_id.as_deref(),
                failure.code,
                &failure.message,
            );
            std::process::exit(2);
        }
        return;
    }
    if discriminator.message_type == "transaction.start"
        && discriminator.protocol_version == protocol::TRANSACTION_PROTOCOL_VERSION
    {
        let shared_writer = Arc::new(Mutex::new(writer));
        if let Err(failure) =
            transaction_bridge::execute(&frame, reader, Arc::clone(&shared_writer))
        {
            if let Ok(mut writer) = shared_writer.lock() {
                send_protocol_error(
                    &mut *writer,
                    protocol::TRANSACTION_PROTOCOL_VERSION,
                    failure.request_id.as_deref(),
                    failure.code,
                    &failure.message,
                );
            }
            std::process::exit(2);
        }
        return;
    }

    if discriminator.message_type == "candidate.start"
        && discriminator.protocol_version == protocol::CANDIDATE_PROTOCOL_VERSION
    {
        if let Err(failure) = candidate_bridge::execute(&frame, &mut writer) {
            send_protocol_error(
                &mut writer,
                protocol::CANDIDATE_PROTOCOL_VERSION,
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
#[cfg(test)]
mod replay_tests {
    use super::*;

    #[test]
    fn consumes_recorded_capability_completion_without_live_dispatch() {
        let intent_payload = json!({
            "call": {
                "id": "call:1",
                "capabilityId": "workspace.read",
                "input": { "path": "src/lib.rs" }
            }
        });
        let completion_payload = json!({
            "type": "capability.result",
            "protocolVersion": RUN_PROTOCOL_VERSION,
            "requestId": "bridge:test",
            "result": {
                "callId": "call:1",
                "success": true,
                "content": "recorded evidence"
            }
        });
        let mut replay = ReplayCursor::resumed(
            vec![RecordedRunInteraction {
                interaction_id: "capability:call:1".to_owned(),
                kind: RunInteractionKind::Capability,
                replay_safety: InteractionReplaySafety::ReadOnlyRetryable,
                intent_payload: intent_payload.clone(),
                recovery_checkpoint: None,
                completion_payload: Some(completion_payload),
            }],
            false,
        );

        let decision = replay
            .resolve(
                "capability:call:1",
                RunInteractionKind::Capability,
                InteractionReplaySafety::ReadOnlyRetryable,
                &intent_payload,
            )
            .expect("recorded completion should resolve");

        match decision {
            ReplayDecision::Recorded(incoming) => match *incoming {
                HostMessage::CapabilityResult { result, .. } => {
                    assert_eq!(result.call_id, "call:1");
                    assert_eq!(result.content, "recorded evidence");
                }
                other => panic!("expected recorded capability result, got {other:?}"),
            },
            ReplayDecision::LiveNew | ReplayDecision::LiveRetry => {
                panic!("recorded completion must not request live host work")
            }
        }
        replay
            .ensure_consumed()
            .expect("the recorded completion should be consumed exactly once");
    }

    #[test]
    fn rejects_reordered_recorded_interaction_before_host_dispatch() {
        let recorded_intent = json!({ "request": { "turn": 1 } });
        let actual_intent = json!({ "request": { "turn": 2 } });
        let mut replay = ReplayCursor::resumed(
            vec![RecordedRunInteraction {
                interaction_id: "planner:1".to_owned(),
                kind: RunInteractionKind::Planner,
                replay_safety: InteractionReplaySafety::NeverRetry,
                intent_payload: recorded_intent,
                recovery_checkpoint: None,
                completion_payload: None,
            }],
            false,
        );

        let failure = match replay.resolve(
            "planner:2",
            RunInteractionKind::Planner,
            InteractionReplaySafety::NeverRetry,
            &actual_intent,
        ) {
            Err(failure) => failure,
            Ok(_) => panic!("reordered continuation must fail closed"),
        };

        assert!(matches!(
            failure,
            RuntimeSignal::Failed(message) if message.contains("diverged at interaction 1")
        ));
    }
}
