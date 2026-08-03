import { compileContext, requiredContextBytes } from './context.js';
import type {
  ApprovalPolicy,
  Capability,
  CapabilityCall,
  CapabilityResult,
  ContextPlan,
  InferenceEvidence,
  RunArtifact,
  RunEvent,
  RunEventData,
  RunRequest,
  RunStatus,
  PlannerTurn,
  TaskPlanner,
} from './contracts.js';

const inferenceValidationError = (turn: PlannerTurn): string | undefined => {
  const evidence = turn.inference;
  if (evidence === undefined) return undefined;
  if (evidence.schemaVersion !== 1) return 'Inference evidence schemaVersion must be 1.';
  for (const [label, value, maximum] of [
    ['requestId', evidence.requestId, 512],
    ['provider', evidence.provider, 100],
    ['model', evidence.model, 200],
  ] as const) {
    if (value.length === 0 || value.length > maximum) return `Inference evidence ${label} has an invalid length.`;
  }
  if (!Number.isSafeInteger(evidence.durationMs) || evidence.durationMs < 0 || evidence.durationMs > 86_400_000) {
    return 'Inference evidence durationMs is outside the supported range.';
  }
  if (!Number.isSafeInteger(evidence.outputCharacters) || evidence.outputCharacters < 0 || evidence.outputCharacters > 65_536) {
    return 'Inference evidence outputCharacters is outside the supported range.';
  }
  if (!Number.isSafeInteger(evidence.toolCallCount) || evidence.toolCallCount < 0 || evidence.toolCallCount > 1) {
    return 'Inference evidence toolCallCount must be zero or one.';
  }
  for (const [label, value] of [['inputTokens', evidence.usage.inputTokens], ['outputTokens', evidence.usage.outputTokens]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000)) {
      return `Inference evidence ${label} is outside the supported range.`;
    }
  }
  const routing = evidence.routing;
  if (routing.fallbackUsed !== false
    || routing.requestedProvider !== routing.selectedProvider
    || routing.selectedProvider !== evidence.provider
    || routing.requestedModel !== routing.selectedModel
    || routing.selectedModel !== evidence.model
  ) return 'Inference evidence routing does not prove an explicit no-fallback route.';
  if (evidence.locality === 'local' && evidence.cost.status !== 'not_applicable') {
    return 'Local inference cost status must be not_applicable.';
  }
  if (evidence.locality === 'cloud' && evidence.cost.status === 'not_applicable') {
    return 'Cloud inference cost status must not be not_applicable.';
  }
  if (evidence.cost.amountUsd !== undefined
    && evidence.cost.status !== 'reported'
    && evidence.cost.status !== 'estimated'
  ) return 'Inference cost amount requires reported or estimated status.';
  if (evidence.cost.amountUsd !== undefined && !/^\d+(?:\.\d{1,12})?$/u.test(evidence.cost.amountUsd)) {
    return 'Inference cost amountUsd must be a non-negative decimal string.';
  }
  if (turn.kind === 'call') {
    if (evidence.finishReason !== 'tool_call' || evidence.toolCallCount !== 1) {
      return 'Capability planner turns require one tool_call inference completion.';
    }
  } else if (evidence.finishReason !== 'stop'
    || evidence.toolCallCount !== 0
    || evidence.outputCharacters !== Array.from(turn.output).length
  ) return 'Completed planner turns require matching stopped text inference evidence.';
  return undefined;
};

export interface TypeScriptConformanceRuntimeOptions {
  readonly planner: TaskPlanner;
  readonly approvalPolicy: ApprovalPolicy;
  readonly capabilities: readonly Capability[];
  readonly onEvent?: (event: RunEvent) => void;
}

/**
 * TypeScript conformance oracle for protocol fixtures.
 *
 * Product CLI and MCP execution must use the Rust kernel. This implementation is
 * deliberately retained only to test cross-language trace equivalence.
 */
export class TypeScriptConformanceRuntime {
  readonly #planner: TaskPlanner;
  readonly #approvalPolicy: ApprovalPolicy;
  readonly #capabilities: ReadonlyMap<string, Capability>;
  readonly #onEvent: ((event: RunEvent) => void) | undefined;

  constructor(options: TypeScriptConformanceRuntimeOptions) {
    this.#planner = options.planner;
    this.#approvalPolicy = options.approvalPolicy;
    this.#capabilities = new Map(options.capabilities.map((capability) => [capability.id, capability]));
    this.#onEvent = options.onEvent;
  }

  async run(request: RunRequest): Promise<RunArtifact> {
    const signal = request.signal ?? new AbortController().signal;
    const events: RunEvent[] = [];
    const results: CapabilityResult[] = [];
    const inferenceEvidence: InferenceEvidence[] = [];
    let sequence = 0;
    let status: RunStatus = 'running';
    let contextPlan: ContextPlan | undefined;
    let output: string | undefined;

    const emit = (data: RunEventData): void => {
      const event: RunEvent = { runId: request.runId, sequence: ++sequence, ...data };
      events.push(event);
      this.#onEvent?.(event);
    };

    const artifact = (): RunArtifact => ({
      schemaVersion: 1,
      runId: request.runId,
      task: request.task,
      snapshot: request.snapshot,
      status,
      ...(contextPlan === undefined ? {} : { contextPlan }),
      capabilityResults: results,
      ...(inferenceEvidence.length === 0 ? {} : { inferenceEvidence }),
      ...(output === undefined ? {} : { output }),
      events,
    });

    try {
      signal.throwIfAborted();
      emit({ type: 'run.started', task: request.task, snapshotId: request.snapshot.id });
      contextPlan = compileContext(request.task, request.snapshot, request.contextBudgetBytes);
      emit({ type: 'context.planned', plan: contextPlan });

      if (!contextPlan.selected.some((item) => item.kind === 'user.task')) {
        status = 'budget_exhausted';
        emit({ type: 'run.budget_exhausted', plan: contextPlan, requiredBytes: requiredContextBytes(request.task, request.snapshot) });
        return artifact();
      }

      for (let turn = 1; turn <= request.maxTurns; turn++) {
        signal.throwIfAborted();
        const next = await this.#planner.next({ task: request.task, contextPlan, capabilityResults: results, turn }, signal);
        signal.throwIfAborted();
        const inferenceError = inferenceValidationError(next);
        if (inferenceError !== undefined) {
          status = 'failed';
          emit({ type: 'run.failed', code: 'invalid_inference_evidence', message: inferenceError });
          return artifact();
        }
        if (next.inference !== undefined) {
          inferenceEvidence.push(next.inference);
          emit({ type: 'inference.completed', evidence: next.inference });
        }
        if (next.kind === 'complete') {
          output = next.output;
          status = 'completed';
          emit({ type: 'run.completed', output });
          return artifact();
        }
        results.push(await this.#execute(next.call, request, signal, emit));
      }

      status = 'failed';
      emit({ type: 'run.failed', code: 'turn_limit', message: `Run exceeded its ${request.maxTurns}-turn limit.` });
      return artifact();
    } catch (error) {
      if (signal.aborted) {
        status = 'cancelled';
        emit({ type: 'run.cancelled', reason: signal.reason instanceof Error ? signal.reason.message : 'Cancellation requested.' });
        return artifact();
      }
      status = 'failed';
      emit({ type: 'run.failed', code: 'runtime_error', message: error instanceof Error ? error.message : String(error) });
      return artifact();
    }
  }

  async #execute(call: CapabilityCall, request: RunRequest, signal: AbortSignal, emit: (data: RunEventData) => void): Promise<CapabilityResult> {
    emit({ type: 'capability.requested', call });
    const decision = await this.#approvalPolicy.decide(call);
    emit({ type: 'approval.decided', callId: call.id, outcome: decision.outcome, reason: decision.reason, ...(decision.facts === undefined ? {} : { facts: decision.facts }) });
    if (decision.outcome !== 'allow') {
      const result = { callId: call.id, success: false, content: `${decision.outcome}: ${decision.reason}` };
      emit({ type: 'capability.completed', result });
      return result;
    }
    const capability = this.#capabilities.get(call.capabilityId);
    if (!capability) {
      const result = { callId: call.id, success: false, content: `Unknown capability: ${call.capabilityId}` };
      emit({ type: 'capability.completed', result });
      return result;
    }
    try {
      const result = await capability.invoke(call, request.snapshot, signal);
      emit({ type: 'capability.completed', result });
      return result;
    } catch (error) {
      const result = { callId: call.id, success: false, content: error instanceof Error ? error.message : String(error) };
      emit({ type: 'capability.completed', result });
      return result;
    }
  }
}
