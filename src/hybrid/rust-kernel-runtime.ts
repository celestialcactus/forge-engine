import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isDeepStrictEqual } from 'node:util';
import type {
  ApprovalFacts,
  Capability,
  CapabilityCall,
  CapabilityContext,
  CapabilityInvocationObserver,
  CapabilityRecoveryCheckpoint,
  CapabilityResult,
  PlannerCheckpoint,
  PlannerRequest,
  PlannerTurn,
  RunArtifact,
  RunEvent,
  RunRequest,
  WorkspaceSnapshot,
} from '../slice0/contracts.js';

export const rustKernelProtocolVersion = 'forge.kernel.bridge.v10';


export interface RustKernelResumeOptions {
  readonly signal?: AbortSignal;
  readonly allowRetryableCapabilityRetry?: boolean;
}

export interface ApprovalFactsProvider {
  collect(call: CapabilityCall, signal: AbortSignal, context: CapabilityContext): Promise<ApprovalFacts>;
}

export interface RustKernelRuntimeOptions {
  readonly planner: import('../slice0/contracts.js').TaskPlanner;
  readonly capabilities: readonly Capability[];
  readonly onEvent?: (event: RunEvent) => void;
  readonly approvalFacts: ApprovalFactsProvider;
  readonly kernelPath: string;
  readonly kernelArguments?: readonly string[];
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly runStoreRoot: string;
  readonly requestIdFactory?: () => string;
}

type JsonObject = Record<string, unknown>;
type ExitState = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
type PendingCheckpointAcknowledgement = {
  readonly callId: string;
  readonly checkpoint: CapabilityRecoveryCheckpoint;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
};
const cancelled = Symbol('cancelled');

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOutcomeAssessment = (value: unknown): boolean => {
  if (!isObject(value)
    || value.schemaVersion !== 1
    || !['not_evaluated', 'verified', 'unmet'].includes(String(value.status))
    || typeof value.reason !== 'string'
    || !Array.isArray(value.checks)
  ) return false;
  return value.checks.every((check) => isObject(check)
    && typeof check.id === 'string'
    && ['output_non_empty', 'output_equals', 'capability_succeeded'].includes(String(check.kind))
    && typeof check.satisfied === 'boolean'
    && typeof check.explanation === 'string');
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const validateRecoveryCheckpoint = (candidate: unknown): CapabilityRecoveryCheckpoint => {
  if (!isObject(candidate)
    || candidate.schemaVersion !== 1
    || candidate.kind !== 'change_set_transaction'
    || typeof candidate.changeSetId !== 'string'
    || !/^changeset:sha256:[a-f0-9]{64}$/u.test(candidate.changeSetId)
    || typeof candidate.transactionId !== 'string'
    || !/^transaction:sha256:[a-f0-9]{64}$/u.test(candidate.transactionId)
    || candidate.phase !== 'registered'
  ) throw new Error('Capability emitted an invalid recovery checkpoint.');
  return candidate as unknown as CapabilityRecoveryCheckpoint;
};

const cancellationReason = (signal: AbortSignal): string =>
  signal.reason instanceof Error ? signal.reason.message : 'Cancellation requested.';

const raceWithCancellation = async <T>(operation: Promise<T>, signal: AbortSignal): Promise<T | typeof cancelled> => {
  if (signal.aborted) return cancelled;
  return new Promise<T | typeof cancelled>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve(cancelled);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

const isExecutionUsage = (value: unknown): boolean => isObject(value)
  && value.schemaVersion === 1
  && ['capabilityCalls', 'inferenceTurns', 'reportedInputTokens', 'reportedOutputTokens']
    .every((field) => Number.isSafeInteger(value[field]) && Number(value[field]) >= 0);

const validateArtifact = (
  candidate: unknown,
  request: RunRequest,
  streamedEvents: readonly RunEvent[],
  durableEventCount = 0,
): RunArtifact => {
  if (!isObject(candidate)
    || candidate.schemaVersion !== 4
    || candidate.runId !== request.runId
    || !Array.isArray(candidate.events)
    || !Array.isArray(candidate.capabilityResults)
    || !isOutcomeAssessment(candidate.outcome)
    || !isDeepStrictEqual(candidate.executionBudget, request.executionBudget)
    || !isExecutionUsage(candidate.executionUsage)
    || !isDeepStrictEqual(candidate.outcomeContract, request.outcomeContract)
  ) {
    throw new Error('Rust kernel returned an invalid RunArtifact envelope.');
  }
  const artifact = candidate as unknown as RunArtifact;
  for (const [index, event] of artifact.events.entries()) {
    if (event.runId !== request.runId || event.sequence !== index + 1 || typeof event.type !== 'string') {
      throw new Error('Rust kernel returned an invalid event at sequence ' + String(index + 1) + '.');
    }
  }
  if (durableEventCount < 0
    || durableEventCount > artifact.events.length
    || JSON.stringify(artifact.events.slice(durableEventCount)) !== JSON.stringify(streamedEvents)
  ) {
    throw new Error('Rust kernel terminal artifact does not match its streamed event suffix.');
  }
  return artifact;
};

const validateResumeRequest = (candidate: unknown, runId: string): RunRequest => {
  const value = isObject(candidate) ? candidate : undefined;
  const snapshot = isObject(value?.snapshot) ? value.snapshot : undefined;
  const budget = isObject(value?.executionBudget) ? value.executionBudget : undefined;
  if (value?.runId !== runId
    || typeof value.task !== 'string'
    || value.task.length === 0
    || !isObject(snapshot)
    || typeof snapshot.id !== 'string'
    || typeof snapshot.rootLabel !== 'string'
    || !Array.isArray(snapshot.files)
    || !Number.isSafeInteger(value.contextBudgetBytes)
    || Number(value.contextBudgetBytes) < 1
    || !Number.isSafeInteger(value.maxTurns)
    || Number(value.maxTurns) < 1
    || budget?.schemaVersion !== 1
    || !['maxCapabilityCalls', 'maxReportedInputTokens', 'maxReportedOutputTokens']
      .every((field) => Number.isSafeInteger(budget[field]) && Number(budget[field]) >= 0)
  ) throw new Error('Rust kernel returned an invalid resume request.');
  return candidate as RunRequest;
};

export class RustKernelRuntime {
  readonly #planner: RustKernelRuntimeOptions['planner'];
  readonly #approvalFacts: ApprovalFactsProvider;
  readonly #capabilities: ReadonlyMap<string, Capability>;
  readonly #onEvent: RustKernelRuntimeOptions['onEvent'];
  readonly #kernelPath: string;
  readonly #kernelArguments: readonly string[];
  readonly #environment: Readonly<NodeJS.ProcessEnv> | undefined;
  readonly #runStoreRoot: string;
  readonly #requestIdFactory: () => string;

  constructor(options: RustKernelRuntimeOptions) {
    this.#planner = options.planner;
    this.#approvalFacts = options.approvalFacts;
    this.#capabilities = new Map(options.capabilities.map((capability) => [capability.id, capability]));
    this.#onEvent = options.onEvent;
    this.#kernelPath = options.kernelPath;
    this.#kernelArguments = options.kernelArguments ?? [];
    this.#environment = options.environment;
    this.#runStoreRoot = options.runStoreRoot;
    this.#requestIdFactory = options.requestIdFactory ?? (() => 'bridge:' + randomUUID());
  }

  async run(request: RunRequest): Promise<RunArtifact> {
    return this.#execute({ kind: 'fresh', request });
  }

  async resume(runId: string, options: RustKernelResumeOptions = {}): Promise<RunArtifact> {
    if (runId.trim().length === 0) throw new Error('Run ID must not be empty.');
    options.signal?.throwIfAborted();
    return this.#execute({ kind: 'resume', runId, ...options });
  }

  async #execute(invocation:
    | { readonly kind: 'fresh'; readonly request: RunRequest }
    | ({ readonly kind: 'resume'; readonly runId: string } & RustKernelResumeOptions)
  ): Promise<RunArtifact> {
    let request = invocation.kind === 'fresh' ? invocation.request : undefined;
    const runId = invocation.kind === 'fresh' ? invocation.request.runId : invocation.runId;
    let durableEventCount = 0;
    let resumeReady = false;
    try {
      await access(this.#kernelPath, fsConstants.X_OK);
    } catch (error) {
      throw new Error('Rust kernel failed to start: ' + errorMessage(error));
    }
    const signal = (invocation.kind === 'fresh' ? invocation.request.signal : invocation.signal)
      ?? new AbortController().signal;
    const requestId = this.#requestIdFactory();
    const child = spawn(this.#kernelPath, [...this.#kernelArguments], {
      cwd: process.cwd(),
      env: { ...process.env, ...this.#environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const streamedEvents: RunEvent[] = [];
    let stderr = '';
    let terminalArtifact: RunArtifact | undefined;
    let failed = false;
    let failure: unknown;
    let cancelSent = false;
    let launchError: Error | undefined;
    let activeCapability: Promise<void> | undefined;
    let backgroundFailure: unknown;
    let pendingCheckpointAcknowledgement: PendingCheckpointAcknowledgement | undefined;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 65_536) stderr += chunk.slice(0, 65_536 - stderr.length);
    });
    child.stdin.on('error', () => {
      // A child exit is reported through the exit promise with its stderr.
    });
    const exitPromise = new Promise<ExitState>((resolve) => {
      child.once('error', (error) => {
        launchError = error;
        resolve({ code: null, signal: null });
      });
      child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });

    const writeMessage = async (message: JsonObject): Promise<void> => {
      if (child.stdin.destroyed || !child.stdin.writable) {
        throw new Error('Rust kernel input closed before the bridge response was written.');
      }
      if (!child.stdin.write(JSON.stringify(message) + '\n')) await once(child.stdin, 'drain');
    };

    const sendCancellation = (): void => {
      if (cancelSent || child.stdin.destroyed || !child.stdin.writable) return;
      cancelSent = true;
      void writeMessage({
        type: 'run.cancel',
        protocolVersion: rustKernelProtocolVersion,
        requestId,
        reason: cancellationReason(signal),
      }).catch(() => {
        // The terminal child-exit check supplies the actionable transport failure.
      });
    };

    const handleMessage = async (raw: string): Promise<void> => {
      let message: unknown;
      try {
        message = JSON.parse(raw) as unknown;
      } catch (error) {
        throw new Error('Rust kernel emitted invalid NDJSON: ' + errorMessage(error));
      }
      if (!isObject(message) || typeof message.type !== 'string') {
        throw new Error('Rust kernel emitted a message without a type.');
      }
      if (message.type === 'protocol.error') {
        throw new Error('Rust kernel protocol error: ' + String(message.message ?? 'unknown error'));
      }
      if (message.protocolVersion !== rustKernelProtocolVersion || message.requestId !== requestId) {
        throw new Error('Rust kernel emitted a mismatched protocol or request ID.');
      }

      if (message.type === 'run.resume.ready') {
        if (invocation.kind !== 'resume' || resumeReady) {
          throw new Error('Rust kernel emitted an unexpected resume handshake.');
        }
        const nextRequest = validateResumeRequest(message.request, runId);
        if (!Number.isSafeInteger(message.durableEventCount)
          || Number(message.durableEventCount) < 0
        ) throw new Error('Rust kernel returned an invalid durable event count.');
        if (message.plannerCheckpoint !== undefined) {
          if (this.#planner.restore === undefined) {
            throw new Error('The selected planner cannot restore the durable provider checkpoint.');
          }
          this.#planner.restore(message.plannerCheckpoint as PlannerCheckpoint);
        }
        request = nextRequest;
        durableEventCount = Number(message.durableEventCount);
        resumeReady = true;
        await writeMessage({
          type: 'run.resume.accepted',
          protocolVersion: rustKernelProtocolVersion,
          requestId,
        });
        return;
      }

      if (invocation.kind === 'resume' && !resumeReady) {
        throw new Error('Rust kernel emitted run traffic before the resume handshake.');
      }

      if (message.type === 'run.event') {
        const event = message.event as RunEvent;
        const expectedSequence = durableEventCount + streamedEvents.length + 1;
        if (!isObject(event) || event.runId !== runId || event.sequence !== expectedSequence) {
          throw new Error('Rust kernel streamed an invalid event at sequence ' + String(expectedSequence) + '.');
        }
        streamedEvents.push(event);
        this.#onEvent?.(event);
        return;
      }

      if (message.type === 'planner.next') {
        const operation = this.#planner.next(message.request as PlannerRequest, signal);
        try {
          const turn = await raceWithCancellation(operation, signal);
          if (turn === cancelled) return;
          const plannerCheckpoint = this.#planner.checkpoint?.();
          await writeMessage({
            type: 'planner.turn',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            turn: turn satisfies PlannerTurn,
            ...(plannerCheckpoint === undefined ? {} : { plannerCheckpoint }),
          });
        } catch (error) {
          if (signal.aborted) return;
          await writeMessage({
            type: 'runtime.error',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            message: errorMessage(error),
          });
        }
        return;
      }

      if (message.type === 'approval.facts.request') {
        const operation = this.#approvalFacts.collect(
          message.call as CapabilityCall,
          signal,
          message.context as CapabilityContext,
        );
        try {
          const facts = await raceWithCancellation(operation, signal);
          if (facts === cancelled) return;
          await writeMessage({
            type: 'approval.facts',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            facts,
          });
        } catch (error) {
          if (signal.aborted) return;
          await writeMessage({
            type: 'runtime.error',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            message: errorMessage(error),
          });
        }
        return;
      }

      if (message.type === 'capability.progress.recorded'
        || message.type === 'capability.progress.rejected') {
        const pending = pendingCheckpointAcknowledgement;
        if (pending === undefined || message.callId !== pending.callId) {
          throw new Error('Rust kernel returned an unexpected capability progress acknowledgement.');
        }
        pendingCheckpointAcknowledgement = undefined;
        if (message.type === 'capability.progress.recorded') {
          const checkpoint = validateRecoveryCheckpoint(message.checkpoint);
          if (!isDeepStrictEqual(checkpoint, pending.checkpoint)) {
            pending.reject(new Error('Rust kernel acknowledged a different capability recovery checkpoint.'));
            return;
          }
          pending.resolve();
          return;
        }
        pending.reject(new Error(
          'Rust kernel rejected the capability recovery checkpoint: '
          + String(message.message ?? 'unknown reason'),
        ));
        return;
      }

      if (message.type === 'capability.invoke') {
        if (activeCapability !== undefined) {
          throw new Error('Rust kernel requested overlapping capability invocations.');
        }
        const call = message.call as CapabilityCall;
        const snapshot = message.snapshot as WorkspaceSnapshot;
        const capability = this.#capabilities.get(call.capabilityId);
        if (capability === undefined) {
          await writeMessage({
            type: 'runtime.error',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            message: 'Rust kernel requested unregistered capability: ' + call.capabilityId,
          });
          return;
        }
        const observer: CapabilityInvocationObserver = {
          checkpoint: async (candidate): Promise<void> => {
            const checkpoint = validateRecoveryCheckpoint(candidate);
            if (pendingCheckpointAcknowledgement !== undefined) {
              throw new Error('Capability emitted overlapping recovery checkpoints.');
            }
            await new Promise<void>((resolve, reject) => {
              const pending: PendingCheckpointAcknowledgement = {
                callId: call.id,
                checkpoint,
                resolve,
                reject: (error) => reject(error),
              };
              pendingCheckpointAcknowledgement = pending;
              void writeMessage({
                type: 'capability.progress',
                protocolVersion: rustKernelProtocolVersion,
                requestId,
                callId: call.id,
                checkpoint,
              }).catch((error: unknown) => {
                if (pendingCheckpointAcknowledgement === pending) {
                  pendingCheckpointAcknowledgement = undefined;
                  reject(error);
                }
              });
            });
          },
        };
        const operation = (async (): Promise<void> => {
          let result: CapabilityResult;
          try {
            const invoked = await raceWithCancellation(
              capability.invoke(
                call,
                snapshot,
                signal,
                message.context as CapabilityContext,
                observer,
              ),
              signal,
            );
            if (invoked === cancelled) return;
            result = invoked;
          } catch (error) {
            if (signal.aborted) return;
            result = { callId: call.id, success: false, content: errorMessage(error) };
          }
          await writeMessage({
            type: 'capability.result',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            result,
          });
        })();
        let tracked: Promise<void>;
        tracked = operation
          .catch((error: unknown) => {
            backgroundFailure ??= error;
            if (child.exitCode === null) child.kill();
          })
          .finally(() => {
            if (activeCapability === tracked) activeCapability = undefined;
          });
        activeCapability = tracked;
        return;
      }

      if (message.type === 'run.result') {
        if (request === undefined) throw new Error('Rust kernel returned a result without a run request.');
        terminalArtifact = validateArtifact(message.artifact, request, streamedEvents, durableEventCount);
        return;
      }

      throw new Error('Rust kernel emitted unsupported message type: ' + message.type);
    };

    try {
      const capabilityDescriptors = [...this.#capabilities.values()].map((capability) => ({
        id: capability.id,
        replaySafety: capability.replaySafety ?? 'non_idempotent',
      }));
      const startMessage: JsonObject = invocation.kind === 'fresh'
        ? {
            type: 'run.start',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            request: {
              runId: invocation.request.runId,
              task: invocation.request.task,
              snapshot: invocation.request.snapshot,
              contextBudgetBytes: invocation.request.contextBudgetBytes,
              maxTurns: invocation.request.maxTurns,
              executionBudget: invocation.request.executionBudget,
              ...(invocation.request.outcomeContract === undefined
                ? {}
                : { outcomeContract: invocation.request.outcomeContract }),
            },
            capabilities: capabilityDescriptors,
            runStoreRoot: this.#runStoreRoot,
            ...(signal.aborted ? { initialCancellationReason: cancellationReason(signal) } : {}),
          }
        : {
            type: 'run.resume',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            runId: invocation.runId,
            capabilities: capabilityDescriptors,
            runStoreRoot: this.#runStoreRoot,
            allowRetryableCapabilityRetry: invocation.allowRetryableCapabilityRetry ?? false,
            ...(signal.aborted ? { initialCancellationReason: cancellationReason(signal) } : {}),
          };
      await writeMessage(startMessage);
      if (!signal.aborted) signal.addEventListener('abort', sendCancellation, { once: true });

      for await (const line of lines) {
        if (line.length === 0) throw new Error('Rust kernel emitted an empty protocol frame.');
        await handleMessage(line);
        if (terminalArtifact !== undefined) break;
      }
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      signal.removeEventListener('abort', sendCancellation);
      const pending = pendingCheckpointAcknowledgement;
      pendingCheckpointAcknowledgement = undefined;
      pending?.reject(new Error('Rust kernel closed before acknowledging the capability recovery checkpoint.'));
      await activeCapability;
      lines.close();
      if (!child.stdin.destroyed) child.stdin.end();
      if (terminalArtifact === undefined && child.exitCode === null) child.kill();
    }

    const exit = await exitPromise;
    if (launchError !== undefined) {
      throw new Error('Rust kernel failed to start: ' + launchError.message);
    }
    if (failed) throw failure;
    if (backgroundFailure !== undefined) throw backgroundFailure;
    if (exit.code !== 0) {
      const detail = stderr.trim();
      const signalSuffix = exit.signal === null ? '' : ' (' + exit.signal + ')';
      const detailSuffix = detail.length === 0 ? '.' : ': ' + detail;
      throw new Error('Rust kernel exited with code ' + String(exit.code) + signalSuffix + detailSuffix);
    }
    if (terminalArtifact === undefined) {
      const detail = stderr.trim();
      throw new Error('Rust kernel exited without a terminal artifact' + (detail.length === 0 ? '.' : ': ' + detail));
    }
    return terminalArtifact;
  }
}