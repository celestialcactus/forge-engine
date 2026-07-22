import { compileContext, requiredContextBytes } from './context.js';
import type {
  ApprovalPolicy,
  Capability,
  CapabilityCall,
  CapabilityResult,
  ContextPlan,
  RunArtifact,
  RunEvent,
  RunEventData,
  RunRequest,
  RunStatus,
  TaskPlanner,
} from './contracts.js';

export interface Slice0RuntimeOptions {
  readonly planner: TaskPlanner;
  readonly approvalPolicy: ApprovalPolicy;
  readonly capabilities: readonly Capability[];
  readonly onEvent?: (event: RunEvent) => void;
}

/** The smallest host-neutral run coordinator. */
export class Slice0Runtime {
  readonly #planner: TaskPlanner;
  readonly #approvalPolicy: ApprovalPolicy;
  readonly #capabilities: ReadonlyMap<string, Capability>;
  readonly #onEvent: ((event: RunEvent) => void) | undefined;

  constructor(options: Slice0RuntimeOptions) {
    this.#planner = options.planner;
    this.#approvalPolicy = options.approvalPolicy;
    this.#capabilities = new Map(options.capabilities.map((capability) => [capability.id, capability]));
    this.#onEvent = options.onEvent;
  }

  async run(request: RunRequest): Promise<RunArtifact> {
    const signal = request.signal ?? new AbortController().signal;
    const events: RunEvent[] = [];
    const results: CapabilityResult[] = [];
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
    emit({ type: 'approval.decided', callId: call.id, outcome: decision.outcome, reason: decision.reason });
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
