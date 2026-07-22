use std::collections::{HashMap, VecDeque};

use forge_core::{
    ApprovalDecision, ApprovalOutcome, ApprovalPolicy, Cancellation, CapabilityAdapter,
    CapabilityCall, CapabilityResult, NoCancellation, NoopEventSink, PlannerRequest, PlannerTurn,
    RunRequest, RunStatus, RuntimeSignal, Slice0Runtime, TaskPlanner, WorkspaceFile,
    WorkspaceSnapshot,
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
    }
}

fn inspect_call() -> CapabilityCall {
    CapabilityCall {
        id: "call-1".to_owned(),
        capability_id: "workspace.inventory".to_owned(),
        input: json!({}),
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
                },
                PlannerTurn::Complete {
                    output: "Workspace inspected.".to_owned(),
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
    fn decide(&mut self, _call: &CapabilityCall) -> Result<ApprovalDecision, RuntimeSignal> {
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
        })
    }
}

fn allow() -> FixedPolicy {
    FixedPolicy(ApprovalDecision {
        outcome: ApprovalOutcome::Allow,
        reason: "Fixture permits read-only evidence inspection.".to_owned(),
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
    assert_eq!(artifact.status, RunStatus::Completed);
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
fn records_denial_and_continues() {
    let mut deny = FixedPolicy(ApprovalDecision {
        outcome: ApprovalOutcome::Deny,
        reason: "Fixture policy denied this capability.".to_owned(),
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
            PlannerTurn::Call { call },
            PlannerTurn::Complete {
                output: "Failure was reported.".to_owned(),
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
            }]),
        },
        &mut allow(),
        &mut FixtureCapabilities::inventory(),
        &NoCancellation,
    );
    assert_eq!(artifact.status, RunStatus::Failed);
    assert!(artifact.events.iter().any(|event| matches!(event.data, forge_core::RunEventData::RunFailed { ref code, .. } if code == "turn_limit")));
}
