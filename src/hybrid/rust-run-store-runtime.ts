import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { RunArtifact } from '../slice0/contracts.js';

export const rustRunStoreProtocolVersion = 'forge.kernel.run-store.v1';

export type RunRecordState = 'terminal' | 'open_or_interrupted' | 'repair_required';
export type RunResumeDisposition =
  | 'return_terminal_artifact'
  | 'resume_available'
  | 'retry_authorization_required'
  | 'blocked_incomplete'
  | 'repair_required';

export type RunContinuationDisposition =
  | 'terminal'
  | 'safe_boundary'
  | 'retryable_capability'
  | 'blocked_ambiguous_planner'
  | 'blocked_ambiguous_approval'
  | 'blocked_non_idempotent'
  | 'blocked_retry_exhausted'
  | 'blocked_planner_checkpoint_unavailable';

export interface RunContinuationInspection {
  readonly schemaVersion: 1;
  readonly disposition: RunContinuationDisposition;
  readonly interactionFrameCount: number;
  readonly completedInteractionCount: number;
  readonly lastSequence?: number;
  readonly pendingInteractionId?: string;
  readonly pendingKind?: 'planner' | 'approval' | 'capability';
  readonly pendingReplaySafety?: 'never_retry' | 'read_only_retryable' | 'non_idempotent';
  readonly capabilityDescriptors: readonly {
    readonly id: string;
    readonly replaySafety: 'read_only_retryable' | 'non_idempotent';
  }[];
  readonly reason: string;
}

export interface RunStoreInspection {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly state: RunRecordState;
  readonly resumeDisposition: RunResumeDisposition;
  readonly eventCount: number;
  readonly lastSequence?: number;
  readonly requestSha256?: string;
  readonly reason: string;
  readonly continuation?: RunContinuationInspection;
  readonly artifact?: RunArtifact;
}

export interface RustRunStoreRuntimeOptions {
  readonly kernelPath: string;
  readonly kernelArguments?: readonly string[];
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly runStoreRoot: string;
  readonly timeoutMs?: number;
  readonly requestIdFactory?: () => string;
}

type JsonObject = Record<string, unknown>;
const maximumOutputBytes = 136 * 1_048_576;

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;

const validateContinuation = (candidate: unknown): RunContinuationInspection => {
  const value = object(candidate);
  const disposition = value?.disposition;
  const frameCount = value?.interactionFrameCount;
  const completedCount = value?.completedInteractionCount;
  const lastSequence = value?.lastSequence;
  const pendingId = value?.pendingInteractionId;
  const pendingKind = value?.pendingKind;
  const pendingSafety = value?.pendingReplaySafety;
  const descriptors = value?.capabilityDescriptors;
  const pendingDisposition = [
    'retryable_capability',
    'blocked_ambiguous_planner',
    'blocked_ambiguous_approval',
    'blocked_non_idempotent',
    'blocked_retry_exhausted',
  ].includes(String(disposition));
  const pendingEvidenceExpected = pendingDisposition
    || (disposition === 'terminal' && pendingId !== undefined);
  if (value?.schemaVersion !== 1
    || ![
      'terminal',
      'safe_boundary',
      'retryable_capability',
      'blocked_ambiguous_planner',
      'blocked_ambiguous_approval',
      'blocked_non_idempotent',
      'blocked_retry_exhausted',
      'blocked_planner_checkpoint_unavailable',
    ].includes(String(disposition))
    || !Number.isSafeInteger(frameCount)
    || Number(frameCount) < 0
    || !Number.isSafeInteger(completedCount)
    || Number(completedCount) < 0
    || Number(completedCount) * 2 > Number(frameCount)
    || (Number(frameCount) === 0
      ? lastSequence !== undefined
      : !Number.isSafeInteger(lastSequence) || Number(lastSequence) !== Number(frameCount))
    || !Array.isArray(descriptors)
    || descriptors.some((descriptor, index) => {
      const item = object(descriptor);
      const previous = index === 0 ? undefined : object(descriptors[index - 1]);
      return typeof item?.id !== 'string'
        || item.id.length === 0
        || item.id.length > 512
        || !['read_only_retryable', 'non_idempotent'].includes(String(item.replaySafety))
        || (typeof previous?.id === 'string' && previous.id >= item.id);
    })
    || typeof value.reason !== 'string'
    || (pendingEvidenceExpected
      ? typeof pendingId !== 'string'
        || pendingId.length === 0
        || !['planner', 'approval', 'capability'].includes(String(pendingKind))
        || !['never_retry', 'read_only_retryable', 'non_idempotent'].includes(String(pendingSafety))
      : pendingId !== undefined || pendingKind !== undefined || pendingSafety !== undefined)
  ) throw new Error('Rust kernel returned an invalid run continuation assessment.');
  return candidate as RunContinuationInspection;
};

const validateInspection = (candidate: unknown, runId: string): RunStoreInspection => {
  const value = object(candidate);
  const state = value?.state;
  const disposition = value?.resumeDisposition;
  const eventCount = value?.eventCount;
  const lastSequence = value?.lastSequence;
  const artifact = object(value?.artifact);
  const continuation = value?.continuation === undefined
    ? undefined
    : validateContinuation(value.continuation);
  if (value?.schemaVersion !== 1
    || value.runId !== runId
    || !['terminal', 'open_or_interrupted', 'repair_required'].includes(String(state))
    || !['return_terminal_artifact', 'resume_available', 'retry_authorization_required', 'blocked_incomplete', 'repair_required'].includes(String(disposition))
    || !Number.isSafeInteger(eventCount)
    || Number(eventCount) < 0
    || (Number(eventCount) === 0
      ? lastSequence !== undefined
      : !Number.isSafeInteger(lastSequence) || Number(lastSequence) !== Number(eventCount))
    || typeof value.reason !== 'string'
    || (value.requestSha256 !== undefined
      && (typeof value.requestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.requestSha256)))
  ) {
    throw new Error('Rust kernel returned an invalid run-store inspection envelope.');
  }
  if (state === 'terminal') {
    const events = artifact?.events;
    if (disposition !== 'return_terminal_artifact'
      || artifact?.schemaVersion !== 4
      || artifact?.runId !== runId
      || artifact?.status === 'running'
      || !Array.isArray(events)
      || events.length !== Number(eventCount)
      || events.some((event, index) => {
        const item = object(event);
        return item?.runId !== runId || item.sequence !== index + 1 || typeof item.type !== 'string';
      })
      || typeof value.requestSha256 !== 'string'
      || (continuation !== undefined && continuation.disposition !== 'terminal')
    ) throw new Error('Rust kernel returned an invalid terminal run-store inspection.');
  } else if (artifact !== undefined || disposition === 'return_terminal_artifact') {
    throw new Error('Rust kernel exposed a terminal artifact for a non-terminal run record.');
  } else if ((state === 'open_or_interrupted'
      && !['resume_available', 'retry_authorization_required', 'blocked_incomplete'].includes(String(disposition)))
    || (state === 'repair_required' && disposition !== 'repair_required')
    || (state === 'open_or_interrupted' && typeof value.requestSha256 !== 'string')
    || (state === 'open_or_interrupted' && continuation?.disposition === 'terminal')
    || (disposition === 'resume_available' && continuation?.disposition !== 'safe_boundary')
    || (disposition === 'retry_authorization_required'
      && continuation?.disposition !== 'retryable_capability')
    || (disposition === 'blocked_incomplete'
      && ['safe_boundary', 'retryable_capability'].includes(String(continuation?.disposition)))
    || (state === 'repair_required' && continuation !== undefined)
  ) {
    throw new Error('Rust kernel returned an inconsistent non-terminal run-store inspection.');
  }
  return candidate as RunStoreInspection;
};

export class RustRunStoreRuntime {
  readonly #options: RustRunStoreRuntimeOptions;

  constructor(options: RustRunStoreRuntimeOptions) {
    if (options.runStoreRoot.trim().length === 0) throw new Error('Run-store root must not be empty.');
    this.#options = options;
  }

  async inspect(runId: string): Promise<RunStoreInspection> {
    if (runId.trim().length === 0) throw new Error('Run ID must not be empty.');
    const requestId = this.#options.requestIdFactory?.() ?? `run-store:${randomUUID()}`;
    const timeoutMs = this.#options.timeoutMs ?? 5_000;
    return new Promise<RunStoreInspection>((resolve, reject) => {
      let settled = false;
      let stdout = '';
      let stdoutBytes = 0;
      let stderr = '';
      const child = spawn(this.#options.kernelPath, [...(this.#options.kernelArguments ?? [])], {
        cwd: process.cwd(),
        env: { ...process.env, ...this.#options.environment },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const finish = (error?: Error, inspection?: RunStoreInspection): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error !== undefined) reject(error);
        else if (inspection !== undefined) resolve(inspection);
        else reject(new Error('Run-store inspection ended without a result.'));
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error(`Run-store inspection exceeded ${timeoutMs} ms.`));
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        const chunkBytes = Buffer.byteLength(chunk, 'utf8');
        if (stdoutBytes + chunkBytes > maximumOutputBytes) {
          child.kill();
          finish(new Error('Run-store inspection exceeded its output byte limit.'));
          return;
        }
        stdoutBytes += chunkBytes;
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 65_536) stderr += chunk.slice(0, 65_536 - stderr.length);
      });
      child.once('error', (error) => finish(new Error(`Rust kernel failed to start: ${error.message}`)));
      child.once('exit', (code) => {
        if (settled) return;
        if (code !== 0) {
          let protocolMessage: string | undefined;
          try {
            const candidate = object(JSON.parse(stdout.trim()) as unknown);
            if (candidate?.type === 'protocol.error' && typeof candidate.message === 'string') {
              protocolMessage = candidate.message;
            }
          } catch {
            // Fall through to bounded stderr.
          }
          const detail = protocolMessage ?? stderr.trim();
          finish(new Error(`Run-store inspection failed with code ${String(code)}${detail.length === 0 ? '.' : `: ${detail}`}`));
          return;
        }
        try {
          const frames = stdout.trim().split(/\r?\n/u);
          if (frames.length !== 1 || frames[0] === undefined) throw new Error('expected one result frame');
          const frame = object(JSON.parse(frames[0]) as unknown);
          if (frame?.type !== 'run_store.inspect.result'
            || frame.protocolVersion !== rustRunStoreProtocolVersion
            || frame.requestId !== requestId
          ) throw new Error('result frame does not match the run-store protocol');
          finish(undefined, validateInspection(frame.inspection, runId));
        } catch (error) {
          finish(new Error(`Rust kernel returned invalid run-store output: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
      child.stdin.on('error', () => {
        // Launch and exit handlers provide the actionable failure.
      });
      child.stdin.end(JSON.stringify({
        type: 'run_store.inspect',
        protocolVersion: rustRunStoreProtocolVersion,
        requestId,
        runStoreRoot: this.#options.runStoreRoot,
        runId,
      }) + '\n');
    });
  }
}
