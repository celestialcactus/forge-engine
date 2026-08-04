use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;

use forge_core::{
    ApprovalDecision, ApprovalOutcome, ApprovalPolicy, Cancellation, CapabilityAdapter,
    CapabilityCall, CapabilityContext, CapabilityEvidence, CapabilityResult, InferenceCost,
    InferenceCostStatus, InferenceEvidence, InferenceFinishReason, InferenceLocality,
    InferenceRouting, InferenceUsage, NoCancellation, NoopEventSink, OutcomeContract,
    OutcomeRequirement, OutcomeStatus, PlannerRequest, PlannerTurn, RunRequest, RunStatus,
    RuntimeSignal, Slice0Runtime, TaskPlanner, WorkspaceFile, WorkspaceSnapshot,
};
use serde_json::json;

fn workspace() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        id: "workspace:fixture-1".to_owned(),
        root_label: "slice0-fixture".to_owned(),
        files: vec![
            WorkspaceFile {
                path: "src/greeting.ts".to_owned(),
                bytes: 28,
            },
            WorkspaceFile {
                path: "package.json".to_owned(),
                bytes: 42,
            },
            WorkspaceFile {
                path: "README.md".to_owned(),
                bytes: 19,
            },
        ],
    }
}

fn request(run_id: &str) -> RunRequest {
    RunRequest {
        run_id: run_id.to_owned(),
        task: "Inspect the workspace.".to_owned(),
        snapshot: workspace(),
        context_budget_bytes: 200,
        max_turns: 2,
        outcome_contract: None,
    }
}

fn inspect_call() -> CapabilityCall {
    CapabilityCall {
        id: "call-1".to_owned(),
        capability_id: "workspace.inventory".to_owned(),
        input: json!({}),
    }
}

fn outcome_contract(capability_id: &str) -> OutcomeContract {
    OutcomeContract {
        schema_version: 1,
        requirements: vec![
            OutcomeRequirement::CapabilitySucceeded {
                id: "required-capability".to_owned(),
                capability_id: capability_id.to_owned(),
                minimum_invocations: 1,
            },
            OutcomeRequirement::OutputEquals {
                id: "expected-output".to_owned(),
                expected: "Workspace inspected.".to_owned(),
            },
        ],
    }
}

struct ScriptedPlanner {
    turns: VecDeque<PlannerTurn>,
}

impl ScriptedPlanner {
    fn successful() -> Self {
        Self {
            turns: VecDeque::from([
                PlannerTurn::Call {
                    call: inspect_call(),
                    inference: None,
                },
                PlannerTurn::Complete {
                    output: "Workspace inspected.".to_owned(),
                    inference: None,
                },
            ]),
        }
    }
}

impl TaskPlanner for ScriptedPlanner {
    fn next(&mut self, _request: PlannerRequest) -> Result<PlannerTurn, RuntimeSignal> {
        self.turns.pop_front().ok_or_else(|| {
            RuntimeSignal::Failed("Fixture planner has no remaining turns.".to_owned())
        })
    }
}

struct FixedPolicy(ApprovalDecision);

impl ApprovalPolicy for FixedPolicy {
    fn decide(
        &mut self,
        _call: &CapabilityCall,
        _context: &CapabilityContext,
    ) -> Result<ApprovalDecision, RuntimeSignal> {
        Ok(self.0.clone())
    }
}

struct FixtureCapabilities {
    failures: HashMap<String, String>,
}

impl FixtureCapabilities {
    fn inventory() -> Self {
        Self {
            failures: HashMap::new(),
        }
    }
}

impl CapabilityAdapter for FixtureCapabilities {
    fn supports(&self, capability_id: &str) -> bool {
        capability_id == "workspace.inventory" || capability_id == "fixture.explodes"
    }

    fn invoke(
        &mut self,
        call: &CapabilityCall,
        snapshot: &WorkspaceSnapshot,
        _context: &CapabilityContext,
    ) -> Result<CapabilityResult, RuntimeSignal> {
        if let Some(message) = self.failures.get(&call.capability_id) {
            return Err(RuntimeSignal::Failed(message.clone()));
        }
        let mut paths: Vec<&str> = snapshot
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        paths.sort_unstable();
        Ok(CapabilityResult {
            call_id: call.id.clone(),
            success: true,
            content: serde_json::to_string(&json!({ "snapshotId": snapshot.id, "files": paths }))
                .expect("fixture evidence should serialize"),
            evidence: None,
        })
    }
}

struct MismatchedCapabilities;

impl CapabilityAdapter for MismatchedCapabilities {
    fn supports(&self, capability_id: &str) -> bool {
        capability_id == "workspace.inventory"
    }

    fn invoke(
        &mut self,
        _call: &CapabilityCall,
        _snapshot: &WorkspaceSnapshot,
        _context: &CapabilityContext,
    ) -> Result<CapabilityResult, RuntimeSignal> {
        Ok(CapabilityResult {
            call_id: "call-other".to_owned(),
            success: true,
            content: "Mismatched fixture result.".to_owned(),
            evidence: None,
        })
    }
}

struct ContextPolicy {
    contexts: Rc<RefCell<Vec<CapabilityContext>>>,
}

impl ApprovalPolicy for ContextPolicy {
    fn decide(
        &mut self,
        _call: &CapabilityCall,
        context: &CapabilityContext,
    ) -> Result<ApprovalDecision, RuntimeSignal> {
        self.contexts.borrow_mut().push(context.clone());
        Ok(ApprovalDecision {
            outcome: ApprovalOutcome::Allow,
            reason: "Fixture permits context inspection.".to_owned(),
            facts: None,
        })
    }
}

struct ContextCapabilities {
    contexts: Rc<RefCell<Vec<CapabilityContext>>>,
}

impl CapabilityAdapter for ContextCapabilities {
    fn supports(&self, capability_id: &str) -> bool {
        capability_id == "fixture.context"
    }

    fn invoke(
        &mut self,
        call: &CapabilityCall,
        _snapshot: &WorkspaceSnapshot,
        context: &CapabilityContext,
    ) -> Result<CapabilityResult, RuntimeSignal> {
        self.contexts.borrow_mut().push(context.clone());
        Ok(CapabilityResult {
            call_id: call.id.clone(),
            success: true,
            content: format!("completed:{}", call.id),
            evidence: Some(CapabilityEvidence {
                schema_version: 1,
                kind: "fixture.context.v1".to_owned(),
                data: json!({ "callId": call.id }),
            }),
        })
    }
}

struct InvalidEvidenceCapabilities {
    evidence: CapabilityEvidence,
}

impl CapabilityAdapter for InvalidEvidenceCapabilities {
    fn supports(&self, capability_id: &str) -> bool {
        capability_id == "workspace.inventory"
    }

    fn invoke(
        &mut self,
        call: &CapabilityCall,
        _snapshot: &WorkspaceSnapshot,
        _context: &CapabilityContext,
    ) -> Result<CapabilityResult, RuntimeSignal> {
        Ok(CapabilityResult {
            call_id: call.id.clone(),
            success: true,
            content: "Untrusted result.".to_owned(),
            evidence: Some(self.evidence.clone()),
        })
    }
}

fn allow() -> FixedPolicy {
    FixedPolicy(ApprovalDecision {
        outcome: ApprovalOutcome::Allow,
        reason: "Fixture permits read-only evidence inspection.".to_owned(),
        facts: None,
    })
}

fn run(
    request: RunRequest,
    planner: &mut dyn TaskPlanner,
    policy: &mut dyn ApprovalPolicy,
    capabilities: &mut dyn CapabilityAdapter,
    cancellation: &dyn Cancellation,
) -> forge_core::RunArtifact {
    let mut sink = NoopEventSink;
    Slice0Runtime {
        planner,
        approval_policy: policy,
        capabilities,
        cancellation,
        event_sink: &mut sink,
    }
    .run(request)
}

#[test]
fn produces_the_slice_zero_golden_trace() {
    let artifact = run(
        request("golden-run"),
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(artifact.schema_version, 3);
    assert_eq!(artifact.status, RunStatus::Completed);
    assert_eq!(artifact.outcome.status, OutcomeStatus::NotEvaluated);
    assert_eq!(artifact.output.as_deref(), Some("Workspace inspected."));
    let event_types: Vec<&str> = artifact
        .events
        .iter()
        .map(|event| match &event.data {
            forge_core::RunEventData::RunStarted { .. } => "run.started",
            forge_core::RunEventData::ContextPlanned { .. } => "context.planned",
            forge_core::RunEventData::CapabilityRequested { .. } => "capability.requested",
            forge_core::RunEventData::ApprovalDecided { .. } => "approval.decided",
            forge_core::RunEventData::CapabilityCompleted { .. } => "capability.completed",
            forge_core::RunEventData::OutcomeAssessed { .. } => "outcome.assessed",
            forge_core::RunEventData::RunCompleted { .. } => "run.completed",
            _ => "unexpected",
        })
        .collect();
    assert_eq!(
        event_types,
        vec![
            "run.started",
            "context.planned",
            "capability.requested",
            "approval.decided",
            "capability.completed",
            "outcome.assessed",
            "run.completed",
        ]
    );
    let locators: Vec<&str> = artifact
        .context_plan
        .as_ref()
        .expect("context plan")
        .selected
        .iter()
        .map(|item| item.locator.as_str())
        .collect();
    assert_eq!(
        locators,
        vec![
            "run://task",
            "workspace://README.md",
            "workspace://package.json",
            "workspace://src/greeting.ts",
        ]
    );
}

#[test]
fn binds_approval_and_invocation_to_the_same_ordered_prior_context() {
    let policy_contexts = Rc::new(RefCell::new(Vec::new()));
    let invocation_contexts = Rc::new(RefCell::new(Vec::new()));
    let first_call = CapabilityCall {
        id: "call-context-1".to_owned(),
        capability_id: "fixture.context".to_owned(),
        input: json!({ "order": 1 }),
    };
    let second_call = CapabilityCall {
        id: "call-context-2".to_owned(),
        capability_id: "fixture.context".to_owned(),
        input: json!({ "order": 2 }),
    };
    let mut context_request = request("context-bound-run");
    context_request.max_turns = 3;
    let artifact = run(
        context_request,
        &mut ScriptedPlanner {
            turns: VecDeque::from([
                PlannerTurn::Call {
                    call: first_call,
                    inference: None,
                },
                PlannerTurn::Call {
                    call: second_call,
                    inference: None,
                },
                PlannerTurn::Complete {
                    output: "Context inspected.".to_owned(),
                    inference: None,
                },
            ]),
        },
        &mut ContextPolicy {
            contexts: Rc::clone(&policy_contexts),
        },
        &mut ContextCapabilities {
            contexts: Rc::clone(&invocation_contexts),
        },
        &NoCancellation,
    );

    assert_eq!(artifact.status, RunStatus::Completed);
    let policy_contexts = policy_contexts.borrow();
    let invocation_contexts = invocation_contexts.borrow();
    assert_eq!(*policy_contexts, *invocation_contexts);
    assert!(policy_contexts[0].prior_observations.is_empty());
    let second = &policy_contexts[1];
    assert_eq!(second.basis.prior_call_ids, vec!["call-context-1"]);
    assert_eq!(second.prior_observations[0].call.id, "call-context-1");
    assert!(
        second
            .prior_observations
            .iter()
            .all(|observation| observation.call.id != "call-context-2")
    );
    let expected_digest = forge_core::sha256(
        &serde_json::to_vec(
            &serde_json::to_value(&second.prior_observations)
                .expect("prior observations should canonicalize"),
        )
        .expect("prior observations should serialize"),
    );
    assert_eq!(second.basis.prior_observations_sha256, expected_digest);
    let basis = artifact
        .events
        .iter()
        .find_map(|event| match &event.data {
            forge_core::RunEventData::ApprovalDecided { call_id, basis, .. }
                if call_id == "call-context-2" =>
            {
                Some(basis)
            }
            _ => None,
        })
        .expect("second approval basis");
    assert_eq!(basis, &second.basis);
    assert_eq!(
        artifact.capability_results[1]
            .evidence
            .as_ref()
            .map(|evidence| evidence.kind.as_str()),
        Some("fixture.context.v1")
    );
}

#[test]
fn fails_closed_on_invalid_capability_evidence_and_duplicate_call_ids() {
    let invalid = run(
        request("invalid-evidence-run"),
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut InvalidEvidenceCapabilities {
            evidence: CapabilityEvidence {
                schema_version: 2,
                kind: "INVALID KIND".to_owned(),
                data: json!({}),
            },
        },
        &NoCancellation,
    );
    assert!(!invalid.capability_results[0].success);
    assert!(invalid.capability_results[0].evidence.is_none());
    assert_eq!(
        invalid.capability_results[0].content,
        "Capability evidence schemaVersion must be 1."
    );

    let oversized = run(
        request("oversized-evidence-run"),
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut InvalidEvidenceCapabilities {
            evidence: CapabilityEvidence {
                schema_version: 1,
                kind: "fixture.oversized.v1".to_owned(),
                data: json!("x".repeat(4 * 1_048_576)),
            },
        },
        &NoCancellation,
    );
    assert!(!oversized.capability_results[0].success);
    assert!(oversized.capability_results[0].evidence.is_none());
    assert_eq!(
        oversized.capability_results[0].content,
        "Capability evidence exceeds the 4 MiB limit."
    );

    let mut duplicate_request = request("duplicate-call-run");
    duplicate_request.max_turns = 2;
    let duplicate = run(
        duplicate_request,
        &mut ScriptedPlanner {
            turns: VecDeque::from([
                PlannerTurn::Call {
                    call: inspect_call(),
                    inference: None,
                },
                PlannerTurn::Call {
                    call: inspect_call(),
                    inference: None,
                },
            ]),
        },
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(duplicate.status, RunStatus::Failed);
    assert!(matches!(
        duplicate.events.last().map(|event| &event.data),
        Some(forge_core::RunEventData::RunFailed { code, message })
            if code == "invalid_capability_call" && message.contains("already used")
    ));
}

#[test]
fn verifies_only_caller_authored_requirements() {
    let mut verified_request = request("verified-run");
    verified_request.outcome_contract = Some(outcome_contract("workspace.inventory"));
    let verified = run(
        verified_request,
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(verified.status, RunStatus::Completed);
    assert_eq!(verified.outcome.status, OutcomeStatus::Verified);
    assert_eq!(
        verified.outcome_contract,
        Some(outcome_contract("workspace.inventory"))
    );
    assert!(verified.outcome.checks.iter().all(|check| check.satisfied));
    assert!(matches!(
        verified.events[verified.events.len() - 2].data,
        forge_core::RunEventData::OutcomeAssessed { .. }
    ));

    let mut unmet_request = request("unmet-run");
    unmet_request.outcome_contract = Some(outcome_contract("workspace.read"));
    let unmet = run(
        unmet_request,
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(unmet.status, RunStatus::Completed);
    assert_eq!(unmet.outcome.status, OutcomeStatus::Unmet);
    assert_eq!(
        unmet
            .outcome
            .checks
            .iter()
            .find(|check| check.id == "required-capability")
            .map(|check| check.satisfied),
        Some(false)
    );
}

#[test]
fn uses_rust_unicode_whitespace_semantics_for_non_empty_output_checks() {
    for (run_id, output, expected_status) in [
        (
            "byte-order-mark-output",
            "\u{feff}",
            OutcomeStatus::Verified,
        ),
        ("next-line-output", "\u{0085}", OutcomeStatus::Unmet),
    ] {
        let mut output_request = request(run_id);
        output_request.max_turns = 1;
        output_request.outcome_contract = Some(OutcomeContract {
            schema_version: 1,
            requirements: vec![OutcomeRequirement::OutputNonEmpty {
                id: "output".to_owned(),
            }],
        });
        let mut planner = ScriptedPlanner {
            turns: VecDeque::from([PlannerTurn::Complete {
                output: output.to_owned(),
                inference: None,
            }]),
        };
        let artifact = run(
            output_request,
            &mut planner,
            &mut allow(),
            &mut FixtureCapabilities::inventory(),
            &NoCancellation,
        );
        assert_eq!(artifact.outcome.status, expected_status);
    }
}

#[test]
fn does_not_credit_a_capability_result_for_a_different_call_id() {
    let mut mismatched_request = request("mismatched-result-run");
    mismatched_request.outcome_contract = Some(outcome_contract("workspace.inventory"));
    let artifact = run(
        mismatched_request,
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut MismatchedCapabilities,
        &NoCancellation,
    );
    assert_eq!(artifact.status, RunStatus::Completed);
    assert_eq!(artifact.outcome.status, OutcomeStatus::Unmet);
    assert_eq!(artifact.capability_results[0].call_id, "call-1");
    assert!(!artifact.capability_results[0].success);
    assert_eq!(
        artifact.capability_results[0].content,
        "Capability result call ID call-other does not match call-1."
    );
}

#[test]
fn rejects_invalid_outcome_contracts_before_planning() {
    let mut invalid_request = request("invalid-outcome-run");
    invalid_request.outcome_contract = Some(OutcomeContract {
        schema_version: 1,
        requirements: Vec::new(),
    });
    let artifact = run(
        invalid_request,
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(artifact.status, RunStatus::Failed);
    assert_eq!(artifact.outcome.status, OutcomeStatus::NotEvaluated);
    assert!(matches!(
        artifact.events[1].data,
        forge_core::RunEventData::RunFailed { ref code, .. } if code == "invalid_outcome_contract"
    ));
}

#[test]
fn equivalent_inputs_produce_equivalent_artifacts() {
    let first = run(
        request("repeatable-run"),
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    let second = run(
        request("repeatable-run"),
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(first, second);
}

#[test]
fn records_normalized_inference_evidence_before_terminal_completion() {
    let evidence = InferenceEvidence {
        schema_version: 1,
        request_id: "inference:fixture".to_owned(),
        provider: "ollama".to_owned(),
        locality: InferenceLocality::Local,
        model: "fixture-model".to_owned(),
        finish_reason: InferenceFinishReason::Stop,
        duration_ms: 25,
        output_characters: 11,
        tool_call_count: 0,
        usage: InferenceUsage {
            input_tokens: Some(12),
            output_tokens: Some(3),
        },
        cost: InferenceCost {
            status: InferenceCostStatus::NotApplicable,
            amount_usd: None,
        },
        routing: InferenceRouting {
            requested_provider: "ollama".to_owned(),
            selected_provider: "ollama".to_owned(),
            requested_model: "fixture-model".to_owned(),
            selected_model: "fixture-model".to_owned(),
            fallback_used: false,
        },
    };
    let artifact = run(
        request("inference-run"),
        &mut ScriptedPlanner {
            turns: VecDeque::from([PlannerTurn::Complete {
                output: "Forge ready".to_owned(),
                inference: Some(evidence.clone()),
            }]),
        },
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(artifact.inference_evidence, Some(vec![evidence.clone()]));
    assert!(matches!(
        artifact.events[2].data,
        forge_core::RunEventData::InferenceCompleted { evidence: ref recorded } if recorded == &evidence
    ));
    assert!(matches!(
        artifact.events[3].data,
        forge_core::RunEventData::OutcomeAssessed { .. }
    ));
    assert!(matches!(
        artifact.events[4].data,
        forge_core::RunEventData::RunCompleted { .. }
    ));

    let mut tampered = evidence;
    tampered.routing.fallback_used = true;
    let invalid = run(
        request("tampered-inference-run"),
        &mut ScriptedPlanner {
            turns: VecDeque::from([PlannerTurn::Complete {
                output: "Forge ready".to_owned(),
                inference: Some(tampered),
            }]),
        },
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(invalid.status, RunStatus::Failed);
    assert!(invalid.inference_evidence.is_none());
    assert!(matches!(
        invalid.events[2].data,
        forge_core::RunEventData::RunFailed { ref code, .. } if code == "invalid_inference_evidence"
    ));
}

#[test]
fn records_denial_and_continues() {
    let mut deny = FixedPolicy(ApprovalDecision {
        outcome: ApprovalOutcome::Deny,
        reason: "Fixture policy denied this capability.".to_owned(),
        facts: None,
    });
    let artifact = run(
        request("denied-run"),
        &mut ScriptedPlanner::successful(),
        &mut deny,
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(artifact.status, RunStatus::Completed);
    assert!(
        artifact.capability_results[0]
            .content
            .starts_with("deny: Fixture policy denied")
    );
}

#[test]
fn records_adapter_failure_without_corrupting_terminal_state() {
    let call = CapabilityCall {
        id: "call-explodes".to_owned(),
        capability_id: "fixture.explodes".to_owned(),
        input: json!({}),
    };
    let mut planner = ScriptedPlanner {
        turns: VecDeque::from([
            PlannerTurn::Call {
                call,
                inference: None,
            },
            PlannerTurn::Complete {
                output: "Failure was reported.".to_owned(),
                inference: None,
            },
        ]),
    };
    let mut capabilities = FixtureCapabilities {
        failures: HashMap::from([(
            "fixture.explodes".to_owned(),
            "Fixture capability call-explodes failed.".to_owned(),
        )]),
    };
    let artifact = run(
        request("failure-run"),
        &mut planner,
        &mut allow(),
        &mut capabilities,
        &NoCancellation,
    );
    assert_eq!(artifact.status, RunStatus::Completed);
    assert!(!artifact.capability_results[0].success);
    assert!(artifact.capability_results[0].content.contains("failed"));
}

#[test]
fn reports_budget_exhaustion_before_adapter_work() {
    let mut limited = request("budget-run");
    limited.context_budget_bytes = 1;
    let artifact = run(
        limited,
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(artifact.status, RunStatus::BudgetExhausted);
    assert!(artifact.capability_results.is_empty());
    assert_eq!(artifact.events.len(), 3);
}

struct Cancelled;

impl Cancellation for Cancelled {
    fn reason(&self) -> Option<String> {
        Some("Fixture cancelled before start.".to_owned())
    }
}

#[test]
fn records_cancellation_before_work() {
    let artifact = run(
        request("cancelled-run"),
        &mut ScriptedPlanner::successful(),
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &Cancelled,
    );
    assert_eq!(artifact.status, RunStatus::Cancelled);
    assert_eq!(artifact.events.len(), 1);
}

#[test]
fn reports_turn_exhaustion() {
    let mut limited = request("turn-run");
    limited.max_turns = 1;
    let artifact = run(
        limited,
        &mut ScriptedPlanner {
            turns: VecDeque::from([PlannerTurn::Call {
                call: inspect_call(),
                inference: None,
            }]),
        },
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(artifact.status, RunStatus::Failed);
    assert!(artifact.events.iter().any(|event| matches!(event.data, forge_core::RunEventData::RunFailed { ref code, .. } if code == "turn_limit")));
}
