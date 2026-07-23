import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ApprovalFacts, CapabilityCall } from '../slice0/contracts.js';

export const rustCandidateLifecycleProtocolVersion = 'forge.kernel.candidate.v1';

export interface CandidateLifecycleSubject {
  readonly candidateId: string;
  readonly repositoryId: string;
  readonly expectedBaseRevision: string;
  readonly proposalId: string;
  readonly snapshotId: string;
  readonly changeSetSha256: string;
  readonly finalDiffSha256: string;
}

export interface CandidateLifecycleChange {
  readonly path: string;
  readonly beforeSha256: string;
  readonly afterSha256: string;
}

export interface CandidateInspectionArtifact {
  readonly schemaVersion: 1;
  readonly subject: CandidateLifecycleSubject;
  readonly state: 'retained' | 'cleanup_failed' | 'promoted' | 'discarded';
  readonly changes: readonly CandidateLifecycleChange[];
  readonly candidateValid: boolean;
  readonly activeBaseRevision: string;
  readonly activeWorkspaceClean: boolean;
  readonly finalDiff?: {
    readonly text: string;
    readonly totalBytes: number;
    readonly sha256: string;
    readonly truncated: boolean;
  };
  readonly recovery?: {
    readonly attempted: boolean;
    readonly success: boolean;
    readonly message: string;
  };
}

export interface CandidatePromotionRequest {
  readonly promotionId: string;
  readonly subject: CandidateLifecycleSubject;
  readonly call: CapabilityCall;
  readonly approvalFacts: ApprovalFacts;
}

export interface CandidatePromotionArtifact {
  readonly schemaVersion: 1;
  readonly promotionId: string;
  readonly subject: CandidateLifecycleSubject;
  readonly status:
    | 'not_authorized'
    | 'cancelled'
    | 'failed'
    | 'recovered'
    | 'recovery_failed'
    | 'promoted'
    | 'already_promoted';
  readonly approval?: unknown;
  readonly recovery?: unknown;
  readonly failure?: string;
  readonly cancellationReason?: string;
}

export interface CandidateDiscardRequest {
  readonly discardId: string;
  readonly subject: CandidateLifecycleSubject;
  readonly call: CapabilityCall;
  readonly approvalFacts: ApprovalFacts;
}

export interface CandidateDiscardArtifact {
  readonly schemaVersion: 1;
  readonly discardId: string;
  readonly subject: CandidateLifecycleSubject;
  readonly status:
    | 'not_authorized'
    | 'cancelled'
    | 'failed'
    | 'discarded'
    | 'already_discarded';
  readonly approval?: unknown;
  readonly failure?: string;
  readonly cancellationReason?: string;
}

export interface RustCandidateLifecycleRuntimeOptions {
  readonly kernelPath: string;
  readonly kernelArguments?: readonly string[];
  readonly kernelEnvironment?: Readonly<NodeJS.ProcessEnv>;
  readonly repositoryRoot: string;
  readonly candidateParent: string;
  readonly candidateLeaseRoot?: string;
  readonly gitExecutable?: string;
  readonly maxDiffBytes?: number;
  readonly requestIdFactory?: () => string;
}

type JsonObject = Record<string, unknown>;
type OperationKind = 'inspect' | 'promote' | 'discard';
type ExitState = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
const maximumOutputFrameBytes = 8 * 1_048_576;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const boundedCancellationReason = (signal: AbortSignal): string => {
  const candidate = signal.reason instanceof Error ? signal.reason.message : 'Cancellation requested.';
  return candidate.length > 512 || candidate.trim().length === 0
    ? 'Cancellation requested.'
    : candidate;
};

const collectOutputFrame = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maximumOutputFrameBytes + 1) {
      throw new Error('Rust kernel output exceeded the candidate lifecycle frame limit.');
    }
    chunks.push(buffer);
  }
  const output = Buffer.concat(chunks, bytes);
  if (output.length === 0 || output.at(-1) !== 0x0a) {
    throw new Error('Rust kernel exited without a newline-terminated candidate lifecycle frame.');
  }
  const frames = output
    .subarray(0, output.length - 1)
    .toString('utf8')
    .split('\n')
    .filter((frame) => frame.length > 0);
  if (frames.length !== 1) {
    throw new Error('Rust kernel emitted an invalid number of candidate lifecycle frames.');
  }
  return frames[0] as string;
};

const validateSubject = (candidate: unknown): candidate is CandidateLifecycleSubject =>
  isObject(candidate)
  && typeof candidate.candidateId === 'string'
  && typeof candidate.repositoryId === 'string'
  && typeof candidate.expectedBaseRevision === 'string'
  && typeof candidate.proposalId === 'string'
  && typeof candidate.snapshotId === 'string'
  && typeof candidate.changeSetSha256 === 'string'
  && typeof candidate.finalDiffSha256 === 'string';

export class RustCandidateLifecycleRuntime {
  readonly #options: RustCandidateLifecycleRuntimeOptions;
  readonly #requestIdFactory: () => string;

  constructor(options: RustCandidateLifecycleRuntimeOptions) {
    this.#options = options;
    this.#requestIdFactory = options.requestIdFactory ?? (() => 'candidate-bridge:' + randomUUID());
  }

  async inspect(candidateId: string): Promise<CandidateInspectionArtifact> {
    const artifact = await this.#execute('inspect', { kind: 'inspect', candidateId });
    if (!isObject(artifact)
      || artifact.schemaVersion !== 1
      || !validateSubject(artifact.subject)
      || artifact.subject.candidateId !== candidateId
      || typeof artifact.state !== 'string'
      || !Array.isArray(artifact.changes)
    ) {
      throw new Error('Rust kernel returned an invalid CandidateInspectionArtifact envelope.');
    }
    return artifact as unknown as CandidateInspectionArtifact;
  }

  async promote(
    request: CandidatePromotionRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<CandidatePromotionArtifact> {
    const artifact = await this.#execute('promote', {
      kind: 'promote',
      request,
      ...(signal.aborted ? { initialCancellationReason: boundedCancellationReason(signal) } : {}),
    }, signal);
    if (!isObject(artifact)
      || artifact.schemaVersion !== 1
      || artifact.promotionId !== request.promotionId
      || !validateSubject(artifact.subject)
      || artifact.subject.candidateId !== request.subject.candidateId
      || typeof artifact.status !== 'string'
    ) {
      throw new Error('Rust kernel returned an invalid CandidatePromotionArtifact envelope.');
    }
    return artifact as unknown as CandidatePromotionArtifact;
  }

  async discard(
    request: CandidateDiscardRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<CandidateDiscardArtifact> {
    const artifact = await this.#execute('discard', {
      kind: 'discard',
      request,
      ...(signal.aborted ? { initialCancellationReason: boundedCancellationReason(signal) } : {}),
    }, signal);
    if (!isObject(artifact)
      || artifact.schemaVersion !== 1
      || artifact.discardId !== request.discardId
      || !validateSubject(artifact.subject)
      || artifact.subject.candidateId !== request.subject.candidateId
      || typeof artifact.status !== 'string'
    ) {
      throw new Error('Rust kernel returned an invalid CandidateDiscardArtifact envelope.');
    }
    return artifact as unknown as CandidateDiscardArtifact;
  }

  async #execute(
    kind: OperationKind,
    operation: JsonObject,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<unknown> {
    try {
      await access(this.#options.kernelPath, fsConstants.X_OK);
    } catch (error) {
      throw new Error('Rust kernel failed to start: ' + errorMessage(error));
    }
    const requestId = this.#requestIdFactory();
    const child = spawn(this.#options.kernelPath, [...(this.#options.kernelArguments ?? [])], {
      cwd: process.cwd(),
      env: { ...process.env, ...this.#options.kernelEnvironment },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let launchError: Error | undefined;
    let abortedAfterStart = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 65_536) stderr += chunk.slice(0, 65_536 - stderr.length);
    });
    child.stdin.on('error', () => {
      // Exit state and bounded stderr provide the transport error.
    });
    const exitPromise = new Promise<ExitState>((resolve) => {
      child.once('error', (error) => {
        launchError = error;
        resolve({ code: null, signal: null });
      });
      child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });
    const outputPromise = collectOutputFrame(child.stdout);
    const abort = (): void => {
      abortedAfterStart = true;
      child.kill();
    };
    try {
      const message = {
        type: 'candidate.start',
        protocolVersion: rustCandidateLifecycleProtocolVersion,
        requestId,
        config: {
          repositoryRoot: this.#options.repositoryRoot,
          candidateParent: this.#options.candidateParent,
          ...(this.#options.candidateLeaseRoot === undefined
            ? {}
            : { candidateLeaseRoot: this.#options.candidateLeaseRoot }),
          gitExecutable: this.#options.gitExecutable ?? 'git',
          maxDiffBytes: this.#options.maxDiffBytes ?? 100_000,
        },
        operation,
      };
      if (!child.stdin.write(JSON.stringify(message) + '\n')) await once(child.stdin, 'drain');
      child.stdin.end();
      if (!signal.aborted) {
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }
      const [exit, raw] = await Promise.all([exitPromise, outputPromise]);
      if (abortedAfterStart) {
        throw new Error('Candidate lifecycle operation was interrupted; the next operation will reconcile any durable journal.');
      }
      if (launchError !== undefined) {
        throw new Error('Rust kernel failed to start: ' + launchError.message);
      }
      let response: unknown;
      try {
        response = JSON.parse(raw) as unknown;
      } catch (error) {
        throw new Error('Rust kernel emitted invalid candidate lifecycle JSON: ' + errorMessage(error));
      }
      if (!isObject(response) || typeof response.type !== 'string') {
        throw new Error('Rust kernel emitted a candidate lifecycle message without a type.');
      }
      if (response.type === 'protocol.error') {
        throw new Error(
          'Rust kernel candidate protocol error'
          + (typeof response.code === 'string' ? ' [' + response.code + ']' : '')
          + ': '
          + String(response.message ?? 'unknown error'),
        );
      }
      if (response.type !== 'candidate.result'
        || response.protocolVersion !== rustCandidateLifecycleProtocolVersion
        || response.requestId !== requestId
        || response.operation !== kind
        || !isObject(response.result)
      ) {
        throw new Error('Rust kernel emitted a mismatched candidate lifecycle result.');
      }
      if (exit.code !== 0) {
        throw new Error('Rust kernel exited with code ' + String(exit.code) + ': ' + stderr.trim());
      }
      if (response.result.success !== true) {
        throw new Error('Rust candidate ' + kind + ' failed: ' + String(response.result.error ?? 'unknown error'));
      }
      return response.result.artifact;
    } finally {
      signal.removeEventListener('abort', abort);
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) child.kill();
    }
  }
}
