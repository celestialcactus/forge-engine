/**
 * Slice 0's intentionally host-neutral run protocol.
 *
 * Event sequence is a logical clock, rather than wall time, so a fixture run can
 * be compared byte-for-byte across hosts. Hosts may attach timestamps externally.
 */
export type RunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted'
  | 'execution_budget_exhausted';
export type ApprovalOutcome = 'allow' | 'ask' | 'deny';
export type OutcomeStatus = 'not_evaluated' | 'verified' | 'unmet';

export type OutcomeRequirement =
  | { readonly id: string; readonly kind: 'output_non_empty' }
  | { readonly id: string; readonly kind: 'output_equals'; readonly expected: string }
  | { readonly id: string; readonly kind: 'capability_succeeded'; readonly capabilityId: string; readonly minimumInvocations: number };

export interface OutcomeContract {
  readonly schemaVersion: 1;
  readonly requirements: readonly OutcomeRequirement[];
}

export interface OutcomeCheck {
  readonly id: string;
  readonly kind: OutcomeRequirement['kind'];
  readonly satisfied: boolean;
  readonly explanation: string;
}

export interface OutcomeAssessment {
  readonly schemaVersion: 1;
  readonly status: OutcomeStatus;
  readonly reason: string;
  readonly checks: readonly OutcomeCheck[];
}

export interface ApprovalFacts {
  readonly schemaVersion: 1;
  readonly callId: string;
  readonly capabilityId: string;
  readonly hostPolicy: {
    readonly posture: 'allow' | 'ask' | 'deny';
    readonly source: string;
    readonly reason: string;
  };
  readonly userConsent: {
    readonly status: 'notRequired' | 'granted' | 'declined' | 'unavailable';
    readonly source: string;
    readonly reason: string;
  };
}

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

export interface CapabilityEvidence {
  readonly schemaVersion: 1;
  readonly kind: string;
  readonly data: unknown;
}

export interface CapabilityResult {
  readonly callId: string;
  readonly success: boolean;
  readonly content: string;
  readonly evidence?: CapabilityEvidence;
}

export interface CapabilityObservation {
  readonly call: CapabilityCall;
  readonly result: CapabilityResult;
}

export interface CapabilityContextBasis {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly snapshotId: string;
  readonly contextPlanId: string;
  readonly priorCallIds: readonly string[];
  readonly priorObservationsSha256: string;
}

export interface CapabilityContext {
  readonly schemaVersion: 1;
  readonly task: string;
  readonly basis: CapabilityContextBasis;
  readonly priorObservations: readonly CapabilityObservation[];
}

export type InferenceLocality = 'local' | 'cloud';
export type InferenceFinishReason = 'stop' | 'tool_call' | 'length' | 'content_filter' | 'error';
export type InferenceCostStatus = 'not_applicable' | 'unavailable' | 'reported' | 'estimated';

export interface InferenceEvidence {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly provider: string;
  readonly locality: InferenceLocality;
  readonly model: string;
  readonly finishReason: InferenceFinishReason;
  readonly durationMs: number;
  readonly outputCharacters: number;
  readonly toolCallCount: number;
  readonly usage: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  readonly cost: {
    readonly status: InferenceCostStatus;
    readonly amountUsd?: string;
  };
  readonly routing: {
    readonly requestedProvider: string;
    readonly selectedProvider: string;
    readonly requestedModel: string;
    readonly selectedModel: string;
    readonly fallbackUsed: false;
  };
}

/**
 * Rust-authoritative execution ceilings. Token ceilings apply to cumulative
 * provider-reported usage and stop continuation after the response that crosses
 * a ceiling; they are not a transport-level promise about that response.
 */
export interface ExecutionBudget {
  readonly schemaVersion: 1;
  readonly maxCapabilityCalls: number;
  readonly maxReportedInputTokens: number;
  readonly maxReportedOutputTokens: number;
}

export interface ExecutionUsage {
  readonly schemaVersion: 1;
  readonly capabilityCalls: number;
  readonly inferenceTurns: number;
  readonly reportedInputTokens: number;
  readonly reportedOutputTokens: number;
}

export type ExecutionBudgetDimension =
  | 'capability_calls'
  | 'reported_input_tokens'
  | 'reported_output_tokens';

export type RunEventData =
  | { readonly type: 'run.started'; readonly task: string; readonly snapshotId: string }
  | { readonly type: 'context.planned'; readonly plan: ContextPlan }
  | { readonly type: 'capability.requested'; readonly call: CapabilityCall }
  | { readonly type: 'approval.decided'; readonly callId: string; readonly outcome: ApprovalOutcome; readonly reason: string; readonly basis: CapabilityContextBasis; readonly facts?: ApprovalFacts }
  | { readonly type: 'capability.completed'; readonly result: CapabilityResult }
  | { readonly type: 'inference.completed'; readonly evidence: InferenceEvidence }
  | { readonly type: 'outcome.assessed'; readonly assessment: OutcomeAssessment }
  | { readonly type: 'run.completed'; readonly output: string }
  | { readonly type: 'run.failed'; readonly code: string; readonly message: string }
  | { readonly type: 'run.cancelled'; readonly reason: string }
  | { readonly type: 'run.budget_exhausted'; readonly plan: ContextPlan; readonly requiredBytes: number }
  | {
      readonly type: 'run.execution_budget_exhausted';
      readonly dimension: ExecutionBudgetDimension;
      readonly limit: number;
      readonly observed: number;
      readonly usage: ExecutionUsage;
    };

export type RunEvent = RunEventData & {
  readonly runId: string;
  readonly sequence: number;
};

export interface RunArtifact {
  readonly schemaVersion: 4;
  readonly runId: string;
  readonly task: string;
  readonly snapshot: WorkspaceSnapshot;
  readonly status: RunStatus;
  readonly contextPlan?: ContextPlan;
  readonly executionBudget: ExecutionBudget;
  readonly executionUsage: ExecutionUsage;
  readonly capabilityResults: readonly CapabilityResult[];
  readonly inferenceEvidence?: readonly InferenceEvidence[];
  readonly outcomeContract?: OutcomeContract;
  readonly outcome: OutcomeAssessment;
  readonly output?: string;
  readonly events: readonly RunEvent[];
}

export interface RunRequest {
  readonly runId: string;
  readonly task: string;
  readonly snapshot: WorkspaceSnapshot;
  readonly contextBudgetBytes: number;
  readonly maxTurns: number;
  readonly executionBudget: ExecutionBudget;
  readonly outcomeContract?: OutcomeContract;
  readonly signal?: AbortSignal;
}

export interface PlannerRequest {
  readonly task: string;
  readonly contextPlan: ContextPlan;
  readonly capabilityResults: readonly CapabilityResult[];
  readonly turn: number;
}

export type PlannerTurn =
  | { readonly kind: 'complete'; readonly output: string; readonly inference?: InferenceEvidence }
  | { readonly kind: 'call'; readonly call: CapabilityCall; readonly inference?: InferenceEvidence };

export interface TaskPlanner {
  readonly id: string;
  next(request: PlannerRequest, signal: AbortSignal): Promise<PlannerTurn>;
}

export interface Capability {
  readonly id: string;
  invoke(
    call: CapabilityCall,
    snapshot: WorkspaceSnapshot,
    signal: AbortSignal,
    context: CapabilityContext,
  ): Promise<CapabilityResult>;
}

export interface ApprovalPolicy {
  decide(call: CapabilityCall, context: CapabilityContext): Promise<{
    readonly outcome: ApprovalOutcome;
    readonly reason: string;
    readonly facts?: ApprovalFacts;
  }>;
}

export const equivalentTrace = (left: readonly RunEvent[], right: readonly RunEvent[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
