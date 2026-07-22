import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  ApprovalPolicy,
  Capability,
  CapabilityCall,
  CapabilityResult,
  PlannerRequest,
  PlannerTurn,
  RunArtifact,
  RunEvent,
  RunRequest,
  WorkspaceSnapshot,
} from '../slice0/contracts.js';
import type { Slice0RuntimeOptions } from '../slice0/runtime.js';

export const rustKernelProtocolVersion = 'forge.kernel.bridge.v1';

export interface RustKernelRuntimeOptions extends Slice0RuntimeOptions {
  readonly kernelPath: string;
  readonly kernelArguments?: readonly string[];
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly requestIdFactory?: () => string;
}

type JsonObject = Record<string, unknown>;
type ExitState = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
const cancelled = Symbol('cancelled');

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

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

const validateArtifact = (
  candidate: unknown,
  request: RunRequest,
  streamedEvents: readonly RunEvent[],
): RunArtifact => {
  if (!isObject(candidate)
    || candidate.schemaVersion !== 1
    || candidate.runId !== request.runId
    || !Array.isArray(candidate.events)
    || !Array.isArray(candidate.capabilityResults)
  ) {
    throw new Error('Rust kernel returned an invalid RunArtifact envelope.');
  }
  const artifact = candidate as unknown as RunArtifact;
  for (const [index, event] of artifact.events.entries()) {
    if (event.runId !== request.runId || event.sequence !== index + 1 || typeof event.type !== 'string') {
      throw new Error('Rust kernel returned an invalid event at sequence ' + String(index + 1) + '.');
    }
  }
  if (JSON.stringify(artifact.events) !== JSON.stringify(streamedEvents)) {
    throw new Error('Rust kernel terminal artifact does not match its streamed event trace.');
  }
  return artifact;
};

export class RustKernelRuntime {
  readonly #planner: Slice0RuntimeOptions['planner'];
  readonly #approvalPolicy: ApprovalPolicy;
  readonly #capabilities: ReadonlyMap<string, Capability>;
  readonly #onEvent: Slice0RuntimeOptions['onEvent'];
  readonly #kernelPath: string;
  readonly #kernelArguments: readonly string[];
  readonly #environment: Readonly<NodeJS.ProcessEnv> | undefined;
  readonly #requestIdFactory: () => string;

  constructor(options: RustKernelRuntimeOptions) {
    this.#planner = options.planner;
    this.#approvalPolicy = options.approvalPolicy;
    this.#capabilities = new Map(options.capabilities.map((capability) => [capability.id, capability]));
    this.#onEvent = options.onEvent;
    this.#kernelPath = options.kernelPath;
    this.#kernelArguments = options.kernelArguments ?? [];
    this.#environment = options.environment;
    this.#requestIdFactory = options.requestIdFactory ?? (() => 'bridge:' + randomUUID());
  }

  async run(request: RunRequest): Promise<RunArtifact> {
    try {
      await access(this.#kernelPath, fsConstants.X_OK);
    } catch (error) {
      throw new Error('Rust kernel failed to start: ' + errorMessage(error));
    }
    const signal = request.signal ?? new AbortController().signal;
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

      if (message.type === 'run.event') {
        const event = message.event as RunEvent;
        const expectedSequence = streamedEvents.length + 1;
        if (!isObject(event) || event.runId !== request.runId || event.sequence !== expectedSequence) {
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
          await writeMessage({
            type: 'planner.turn',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            turn: turn satisfies PlannerTurn,
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

      if (message.type === 'approval.decide') {
        const operation = this.#approvalPolicy.decide(message.call as CapabilityCall);
        try {
          const decision = await raceWithCancellation(operation, signal);
          if (decision === cancelled) return;
          await writeMessage({
            type: 'approval.decision',
            protocolVersion: rustKernelProtocolVersion,
            requestId,
            decision,
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

      if (message.type === 'capability.invoke') {
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
        let result: CapabilityResult;
        try {
          const invoked = await raceWithCancellation(capability.invoke(call, snapshot, signal), signal);
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
        return;
      }

      if (message.type === 'run.result') {
        terminalArtifact = validateArtifact(message.artifact, request, streamedEvents);
        return;
      }

      throw new Error('Rust kernel emitted unsupported message type: ' + message.type);
    };

    try {
      const startMessage: JsonObject = {
        type: 'run.start',
        protocolVersion: rustKernelProtocolVersion,
        requestId,
        request: {
          runId: request.runId,
          task: request.task,
          snapshot: request.snapshot,
          contextBudgetBytes: request.contextBudgetBytes,
          maxTurns: request.maxTurns,
        },
        capabilityIds: [...this.#capabilities.keys()],
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
      lines.close();
      if (!child.stdin.destroyed) child.stdin.end();
      if (terminalArtifact === undefined && child.exitCode === null) child.kill();
    }

    const exit = await exitPromise;
    if (launchError !== undefined) {
      throw new Error('Rust kernel failed to start: ' + launchError.message);
    }
    if (failed) throw failure;
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