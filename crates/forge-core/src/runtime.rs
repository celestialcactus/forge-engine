use crate::context::{compile_context, required_context_bytes};
use crate::contracts::{
    ApprovalDecision, ApprovalFacts, ApprovalOutcome, CapabilityCall, CapabilityResult,
    ContextItemKind, ContextPlan, HostPolicyPosture, InferenceCostStatus, InferenceEvidence,
    InferenceFinishReason, InferenceLocality, OutcomeAssessment, OutcomeCheck, OutcomeContract,
    OutcomeRequirement, OutcomeRequirementKind, OutcomeStatus, PlannerRequest, PlannerTurn,
    RunArtifact, RunEvent, RunEventData, RunRequest, RunStatus, UserConsentStatus,
    WorkspaceSnapshot,
};

fn valid_usd_amount(amount: &str) -> bool {
    let mut parts = amount.split('.');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next();
    !whole.is_empty()
        && whole.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.is_none_or(|value| {
            !value.is_empty()
                && value.len() <= 12
                && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        && parts.next().is_none()
}

fn inference_validation_error(turn: &PlannerTurn) -> Option<String> {
    let evidence = match turn {
        PlannerTurn::Complete { inference, .. } | PlannerTurn::Call { inference, .. } => {
            inference.as_ref()?
        }
    };
    if evidence.schema_version != 1 {
        return Some("Inference evidence schemaVersion must be 1.".to_owned());
    }
    for (label, value, maximum) in [
        ("requestId", evidence.request_id.as_str(), 512),
        ("provider", evidence.provider.as_str(), 100),
        ("model", evidence.model.as_str(), 200),
    ] {
        let length = value.chars().count();
        if length == 0 || length > maximum {
            return Some(format!("Inference evidence {label} has an invalid length."));
        }
    }
    if evidence.duration_ms > 86_400_000 {
        return Some("Inference evidence durationMs is outside the supported range.".to_owned());
    }
    if evidence.output_characters > 65_536 {
        return Some(
            "Inference evidence outputCharacters is outside the supported range.".to_owned(),
        );
    }
    if evidence.tool_call_count > 1 {
        return Some("Inference evidence toolCallCount must be zero or one.".to_owned());
    }
    for (label, value) in [
        ("inputTokens", evidence.usage.input_tokens),
        ("outputTokens", evidence.usage.output_tokens),
    ] {
        if value.is_some_and(|tokens| tokens > 1_000_000_000_000) {
            return Some(format!(
                "Inference evidence {label} is outside the supported range."
            ));
        }
    }
    let routing = &evidence.routing;
    if routing.fallback_used
        || routing.requested_provider != routing.selected_provider
        || routing.selected_provider != evidence.provider
        || routing.requested_model != routing.selected_model
        || routing.selected_model != evidence.model
    {
        return Some(
            "Inference evidence routing does not prove an explicit no-fallback route.".to_owned(),
        );
    }
    if evidence.locality == InferenceLocality::Local
        && evidence.cost.status != InferenceCostStatus::NotApplicable
    {
        return Some("Local inference cost status must be not_applicable.".to_owned());
    }
    if evidence.locality == InferenceLocality::Cloud
        && evidence.cost.status == InferenceCostStatus::NotApplicable
    {
        return Some("Cloud inference cost status must not be not_applicable.".to_owned());
    }
    if let Some(amount) = &evidence.cost.amount_usd {
        if evidence.cost.status != InferenceCostStatus::Reported
            && evidence.cost.status != InferenceCostStatus::Estimated
        {
            return Some("Inference cost amount requires reported or estimated status.".to_owned());
        }
        if !valid_usd_amount(amount) {
            return Some(
                "Inference cost amountUsd must be a non-negative decimal string.".to_owned(),
            );
        }
    }
    match turn {
        PlannerTurn::Call { .. }
            if evidence.finish_reason != InferenceFinishReason::ToolCall
                || evidence.tool_call_count != 1 =>
        {
            Some("Capability planner turns require one tool_call inference completion.".to_owned())
        }
        PlannerTurn::Complete { output, .. }
            if evidence.finish_reason != InferenceFinishReason::Stop
                || evidence.tool_call_count != 0
                || evidence.output_characters != output.chars().count() as u64 =>
        {
            Some(
                "Completed planner turns require matching stopped text inference evidence."
                    .to_owned(),
            )
        }
        _ => None,
    }
}

fn not_evaluated_outcome(reason: &str) -> OutcomeAssessment {
    OutcomeAssessment {
        schema_version: 1,
        status: OutcomeStatus::NotEvaluated,
        reason: reason.to_owned(),
        checks: Vec::new(),
    }
}

fn outcome_contract_error(contract: &OutcomeContract) -> Option<String> {
    if contract.schema_version != 1 {
        return Some("Outcome contract schemaVersion must be 1.".to_owned());
    }
    if contract.requirements.is_empty() || contract.requirements.len() > 32 {
        return Some("Outcome contract must contain between 1 and 32 requirements.".to_owned());
    }
    let mut ids = std::collections::HashSet::new();
    for requirement in &contract.requirements {
        let (id, field_error) = match requirement {
            OutcomeRequirement::OutputNonEmpty { id } => (id, None),
            OutcomeRequirement::OutputEquals { id, expected } => (
                id,
                (expected.chars().count() > 65_536)
                    .then_some("Outcome expected output exceeds 65536 characters."),
            ),
            OutcomeRequirement::CapabilitySucceeded {
                id,
                capability_id,
                minimum_invocations,
            } => (
                id,
                if capability_id.trim().is_empty() || capability_id.chars().count() > 200 {
                    Some("Outcome capabilityId has an invalid length.")
                } else if !(1..=64).contains(minimum_invocations) {
                    Some("Outcome minimumInvocations must be between 1 and 64.")
                } else {
                    None
                },
            ),
        };
        if let Some(message) = field_error {
            return Some(message.to_owned());
        }
        if id.trim().is_empty() || id.chars().count() > 100 {
            return Some("Outcome requirement id has an invalid length.".to_owned());
        }
        if !ids.insert(id) {
            return Some(format!("Outcome requirement id is duplicated: {id}."));
        }
    }
    None
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CapabilityAttempt {
    capability_id: String,
    success: bool,
}

fn assess_outcome(
    contract: Option<&OutcomeContract>,
    output: &str,
    attempts: &[CapabilityAttempt],
) -> OutcomeAssessment {
    let Some(contract) = contract else {
        return not_evaluated_outcome(
            "No caller-authored outcome contract was supplied; completed denotes only a valid terminal planner turn.",
        );
    };
    let checks = contract
        .requirements
        .iter()
        .map(|requirement| match requirement {
            OutcomeRequirement::OutputNonEmpty { id } => {
                let characters = output.chars().count();
                let satisfied = !output.trim().is_empty();
                OutcomeCheck {
                    id: id.clone(),
                    kind: OutcomeRequirementKind::OutputNonEmpty,
                    satisfied,
                    explanation: format!(
                        "Planner output contained {characters} characters and {} non-whitespace content.",
                        if satisfied { "included" } else { "did not include" }
                    ),
                }
            }
            OutcomeRequirement::OutputEquals { id, expected } => {
                let satisfied = output == expected;
                OutcomeCheck {
                    id: id.clone(),
                    kind: OutcomeRequirementKind::OutputEquals,
                    satisfied,
                    explanation: if satisfied {
                        "Planner output matched the caller-authored expected value.".to_owned()
                    } else {
                        "Planner output did not match the caller-authored expected value.".to_owned()
                    },
                }
            }
            OutcomeRequirement::CapabilitySucceeded {
                id,
                capability_id,
                minimum_invocations,
            } => {
                let successful = attempts
                    .iter()
                    .filter(|attempt| {
                        attempt.capability_id == *capability_id && attempt.success
                    })
                    .count();
                let satisfied = successful >= *minimum_invocations as usize;
                OutcomeCheck {
                    id: id.clone(),
                    kind: OutcomeRequirementKind::CapabilitySucceeded,
                    satisfied,
                    explanation: format!(
                        "Observed {successful} successful {capability_id} invocation(s); required at least {minimum_invocations}."
                    ),
                }
            }
        })
        .collect::<Vec<_>>();
    let verified = checks.iter().all(|check| check.satisfied);
    OutcomeAssessment {
        schema_version: 1,
        status: if verified {
            OutcomeStatus::Verified
        } else {
            OutcomeStatus::Unmet
        },
        reason: if verified {
            "All caller-authored outcome requirements were satisfied.".to_owned()
        } else {
            "One or more caller-authored outcome requirements were not satisfied.".to_owned()
        },
        checks,
    }
}

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

pub fn resolve_approval(facts: &ApprovalFacts) -> Result<ApprovalDecision, String> {
    if facts.schema_version != 1 {
        return Err(format!(
            "Unsupported approval facts schema version: {}.",
            facts.schema_version
        ));
    }
    for (label, value) in [
        ("callId", facts.call_id.as_str()),
        ("capabilityId", facts.capability_id.as_str()),
        ("hostPolicy.source", facts.host_policy.source.as_str()),
        ("hostPolicy.reason", facts.host_policy.reason.as_str()),
        ("userConsent.source", facts.user_consent.source.as_str()),
        ("userConsent.reason", facts.user_consent.reason.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("Approval facts field {label} must not be empty."));
        }
    }

    if facts.host_policy.posture == HostPolicyPosture::Deny {
        return Ok(ApprovalDecision {
            outcome: ApprovalOutcome::Deny,
            reason: facts.host_policy.reason.clone(),
            facts: Some(facts.clone()),
        });
    }
    if facts.user_consent.status == UserConsentStatus::Declined {
        return Ok(ApprovalDecision {
            outcome: ApprovalOutcome::Deny,
            reason: facts.user_consent.reason.clone(),
            facts: Some(facts.clone()),
        });
    }

    match facts.host_policy.posture {
        HostPolicyPosture::Allow => Ok(ApprovalDecision {
            outcome: ApprovalOutcome::Allow,
            reason: facts.host_policy.reason.clone(),
            facts: Some(facts.clone()),
        }),
        HostPolicyPosture::Ask => match facts.user_consent.status {
            UserConsentStatus::Granted => Ok(ApprovalDecision {
                outcome: ApprovalOutcome::Allow,
                reason: facts.user_consent.reason.clone(),
                facts: Some(facts.clone()),
            }),
            UserConsentStatus::NotRequired | UserConsentStatus::Unavailable => {
                Ok(ApprovalDecision {
                    outcome: ApprovalOutcome::Ask,
                    reason: facts.host_policy.reason.clone(),
                    facts: Some(facts.clone()),
                })
            }
            UserConsentStatus::Declined => unreachable!("decline is resolved before host ask"),
        },
        HostPolicyPosture::Deny => unreachable!("host deny is resolved before consent"),
    }
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
    capability_attempts: Vec<CapabilityAttempt>,
    inference_evidence: Vec<InferenceEvidence>,
    outcome: OutcomeAssessment,
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
            capability_attempts: Vec::new(),
            inference_evidence: Vec::new(),
            outcome: not_evaluated_outcome(
                "Outcome assessment did not run because the runtime did not reach a terminal planner turn.",
            ),
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
            schema_version: 2,
            run_id: self.request.run_id.clone(),
            task: self.request.task.clone(),
            snapshot: self.request.snapshot.clone(),
            status: self.status.clone(),
            context_plan: self.context_plan.clone(),
            capability_results: self.capability_results.clone(),
            inference_evidence: if self.inference_evidence.is_empty() {
                None
            } else {
                Some(self.inference_evidence.clone())
            },
            outcome_contract: self.request.outcome_contract.clone(),
            outcome: self.outcome.clone(),
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

        if let Some(message) = state
            .request
            .outcome_contract
            .as_ref()
            .and_then(outcome_contract_error)
        {
            return self.fail(&mut state, "invalid_outcome_contract", message);
        }

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
            if let Some(message) = inference_validation_error(&next) {
                return self.fail(&mut state, "invalid_inference_evidence", message);
            }
            let inference = match &next {
                PlannerTurn::Complete { inference, .. } | PlannerTurn::Call { inference, .. } => {
                    inference.clone()
                }
            };
            if let Some(evidence) = inference {
                state.inference_evidence.push(evidence.clone());
                state.emit(
                    RunEventData::InferenceCompleted { evidence },
                    self.event_sink,
                );
            }
            match next {
                PlannerTurn::Complete { output, .. } => {
                    state.output = Some(output.clone());
                    state.outcome = assess_outcome(
                        state.request.outcome_contract.as_ref(),
                        &output,
                        &state.capability_attempts,
                    );
                    state.emit(
                        RunEventData::OutcomeAssessed {
                            assessment: state.outcome.clone(),
                        },
                        self.event_sink,
                    );
                    state.status = RunStatus::Completed;
                    state.emit(RunEventData::RunCompleted { output }, self.event_sink);
                    return state.artifact();
                }
                PlannerTurn::Call { call, .. } => {
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
                facts: decision.facts.clone(),
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
            state.capability_attempts.push(CapabilityAttempt {
                capability_id: call.capability_id,
                success: result.success,
            });
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
        let result = if result.call_id == call.id {
            result
        } else {
            CapabilityResult {
                call_id: call.id.clone(),
                success: false,
                content: format!(
                    "Capability result call ID {} does not match {}.",
                    result.call_id, call.id
                ),
            }
        };
        state.capability_attempts.push(CapabilityAttempt {
            capability_id: call.capability_id,
            success: result.success,
        });
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
