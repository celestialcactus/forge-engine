import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ApprovalFacts, CapabilityCall } from '../slice0/contracts.js';
import type { TrustedVerificationCheckConfiguration } from './rust-candidate-transaction-runtime.js';

export const rustSovereignChangeProtocolVersion = 'forge.kernel.changeset.v2';

export interface SovereignChangeProposal {
  readonly schemaVersion: 1;
  readonly operations: readonly Record<string, unknown>[];
}

export interface SovereignCoordinatorArtifact {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly changeSetId: string;
  readonly baseRevision: string;
  readonly state: 'prepared' | 'promoting' | 'operation_applied' | 'rolling_back' | 'rolled_back' | 'discarded' | 'promoted' | 'repair_required';
  readonly operationCount: number;
  readonly candidatePath: string;
  readonly candidateRetained: boolean;
  readonly verification: readonly Record<string, unknown>[];
  readonly transitions: readonly Record<string, unknown>[];
  readonly recoveryPerformed: boolean;
  readonly cancellationReason?: string;
  readonly failure?: string;
}

export interface SovereignProposalArtifact {
  readonly schemaVersion: 1;
  readonly status: 'verified_candidate' | 'verification_failed' | 'cancelled' | 'failed';
  readonly changeSet?: Record<string, unknown>;
  readonly boundary?: Record<string, unknown>;
  readonly application?: Record<string, unknown>;
  readonly verification: readonly Record<string, unknown>[];
  readonly transaction?: SovereignCoordinatorArtifact;
  readonly candidateCleanup?: string;
  readonly failure?: string;
}

export interface RustSovereignChangeRuntimeOptions {
  readonly kernelPath: string;
  readonly kernelArguments?: readonly string[];
  readonly kernelEnvironment?: Readonly<NodeJS.ProcessEnv>;
  readonly repositoryRoot: string;
  readonly engineRoot: string;
  readonly gitExecutable?: string;
  readonly maxDiffBytes?: number;
  readonly verificationChecks?: readonly TrustedVerificationCheckConfiguration[];
  readonly requestIdFactory?: () => string;
}

type JsonObject = Record<string, unknown>;
type OperationKind = 'propose' | 'inspect' | 'accept' | 'discard';
type ExitState = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
const maximumOutputFrameBytes = 8 * 1_048_576;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const cancellationReason = (signal: AbortSignal): string => {
  const reason = signal.reason instanceof Error ? signal.reason.message : 'Cancellation requested.';
  return reason.length > 512 || reason.trim().length === 0 ? 'Cancellation requested.' : reason;
};

const collectOutputFrame = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maximumOutputFrameBytes + 1) {
      throw new Error('Rust kernel output exceeded the sovereign change frame limit.');
    }
    chunks.push(buffer);
  }
  const output = Buffer.concat(chunks, bytes);
  if (output.length === 0 || output.at(-1) !== 0x0a) {
    throw new Error('Rust kernel exited without a newline-terminated sovereign change frame.');
  }
  const frames = output.subarray(0, -1).toString('utf8').split('\n').filter(Boolean);
  if (frames.length !== 1) {
    throw new Error('Rust kernel emitted an invalid number of sovereign change frames.');
  }
  return frames[0] as string;
};

const validateCoordinator = (candidate: unknown): SovereignCoordinatorArtifact => {
  if (!isObject(candidate)
    || candidate.schemaVersion !== 1
    || typeof candidate.transactionId !== 'string'
    || typeof candidate.changeSetId !== 'string'
    || typeof candidate.baseRevision !== 'string'
    || typeof candidate.state !== 'string'
    || typeof candidate.operationCount !== 'number'
    || typeof candidate.candidatePath !== 'string'
    || typeof candidate.candidateRetained !== 'boolean'
    || !Array.isArray(candidate.verification)
    || !Array.isArray(candidate.transitions)
    || typeof candidate.recoveryPerformed !== 'boolean') {
    throw new Error('Rust kernel returned an invalid sovereign coordinator artifact.');
  }
  return candidate as unknown as SovereignCoordinatorArtifact;
};

export class RustSovereignChangeRuntime {
  readonly #options: RustSovereignChangeRuntimeOptions;
  readonly #requestIdFactory: () => string;

  constructor(options: RustSovereignChangeRuntimeOptions) {
    this.#options = options;
    this.#requestIdFactory = options.requestIdFactory ?? (() => 'change-bridge:' + randomUUID());
  }

  async propose(
    proposal: SovereignChangeProposal,
    selectedCheckIds: readonly string[],
    call: CapabilityCall,
    approvalFacts: ApprovalFacts,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SovereignProposalArtifact> {
    const artifact = await this.#execute('propose', {
      kind: 'propose',
      proposal,
      selectedCheckIds,
      call,
      approvalFacts,
      ...(signal.aborted ? { initialCancellationReason: cancellationReason(signal) } : {}),
    }, signal);
    if (!isObject(artifact)
      || artifact.schemaVersion !== 1
      || typeof artifact.status !== 'string'
      || !Array.isArray(artifact.verification)) {
      throw new Error('Rust kernel returned an invalid sovereign proposal artifact.');
    }
    if (artifact.transaction !== undefined) validateCoordinator(artifact.transaction);
    return artifact as unknown as SovereignProposalArtifact;
  }

  async inspect(transactionId: string): Promise<SovereignCoordinatorArtifact> {
    return validateCoordinator(await this.#execute('inspect', { kind: 'inspect', transactionId }));
  }

  async accept(
    transactionId: string,
    call: CapabilityCall,
    approvalFacts: ApprovalFacts,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SovereignCoordinatorArtifact> {
    return validateCoordinator(await this.#execute('accept', {
      kind: 'accept',
      transactionId,
      call,
      approvalFacts,
      ...(signal.aborted ? { initialCancellationReason: cancellationReason(signal) } : {}),
    }, signal));
  }

  async discard(
    transactionId: string,
    call: CapabilityCall,
    approvalFacts: ApprovalFacts,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SovereignCoordinatorArtifact> {
    return validateCoordinator(await this.#execute('discard', {
      kind: 'discard',
      transactionId,
      call,
      approvalFacts,
      ...(signal.aborted ? { initialCancellationReason: cancellationReason(signal) } : {}),
    }, signal));
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
    let cancelSent = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 65_536) stderr += chunk.slice(0, 65_536 - stderr.length);
    });
    child.stdin.on('error', () => {
      // Exit state and bounded stderr provide the actionable transport error.
    });
    const exitPromise = new Promise<ExitState>((resolve) => {
      child.once('error', (error) => {
        launchError = error;
        resolve({ code: null, signal: null });
      });
      child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });
    const outputPromise = collectOutputFrame(child.stdout);
    const writeMessage = async (message: JsonObject): Promise<void> => {
      if (child.stdin.destroyed || !child.stdin.writable) {
        throw new Error('Rust kernel input closed before the sovereign change message was written.');
      }
      if (!child.stdin.write(JSON.stringify(message) + '\n')) await once(child.stdin, 'drain');
    };
    const sendCancellation = (): void => {
      if (cancelSent || child.stdin.destroyed || !child.stdin.writable) return;
      cancelSent = true;
      void writeMessage({
        type: 'change.cancel',
        protocolVersion: rustSovereignChangeProtocolVersion,
        requestId,
        reason: cancellationReason(signal),
      }).catch(() => {
        // Child termination and durable reconciliation are checked below.
      });
    };
    try {
      await writeMessage({
        type: 'change.start',
        protocolVersion: rustSovereignChangeProtocolVersion,
        requestId,
        config: {
          repositoryRoot: this.#options.repositoryRoot,
          engineRoot: this.#options.engineRoot,
          gitExecutable: this.#options.gitExecutable ?? 'git',
          maxDiffBytes: this.#options.maxDiffBytes ?? 100_000,
          verificationChecks: this.#options.verificationChecks ?? [],
        },
        operation,
      });
      if (kind === 'inspect') child.stdin.end();
      if (!signal.aborted) {
        signal.addEventListener('abort', sendCancellation, { once: true });
        if (signal.aborted) sendCancellation();
      }
      const [exit, raw] = await Promise.all([exitPromise, outputPromise]);
      if (launchError !== undefined) {
        throw new Error('Rust kernel failed to start: ' + launchError.message);
      }
      let message: unknown;
      try {
        message = JSON.parse(raw) as unknown;
      } catch (error) {
        throw new Error('Rust kernel emitted invalid sovereign change JSON: ' + errorMessage(error));
      }
      if (!isObject(message) || typeof message.type !== 'string') {
        throw new Error('Rust kernel emitted a sovereign change message without a type.');
      }
      if (message.type === 'protocol.error') {
        throw new Error(
          'Rust kernel sovereign change protocol error'
          + (typeof message.code === 'string' ? ' [' + message.code + ']' : '')
          + ': '
          + String(message.message ?? 'unknown error'),
        );
      }
      if (message.type !== 'change.result'
        || message.protocolVersion !== rustSovereignChangeProtocolVersion
        || message.requestId !== requestId
        || message.operation !== kind) {
        throw new Error('Rust kernel emitted a mismatched sovereign change result.');
      }
      if (exit.code !== 0) {
        const detail = stderr.trim();
        throw new Error('Rust kernel exited with code ' + String(exit.code)
          + (detail.length === 0 ? '.' : ': ' + detail));
      }
      return message.artifact;
    } finally {
      signal.removeEventListener('abort', sendCancellation);
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) child.kill();
    }
  }
}