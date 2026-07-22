use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
    BudgetExhausted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalOutcome {
    Allow,
    Ask,
    Deny,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub id: String,
    pub root_label: String,
    pub files: Vec<WorkspaceFile>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub path: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub id: String,
    pub kind: ContextItemKind,
    pub locator: String,
    pub bytes: u64,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContextItemKind {
    #[serde(rename = "user.task")]
    UserTask,
    #[serde(rename = "workspace.file")]
    WorkspaceFile,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPlan {
    pub id: String,
    pub budget_bytes: u64,
    pub selected: Vec<ContextItem>,
    pub omitted: Vec<ContextItem>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityCall {
    pub id: String,
    pub capability_id: String,
    pub input: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityResult {
    pub call_id: String,
    pub success: bool,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RunEventData {
    #[serde(rename = "run.started")]
    RunStarted {
        task: String,
        #[serde(rename = "snapshotId")]
        snapshot_id: String,
    },
    #[serde(rename = "context.planned")]
    ContextPlanned { plan: ContextPlan },
    #[serde(rename = "capability.requested")]
    CapabilityRequested { call: CapabilityCall },
    #[serde(rename = "approval.decided")]
    ApprovalDecided {
        #[serde(rename = "callId")]
        call_id: String,
        outcome: ApprovalOutcome,
        reason: String,
    },
    #[serde(rename = "capability.completed")]
    CapabilityCompleted { result: CapabilityResult },
    #[serde(rename = "run.completed")]
    RunCompleted { output: String },
    #[serde(rename = "run.failed")]
    RunFailed { code: String, message: String },
    #[serde(rename = "run.cancelled")]
    RunCancelled { reason: String },
    #[serde(rename = "run.budget_exhausted")]
    RunBudgetExhausted {
        plan: ContextPlan,
        #[serde(rename = "requiredBytes")]
        required_bytes: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub run_id: String,
    pub sequence: u64,
    #[serde(flatten)]
    pub data: RunEventData,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunArtifact {
    pub schema_version: u8,
    pub run_id: String,
    pub task: String,
    pub snapshot: WorkspaceSnapshot,
    pub status: RunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_plan: Option<ContextPlan>,
    pub capability_results: Vec<CapabilityResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    pub events: Vec<RunEvent>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub run_id: String,
    pub task: String,
    pub snapshot: WorkspaceSnapshot,
    pub context_budget_bytes: u64,
    pub max_turns: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerRequest {
    pub task: String,
    pub context_plan: ContextPlan,
    pub capability_results: Vec<CapabilityResult>,
    pub turn: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum PlannerTurn {
    #[serde(rename = "complete")]
    Complete { output: String },
    #[serde(rename = "call")]
    Call { call: CapabilityCall },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecision {
    pub outcome: ApprovalOutcome,
    pub reason: String,
}
