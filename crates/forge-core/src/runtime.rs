use crate::context::{compile_context, required_context_bytes};
use crate::contracts::{
    ApprovalDecision, ApprovalOutcome, CapabilityCall, CapabilityResult, ContextItemKind,
    ContextPlan, PlannerRequest, PlannerTurn, RunArtifact, RunEvent, RunEventData, RunRequest,
    RunStatus, WorkspaceSnapshot,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RuntimeSignal {
    Failed(String),
    Cancelled(String),
}

pub trait TaskPlanner {
    fn next(&mut self, request: PlannerRequest) -> Result<PlannerTurn, RuntimeSignal>;
}

pub trait CapabilityAdapter {
    fn supports(&self, capability_id: &str) -> bool;

    fn invoke(
        &mut self,
        call: &CapabilityCall,
        snapshot: &WorkspaceSnapshot,
    ) -> Result<CapabilityResult, RuntimeSignal>;
}

pub trait ApprovalPolicy {
    fn decide(&mut self, call: &CapabilityCall) -> Result<ApprovalDecision, RuntimeSignal>;
}

pub trait Cancellation {
    fn reason(&self) -> Option<String>;
}

pub trait EventSink {
    fn on_event(&mut self, event: &RunEvent);
}

pub struct NoCancellation;

impl Cancellation for NoCancellation {
    fn reason(&self) -> Option<String> {
        None
    }
}

pub struct NoopEventSink;

impl EventSink for NoopEventSink {
    fn on_event(&mut self, _event: &RunEvent) {}
}

pub struct Slice0Runtime<'a> {
    pub planner: &'a mut dyn TaskPlanner,
    pub approval_policy: &'a mut dyn ApprovalPolicy,
    pub capabilities: &'a mut dyn CapabilityAdapter,
    pub cancellation: &'a dyn Cancellation,
    pub event_sink: &'a mut dyn EventSink,
}

struct RunState {
    request: RunRequest,
    status: RunStatus,
    context_plan: Option<ContextPlan>,
    capability_results: Vec<CapabilityResult>,
    output: Option<String>,
    events: Vec<RunEvent>,
    sequence: u64,
}

impl RunState {
    fn new(request: RunRequest) -> Self {
        Self {
            request,
            status: RunStatus::Running,
            context_plan: None,
            capability_results: Vec::new(),
            output: None,
            events: Vec::new(),
            sequence: 0,
        }
    }

    fn emit(&mut self, data: RunEventData, sink: &mut dyn EventSink) {
        self.sequence += 1;
        let event = RunEvent {
            run_id: self.request.run_id.clone(),
            sequence: self.sequence,
            data,
        };
        self.events.push(event.clone());
        sink.on_event(&event);
    }

    fn artifact(&self) -> RunArtifact {
        RunArtifact {
            schema_version: 1,
            run_id: self.request.run_id.clone(),
            task: self.request.task.clone(),
            snapshot: self.request.snapshot.clone(),
            status: self.status.clone(),
            context_plan: self.context_plan.clone(),
            capability_results: self.capability_results.clone(),
            output: self.output.clone(),
            events: self.events.clone(),
        }
    }
}

impl Slice0Runtime<'_> {
    pub fn run(&mut self, request: RunRequest) -> RunArtifact {
        let mut state = RunState::new(request);
        if let Some(reason) = self.cancellation.reason() {
            return self.cancel(&mut state, reason);
        }

        state.emit(
            RunEventData::RunStarted {
                task: state.request.task.clone(),
                snapshot_id: state.request.snapshot.id.clone(),
            },
            self.event_sink,
        );

        let context_plan = match compile_context(
            &state.request.task,
            &state.request.snapshot,
            state.request.context_budget_bytes,
        ) {
            Ok(plan) => plan,
            Err(message) => return self.fail(&mut state, "runtime_error", message),
        };
        state.context_plan = Some(context_plan.clone());
        state.emit(
            RunEventData::ContextPlanned {
                plan: context_plan.clone(),
            },
            self.event_sink,
        );

        if !context_plan
            .selected
            .iter()
            .any(|item| item.kind == ContextItemKind::UserTask)
        {
            state.status = RunStatus::BudgetExhausted;
            state.emit(
                RunEventData::RunBudgetExhausted {
                    plan: context_plan,
                    required_bytes: required_context_bytes(
                        &state.request.task,
                        &state.request.snapshot,
                    ),
                },
                self.event_sink,
            );
            return state.artifact();
        }

        for turn in 1..=state.request.max_turns {
            if let Some(reason) = self.cancellation.reason() {
                return self.cancel(&mut state, reason);
            }
            let planner_request = PlannerRequest {
                task: state.request.task.clone(),
                context_plan: context_plan.clone(),
                capability_results: state.capability_results.clone(),
                turn,
            };
            let next = match self.planner.next(planner_request) {
                Ok(next) => next,
                Err(RuntimeSignal::Cancelled(reason)) => return self.cancel(&mut state, reason),
                Err(RuntimeSignal::Failed(message)) => {
                    return self.fail(&mut state, "runtime_error", message);
                }
            };
            if let Some(reason) = self.cancellation.reason() {
                return self.cancel(&mut state, reason);
            }
            match next {
                PlannerTurn::Complete { output } => {
                    state.output = Some(output.clone());
                    state.status = RunStatus::Completed;
                    state.emit(RunEventData::RunCompleted { output }, self.event_sink);
                    return state.artifact();
                }
                PlannerTurn::Call { call } => {
                    if let Some(artifact) = self.execute(&mut state, call) {
                        return artifact;
                    }
                }
            }
        }

        let max_turns = state.request.max_turns;
        self.fail(
            &mut state,
            "turn_limit",
            format!("Run exceeded its {max_turns}-turn limit."),
        )
    }

    fn execute(&mut self, state: &mut RunState, call: CapabilityCall) -> Option<RunArtifact> {
        state.emit(
            RunEventData::CapabilityRequested { call: call.clone() },
            self.event_sink,
        );
        let decision = match self.approval_policy.decide(&call) {
            Ok(decision) => decision,
            Err(RuntimeSignal::Cancelled(reason)) => return Some(self.cancel(state, reason)),
            Err(RuntimeSignal::Failed(message)) => {
                return Some(self.fail(state, "runtime_error", message));
            }
        };
        state.emit(
            RunEventData::ApprovalDecided {
                call_id: call.id.clone(),
                outcome: decision.outcome.clone(),
                reason: decision.reason.clone(),
            },
            self.event_sink,
        );

        if decision.outcome != ApprovalOutcome::Allow {
            let outcome = match decision.outcome {
                ApprovalOutcome::Allow => "allow",
                ApprovalOutcome::Ask => "ask",
                ApprovalOutcome::Deny => "deny",
            };
            let result = CapabilityResult {
                call_id: call.id,
                success: false,
                content: format!("{outcome}: {}", decision.reason),
            };
            state.capability_results.push(result.clone());
            state.emit(
                RunEventData::CapabilityCompleted { result },
                self.event_sink,
            );
            return None;
        }

        let result = if !self.capabilities.supports(&call.capability_id) {
            CapabilityResult {
                call_id: call.id.clone(),
                success: false,
                content: format!("Unknown capability: {}", call.capability_id),
            }
        } else {
            match self.capabilities.invoke(&call, &state.request.snapshot) {
                Ok(result) => result,
                Err(RuntimeSignal::Cancelled(reason)) => return Some(self.cancel(state, reason)),
                Err(RuntimeSignal::Failed(message)) => CapabilityResult {
                    call_id: call.id.clone(),
                    success: false,
                    content: message,
                },
            }
        };
        state.capability_results.push(result.clone());
        state.emit(
            RunEventData::CapabilityCompleted { result },
            self.event_sink,
        );
        None
    }

    fn cancel(&mut self, state: &mut RunState, reason: String) -> RunArtifact {
        state.status = RunStatus::Cancelled;
        state.emit(RunEventData::RunCancelled { reason }, self.event_sink);
        state.artifact()
    }

    fn fail(&mut self, state: &mut RunState, code: &str, message: String) -> RunArtifact {
        state.status = RunStatus::Failed;
        state.emit(
            RunEventData::RunFailed {
                code: code.to_owned(),
                message,
            },
            self.event_sink,
        );
        state.artifact()
    }
}
