import { createHash } from 'node:crypto';

import { compileContext, requiredContextBytes } from './context.js';
import {
  assessOutcome,
  notEvaluatedOutcome,
  outcomeContractError,
  type OutcomeCapabilityAttempt,
} from './outcome.js';
import type {
  ApprovalPolicy,
  Capability,
  CapabilityCall,
  CapabilityContext,
  CapabilityObservation,
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

const maximumCapabilityEvidenceBytes = 4 * 1_048_576;
const maximumCapabilityContextBytes = 4 * 1_048_576;
const capabilityEvidenceKind = /^[a-z0-9._-]{1,100}$/u;

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalJsonValue(record[key])]),
  );
};

const capabilityContext = (
  request: RunRequest,
  contextPlan: ContextPlan,
  priorObservations: readonly CapabilityObservation[],
): CapabilityContext => {
  const observations = [...priorObservations];
  const canonical = JSON.stringify(canonicalJsonValue(observations));
  if (Buffer.byteLength(canonical, 'utf8') > maximumCapabilityContextBytes) {
    throw new Error('Prior capability context exceeds the 4 MiB limit.');
  }
  return {
    schemaVersion: 1,
    task: request.task,
    basis: {
      schemaVersion: 1,
      runId: request.runId,
      snapshotId: request.snapshot.id,
      contextPlanId: contextPlan.id,
      priorCallIds: observations.map((observation) => observation.call.id),
      priorObservationsSha256: createHash('sha256').update(canonical).digest('hex'),
    },
    priorObservations: observations,
  };
};

const capabilityEvidenceValidationError = (result: CapabilityResult): string | undefined => {
  const evidence = result.evidence;
  if (evidence === undefined) return undefined;
  if (evidence.schemaVersion !== 1) return 'Capability evidence schemaVersion must be 1.';
  if (!capabilityEvidenceKind.test(evidence.kind)) return 'Capability evidence kind is invalid.';
  if (Buffer.byteLength(JSON.stringify(evidence), 'utf8') > maximumCapabilityEvidenceBytes) {
    return 'Capability evidence exceeds the 4 MiB limit.';
  }
  return undefined;
};

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
    const observations: CapabilityObservation[] = [];
    const attempts: OutcomeCapabilityAttempt[] = [];
    const inferenceEvidence: InferenceEvidence[] = [];
    let sequence = 0;
    let status: RunStatus = 'running';
    let contextPlan: ContextPlan | undefined;
    let outcome = notEvaluatedOutcome(
      'Outcome assessment did not run because the runtime did not reach a terminal planner turn.',
    );
    let output: string | undefined;

    const emit = (data: RunEventData): void => {
      const event: RunEvent = { runId: request.runId, sequence: ++sequence, ...data };
      events.push(event);
      this.#onEvent?.(event);
    };

    const artifact = (): RunArtifact => ({
      schemaVersion: 3,
      runId: request.runId,
      task: request.task,
      snapshot: request.snapshot,
      status,
      ...(contextPlan === undefined ? {} : { contextPlan }),
      capabilityResults: results,
      ...(inferenceEvidence.length === 0 ? {} : { inferenceEvidence }),
      ...(request.outcomeContract === undefined ? {} : { outcomeContract: request.outcomeContract }),
      outcome,
      ...(output === undefined ? {} : { output }),
      events,
    });

    try {
      signal.throwIfAborted();
      emit({ type: 'run.started', task: request.task, snapshotId: request.snapshot.id });
      if (request.outcomeContract !== undefined) {
        const contractError = outcomeContractError(request.outcomeContract);
        if (contractError !== undefined) {
          status = 'failed';
          emit({ type: 'run.failed', code: 'invalid_outcome_contract', message: contractError });
          return artifact();
        }
      }
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
          outcome = assessOutcome(request.outcomeContract, output, attempts);
          emit({ type: 'outcome.assessed', assessment: outcome });
          status = 'completed';
          emit({ type: 'run.completed', output });
          return artifact();
        }
        const result = await this.#execute(next.call, request, contextPlan, observations, signal, emit);
        attempts.push({ capabilityId: next.call.capabilityId, success: result.success });
        observations.push({ call: next.call, result });
        results.push(result);
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

  async #execute(
    call: CapabilityCall,
    request: RunRequest,
    contextPlan: ContextPlan,
    priorObservations: readonly CapabilityObservation[],
    signal: AbortSignal,
    emit: (data: RunEventData) => void,
  ): Promise<CapabilityResult> {
    if (call.id.trim().length === 0 || call.capabilityId.trim().length === 0) {
      throw new Error('Capability call ID and capability ID must not be empty.');
    }
    if (priorObservations.some((observation) => observation.call.id === call.id)) {
      throw new Error(`Capability call ID ${call.id} was already used in this run.`);
    }
    emit({ type: 'capability.requested', call });
    const context = capabilityContext(request, contextPlan, priorObservations);
    const decision = await this.#approvalPolicy.decide(call, context);
    emit({
      type: 'approval.decided',
      callId: call.id,
      outcome: decision.outcome,
      reason: decision.reason,
      basis: context.basis,
      ...(decision.facts === undefined ? {} : { facts: decision.facts }),
    });
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
      const invoked = await capability.invoke(call, request.snapshot, signal, context);
      const evidenceError = capabilityEvidenceValidationError(invoked);
      const result = invoked.callId !== call.id
        ? {
            callId: call.id,
            success: false,
            content: `Capability result call ID ${invoked.callId} does not match ${call.id}.`,
          }
        : evidenceError === undefined
          ? invoked
          : { callId: call.id, success: false, content: evidenceError };
      emit({ type: 'capability.completed', result });
      return result;
    } catch (error) {
      const result = { callId: call.id, success: false, content: error instanceof Error ? error.message : String(error) };
      emit({ type: 'capability.completed', result });
      return result;
    }
  }
}
