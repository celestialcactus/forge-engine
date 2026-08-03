import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ApprovalFacts, CapabilityCall } from '../slice0/contracts.js';
import type {
  HostIsolationChallenge,
  SignedHostBoundaryStatement,
} from './host-authority-transcript.js';
import type {
  VerificationCheckConfiguration,
  VerificationIsolationProfile,
} from './verification-configuration.js';
export type {
  TrustedVerificationCheckConfiguration,
  VerificationCheckConfiguration,
  VerificationIsolationPolicyConfiguration,
} from './verification-configuration.js';

export const rustCandidateTransactionProtocolVersion = 'forge.kernel.transaction.v2';

export type CandidateIsolationProfile = VerificationIsolationProfile;
export type CandidateTransactionStatus =
  | 'not_authorized'
  | 'cancelled'
  | 'failed'
  | 'recovered'
  | 'verified_candidate';

export interface CandidateIsolationRequest {
  readonly profile: CandidateIsolationProfile;
  readonly hostProviderId?: string;
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
  readonly hostAuthorization?: unknown;
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


export interface TrustedHostKeyConfiguration {
  readonly providerId: string;
  readonly keyId: string;
  readonly publicKeyHex: string;
}

export interface HostAuthorityConfiguration {
  readonly ledgerRoot: string;
  readonly trustedKeys: readonly TrustedHostKeyConfiguration[];
  readonly challengeTtlMs: number;
}

export type HostAttestor = (
  challenge: HostIsolationChallenge,
  signal: AbortSignal,
) => SignedHostBoundaryStatement | Promise<SignedHostBoundaryStatement>;

export interface RustCandidateTransactionRuntimeOptions {
  readonly kernelPath: string;
  readonly kernelArguments?: readonly string[];
  readonly kernelEnvironment?: Readonly<NodeJS.ProcessEnv>;
  readonly repositoryRoot: string;
  readonly candidateParent: string;
  readonly gitExecutable?: string;
  readonly verificationChecks: readonly VerificationCheckConfiguration[];
  readonly hostAuthority?: HostAuthorityConfiguration;
  readonly hostAttestor?: HostAttestor;
  readonly maxDiffBytes?: number;
  readonly requestIdFactory?: () => string;
}

type JsonObject = Record<string, unknown>;
type ExitState = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
const maximumOutputFrameBytes = 8 * 1_048_576;
const maximumOutputFrames = 4;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const cancellationReason = (signal: AbortSignal): string => {
  const candidate = signal.reason instanceof Error ? signal.reason.message : 'Cancellation requested.';
  return candidate.length > 512 || candidate.trim().length === 0
    ? 'Cancellation requested.'
    : candidate;
};

const outputFrames = async function* (stream: Readable): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);
  let count = 0;
  for await (const chunk of stream) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    pending = Buffer.concat([pending, incoming]);
    if (pending.byteLength > maximumOutputFrameBytes + 1 && !pending.includes(0x0a)) {
      throw new Error('Rust kernel output exceeded the transaction frame limit.');
    }
    let newline = pending.indexOf(0x0a);
    while (newline >= 0) {
      let frame = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      if (frame.at(-1) === 0x0d) frame = frame.subarray(0, frame.length - 1);
      if (frame.byteLength > maximumOutputFrameBytes) {
        throw new Error('Rust kernel output exceeded the transaction frame limit.');
      }
      if (frame.byteLength > 0) {
        count += 1;
        if (count > maximumOutputFrames) {
          throw new Error('Rust kernel emitted too many transaction frames.');
        }
        yield frame.toString('utf8');
      }
      newline = pending.indexOf(0x0a);
    }
  }
  if (pending.byteLength !== 0) {
    throw new Error('Rust kernel exited without a newline-terminated transaction frame.');
  }
};

const invokeHostAttestor = async (
  attestor: HostAttestor,
  challenge: HostIsolationChallenge,
  signal: AbortSignal,
): Promise<SignedHostBoundaryStatement | undefined> => {
  if (signal.aborted) return undefined;
  const remaining = Math.max(1, Math.min(300_000, challenge.expiresAtUnixMs - Date.now()));
  let timer: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;
  const interrupted = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), remaining);
    abortListener = () => resolve(undefined);
    signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve(attestor(challenge, signal)), interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortListener !== undefined) signal.removeEventListener('abort', abortListener);
  }
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

const validateChallenge = (candidate: unknown): HostIsolationChallenge => {
  if (!isObject(candidate)
    || candidate.schemaVersion !== 1
    || typeof candidate.challengeId !== 'string'
    || typeof candidate.nonceHex !== 'string'
    || typeof candidate.issuedAtUnixMs !== 'number'
    || typeof candidate.expiresAtUnixMs !== 'number'
    || typeof candidate.providerId !== 'string'
    || typeof candidate.capabilityDigest !== 'string'
    || typeof candidate.policyDigest !== 'string'
    || !Array.isArray(candidate.requiredControls)
  ) {
    throw new Error('Rust kernel returned an invalid host isolation challenge.');
  }
  return candidate as unknown as HostIsolationChallenge;
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

    const collectResult = async (): Promise<CandidateTransactionArtifact> => {
      let terminal: CandidateTransactionArtifact | undefined;
      let challengeSeen = false;
      for await (const raw of outputFrames(child.stdout)) {
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
        if (message.protocolVersion !== rustCandidateTransactionProtocolVersion
          || message.requestId !== requestId
        ) {
          throw new Error('Rust kernel emitted a mismatched transaction frame.');
        }
        if (message.type === 'transaction.host_challenge') {
          if (challengeSeen || terminal !== undefined) {
            throw new Error('Rust kernel emitted an unexpected duplicate host challenge.');
          }
          challengeSeen = true;
          if (this.#options.hostAttestor === undefined) {
            throw new Error('Rust kernel requested host authority but no host attestor is configured.');
          }
          const challenge = validateChallenge(message.challenge);
          const signedStatement = await invokeHostAttestor(
            this.#options.hostAttestor,
            challenge,
            signal,
          );
          if (signedStatement !== undefined) {
            await writeMessage({
              type: 'transaction.host_statement',
              protocolVersion: rustCandidateTransactionProtocolVersion,
              requestId,
              signedStatement,
            });
          }
          continue;
        }
        if (message.type === 'transaction.result') {
          if (terminal !== undefined) {
            throw new Error('Rust kernel emitted duplicate transaction results.');
          }
          terminal = validateArtifact(message.artifact, request);
          continue;
        }
        throw new Error('Rust kernel emitted an unsupported transaction frame: ' + message.type);
      }
      if (terminal === undefined) {
        throw new Error('Rust kernel exited without a terminal transaction result.');
      }
      return terminal;
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
          ...(this.#options.hostAuthority === undefined
            ? {}
            : { hostAuthority: this.#options.hostAuthority }),
        },
        ...(signal.aborted ? { initialCancellationReason: cancellationReason(signal) } : {}),
      });
      if (!signal.aborted) {
        signal.addEventListener('abort', sendCancellation, { once: true });
        if (signal.aborted) sendCancellation();
      }
      const [exit, artifact] = await Promise.all([exitPromise, collectResult()]);
      if (launchError !== undefined) {
        throw new Error('Rust kernel failed to start: ' + launchError.message);
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
      return artifact;
    } finally {
      signal.removeEventListener('abort', sendCancellation);
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) child.kill();
    }
  }
}