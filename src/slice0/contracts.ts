/**
 * Slice 0's intentionally host-neutral run protocol.
 *
 * Event sequence is a logical clock, rather than wall time, so a fixture run can
 * be compared byte-for-byte across hosts. Hosts may attach timestamps externally.
 */
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'budget_exhausted';
export type ApprovalOutcome = 'allow' | 'ask' | 'deny';

export interface WorkspaceSnapshot {
  readonly id: string;
  readonly rootLabel: string;
  readonly files: readonly WorkspaceFile[];
}

export interface WorkspaceFile {
  readonly path: string;
  readonly bytes: number;
}

export interface ContextItem {
  readonly id: string;
  readonly kind: 'user.task' | 'workspace.file';
  readonly locator: string;
  readonly bytes: number;
  readonly reason: string;
}

export interface ContextPlan {
  readonly id: string;
  readonly budgetBytes: number;
  readonly selected: readonly ContextItem[];
  readonly omitted: readonly ContextItem[];
}

export interface CapabilityCall {
  readonly id: string;
  readonly capabilityId: string;
  readonly input: unknown;
}

export interface CapabilityResult {
  readonly callId: string;
  readonly success: boolean;
  readonly content: string;
}

export type RunEventData =
  | { readonly type: 'run.started'; readonly task: string; readonly snapshotId: string }
  | { readonly type: 'context.planned'; readonly plan: ContextPlan }
  | { readonly type: 'capability.requested'; readonly call: CapabilityCall }
  | { readonly type: 'approval.decided'; readonly callId: string; readonly outcome: ApprovalOutcome; readonly reason: string }
  | { readonly type: 'capability.completed'; readonly result: CapabilityResult }
  | { readonly type: 'run.completed'; readonly output: string }
  | { readonly type: 'run.failed'; readonly code: string; readonly message: string }
  | { readonly type: 'run.cancelled'; readonly reason: string }
  | { readonly type: 'run.budget_exhausted'; readonly plan: ContextPlan; readonly requiredBytes: number };

export type RunEvent = RunEventData & {
  readonly runId: string;
  readonly sequence: number;
};

export interface RunArtifact {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly task: string;
  readonly snapshot: WorkspaceSnapshot;
  readonly status: RunStatus;
  readonly contextPlan?: ContextPlan;
  readonly capabilityResults: readonly CapabilityResult[];
  readonly output?: string;
  readonly events: readonly RunEvent[];
}

export interface RunRequest {
  readonly runId: string;
  readonly task: string;
  readonly snapshot: WorkspaceSnapshot;
  readonly contextBudgetBytes: number;
  readonly maxTurns: number;
  readonly signal?: AbortSignal;
}

export interface PlannerRequest {
  readonly task: string;
  readonly contextPlan: ContextPlan;
  readonly capabilityResults: readonly CapabilityResult[];
  readonly turn: number;
}

export type PlannerTurn =
  | { readonly kind: 'complete'; readonly output: string }
  | { readonly kind: 'call'; readonly call: CapabilityCall };

export interface TaskPlanner {
  readonly id: string;
  next(request: PlannerRequest, signal: AbortSignal): Promise<PlannerTurn>;
}

export interface Capability {
  readonly id: string;
  invoke(call: CapabilityCall, snapshot: WorkspaceSnapshot, signal: AbortSignal): Promise<CapabilityResult>;
}

export interface ApprovalPolicy {
  decide(call: CapabilityCall): Promise<{ readonly outcome: ApprovalOutcome; readonly reason: string }>;
}

export const equivalentTrace = (left: readonly RunEvent[], right: readonly RunEvent[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
