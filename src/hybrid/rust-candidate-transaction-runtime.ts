import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ApprovalFacts, CapabilityCall } from '../slice0/contracts.js';

export const rustCandidateTransactionProtocolVersion = 'forge.kernel.transaction.v1';

export type CandidateIsolationProfile = 'trusted' | 'host_managed' | 'restricted';
export type CandidateTransactionStatus =
  | 'not_authorized'
  | 'cancelled'
  | 'failed'
  | 'recovered'
  | 'verified_candidate';

export interface CandidateIsolationRequest {
  readonly profile: CandidateIsolationProfile;
  readonly hostAttestation?: {
    readonly providerId: string;
    readonly boundaryId: string;
    readonly processBoundaryInherited: boolean;
    readonly attestedControls: readonly string[];
  };
}

export interface CandidateApplicationChange {
  readonly path: string;
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly replacementText: string;
}

export interface CandidateApplicationManifest {
  readonly schemaVersion: 1;
  readonly proposalId: string;
  readonly snapshotId: string;
  readonly changes: readonly CandidateApplicationChange[];
}

export interface CandidateTransactionRequest {
  readonly transactionId: string;
  readonly expectedBaseRevision: string;
  readonly call: CapabilityCall;
  readonly manifest: CandidateApplicationManifest;
  readonly approvalFacts: ApprovalFacts;
  readonly verification: {
    readonly checkId: string;
    readonly isolation: CandidateIsolationRequest;
  };
}

export interface CandidateTransactionArtifact {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly proposalId: string;
  readonly snapshotId: string;
  readonly requestedIsolation: CandidateIsolationRequest;
  readonly status: CandidateTransactionStatus;
  readonly approval?: unknown;
  readonly boundary?: unknown;
  readonly application?: unknown;
  readonly verification?: unknown;
  readonly retention?: {
    readonly candidateId: string;
    readonly [key: string]: unknown;
  };
  readonly recovery?: unknown;
  readonly failure?: string;
  readonly cancellationReason?: string;
  readonly steps: readonly {
    readonly sequence: number;
    readonly phase: string;
    readonly success: boolean;
    readonly message: string;
  }[];
}

export interface TrustedVerificationCheckConfiguration {
  readonly checkId: string;
  readonly executable: string;
  readonly arguments?: readonly string[];
  readonly environment?: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface RustCandidateTransactionRuntimeOptions {
  readonly kernelPath: string;
  readonly kernelArguments?: readonly string[];
  readonly kernelEnvironment?: Readonly<NodeJS.ProcessEnv>;
  readonly repositoryRoot: string;
  readonly candidateParent: string;
  readonly gitExecutable?: string;
  readonly verificationChecks: readonly TrustedVerificationCheckConfiguration[];
  readonly maxDiffBytes?: number;
  readonly requestIdFactory?: () => string;
}

type JsonObject = Record<string, unknown>;
type ExitState = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
const maximumOutputFrameBytes = 8 * 1_048_576;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const cancellationReason = (signal: AbortSignal): string => {
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
      throw new Error('Rust kernel output exceeded the transaction frame limit.');
    }
    chunks.push(buffer);
  }
  const output = Buffer.concat(chunks, bytes);
  if (output.length === 0 || output.at(-1) !== 0x0a) {
    throw new Error('Rust kernel exited without a newline-terminated transaction frame.');
  }
  const frames = output
    .subarray(0, output.length - 1)
    .toString('utf8')
    .split('\n')
    .filter((frame) => frame.length > 0);
  if (frames.length !== 1) {
    throw new Error('Rust kernel emitted an invalid number of transaction frames.');
  }
  return frames[0] as string;
};

const validateArtifact = (
  candidate: unknown,
  request: CandidateTransactionRequest,
): CandidateTransactionArtifact => {
  if (!isObject(candidate)
    || candidate.schemaVersion !== 1
    || candidate.transactionId !== request.transactionId
    || candidate.proposalId !== request.manifest.proposalId
    || candidate.snapshotId !== request.manifest.snapshotId
    || typeof candidate.status !== 'string'
    || !Array.isArray(candidate.steps)
  ) {
    throw new Error('Rust kernel returned an invalid ChangeTransactionArtifact envelope.');
  }
  return candidate as unknown as CandidateTransactionArtifact;
};

export class RustCandidateTransactionRuntime {
  readonly #options: RustCandidateTransactionRuntimeOptions;
  readonly #requestIdFactory: () => string;

  constructor(options: RustCandidateTransactionRuntimeOptions) {
    this.#options = options;
    this.#requestIdFactory = options.requestIdFactory ?? (() => 'transaction-bridge:' + randomUUID());
  }

  async execute(
    request: CandidateTransactionRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<CandidateTransactionArtifact> {
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
      // Child exit and bounded stderr handling provide the actionable transport error.
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
        throw new Error('Rust kernel input closed before the transaction message was written.');
      }
      if (!child.stdin.write(JSON.stringify(message) + '\n')) await once(child.stdin, 'drain');
    };
    const sendCancellation = (): void => {
      if (cancelSent || child.stdin.destroyed || !child.stdin.writable) return;
      cancelSent = true;
      void writeMessage({
        type: 'transaction.cancel',
        protocolVersion: rustCandidateTransactionProtocolVersion,
        requestId,
        reason: cancellationReason(signal),
      }).catch(() => {
        // Child termination is checked below.
      });
    };

    try {
      await writeMessage({
        type: 'transaction.start',
        protocolVersion: rustCandidateTransactionProtocolVersion,
        requestId,
        request,
        configuration: {
          repositoryRoot: this.#options.repositoryRoot,
          candidateParent: this.#options.candidateParent,
          gitExecutable: this.#options.gitExecutable ?? 'git',
          verificationChecks: this.#options.verificationChecks,
          maxDiffBytes: this.#options.maxDiffBytes ?? 100_000,
        },
        ...(signal.aborted ? { initialCancellationReason: cancellationReason(signal) } : {}),
      });
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
        throw new Error('Rust kernel emitted invalid transaction JSON: ' + errorMessage(error));
      }
      if (!isObject(message) || typeof message.type !== 'string') {
        throw new Error('Rust kernel emitted a transaction message without a type.');
      }
      if (message.type === 'protocol.error') {
        throw new Error(
          'Rust kernel transaction protocol error'
          + (typeof message.code === 'string' ? ' [' + message.code + ']' : '')
          + ': '
          + String(message.message ?? 'unknown error'),
        );
      }
      if (
        message.type !== 'transaction.result'
        || message.protocolVersion !== rustCandidateTransactionProtocolVersion
        || message.requestId !== requestId
      ) {
        throw new Error('Rust kernel emitted a mismatched transaction result.');
      }
      if (exit.code !== 0) {
        const signalSuffix = exit.signal === null ? '' : ' (' + exit.signal + ')';
        const detail = stderr.trim();
        throw new Error(
          'Rust kernel exited with code '
          + String(exit.code)
          + signalSuffix
          + (detail.length === 0 ? '.' : ': ' + detail),
        );
      }
      return validateArtifact(message.artifact, request);
    } finally {
      signal.removeEventListener('abort', sendCancellation);
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) child.kill();
    }
  }
}