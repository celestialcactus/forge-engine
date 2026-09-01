import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type {
  MemoryCaptureMode,
  MemoryCaptureRuntime,
  MemoryCorrectionDisposition,
  MemoryGrantScope,
  MemoryInspection,
  MemoryObservation,
  MemoryOperationResult,
  MemoryRuntimeOutcome,
  MemoryScope,
  MemoryStandingGrant,
  ProjectedMemory,
  RecoveryMemory,
} from './contracts.js';
import { rustMemoryProtocolVersion } from './contracts.js';

export interface RustMemoryRuntimeOptions {
  readonly kernelPath: string;
  readonly kernelArguments?: readonly string[];
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly engineRoot: string;
  readonly workspaceRoot: string;
  readonly scope: MemoryScope;
  readonly actorId: string;
  readonly timeoutMs?: number;
  readonly requestIdFactory?: () => string;
  readonly clock?: () => number;
}

type JsonObject = Record<string, unknown>;
const maximumOutputBytes = 4 * 1_048_576;
const digestPattern = /^[a-f0-9]{64}$/u;
const claimIdPattern = /^memory_claim:v1:sha256:[a-f0-9]{64}$/u;
const observationIdPattern = /^memory_observation:v1:sha256:[a-f0-9]{64}$/u;
const grantIdPattern = /^memory_grant:v1:sha256:[a-f0-9]{64}$/u;

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;

const sameScope = (candidate: unknown, expected: MemoryScope): candidate is MemoryScope => {
  const value = object(candidate);
  if (expected.kind === 'repository') {
    return value?.kind === 'repository'
      && value.workspaceId === expected.workspaceId
      && value.repositoryId === expected.repositoryId;
  }
  return value?.kind === 'developer' && value.actorId === expected.actorId;
};

const validGrantScope = (candidate: unknown): candidate is MemoryGrantScope => {
  const value = object(candidate);
  return value?.kind === 'repository'
    ? typeof value.workspaceId === 'string' && value.workspaceId.length > 0
      && typeof value.repositoryId === 'string' && value.repositoryId.length > 0
    : value?.kind === 'developer' && typeof value.actorId === 'string' && value.actorId.length > 0;
};

const validateGrant = (candidate: unknown): MemoryStandingGrant => {
  const value = object(candidate);
  if (value?.schemaVersion !== 1
    || typeof value.grantId !== 'string'
    || !grantIdPattern.test(value.grantId)
    || typeof value.actorId !== 'string'
    || value.actorId.length === 0
    || !validGrantScope(value.scope)
    || !['off', 'ask', 'auto'].includes(String(value.mode))
    || !Number.isSafeInteger(value.createdAtMillis)
    || Number(value.createdAtMillis) < 0
    || (value.revokedAtMillis !== undefined
      && (!Number.isSafeInteger(value.revokedAtMillis)
        || Number(value.revokedAtMillis) < Number(value.createdAtMillis)))) {
    throw new Error('Rust kernel returned an invalid memory standing grant.');
  }
  return candidate as MemoryStandingGrant;
};

const validateObservation = (
  candidate: unknown,
  expectedScope: MemoryScope,
): MemoryObservation => {
  const value = object(candidate);
  if (value?.schemaVersion !== 1
    || value.normalizationId !== 'memory_text_v1'
    || typeof value.claimId !== 'string'
    || !claimIdPattern.test(value.claimId)
    || typeof value.observationId !== 'string'
    || !observationIdPattern.test(value.observationId)
    || typeof value.subjectKind !== 'string'
    || typeof value.statementKind !== 'string'
    || typeof value.subject !== 'string'
    || value.subject.length === 0
    || Buffer.byteLength(value.subject, 'utf8') > 8 * 1024
    || typeof value.statement !== 'string'
    || value.statement.length === 0
    || Buffer.byteLength(value.statement, 'utf8') > 8 * 1024
    || !sameScope(value.scope, expectedScope)
    || object(value.provenance) === undefined
    || !Number.isSafeInteger(value.confidence)
    || Number(value.confidence) < 0
    || Number(value.confidence) > 100
    || !Number.isSafeInteger(value.observedAtMillis)
    || Number(value.observedAtMillis) < 0
  ) throw new Error('Rust kernel returned an invalid memory observation.');
  return candidate as MemoryObservation;
};

const validateProjected = (
  candidate: unknown,
  expectedScope: MemoryScope,
): ProjectedMemory => {
  const value = object(candidate);
  if (typeof value?.lineageId !== 'string'
    || !observationIdPattern.test(value.lineageId)
    || !Number.isSafeInteger(value.admittedSequence)
    || Number(value.admittedSequence) < 1
    || !Number.isSafeInteger(value.updatedSequence)
    || Number(value.updatedSequence) < 1
  ) throw new Error('Rust kernel returned an invalid projected memory.');
  validateObservation(value.observation, expectedScope);
  return candidate as ProjectedMemory;
};

const validateRecovery = (
  candidate: unknown,
  expectedScope: MemoryScope,
): RecoveryMemory => {
  const value = object(candidate);
  if (typeof value?.lineageId !== 'string'
    || !observationIdPattern.test(value.lineageId)
    || typeof value.replacementObservationId !== 'string'
    || !observationIdPattern.test(value.replacementObservationId)
    || !Number.isSafeInteger(value.replacedAtMillis)
    || Number(value.replacedAtMillis) < 0
    || !Number.isSafeInteger(value.updatedSequence)
    || Number(value.updatedSequence) < 1
  ) throw new Error('Rust kernel returned an invalid recovery memory.');
  validateObservation(value.observation, expectedScope);
  return candidate as RecoveryMemory;
};

const validateInspection = (
  candidate: unknown,
  expectedScope: MemoryScope,
): MemoryInspection => {
  const value = object(candidate);
  const active = value?.active;
  const recovery = value?.recovery;
  const grants = value?.grants;
  if (value?.schemaVersion !== 1
    || !sameScope(value.scope, expectedScope)
    || (value.ledgerHeadSha256 !== undefined
      && (typeof value.ledgerHeadSha256 !== 'string' || !digestPattern.test(value.ledgerHeadSha256)))
    || !Array.isArray(active)
    || (recovery !== undefined && !Array.isArray(recovery))
    || (grants !== undefined && !Array.isArray(grants))
    || !Number.isSafeInteger(value.activeCount)
    || Number(value.activeCount) !== active.length
    || !Number.isSafeInteger(value.recoveryCount)
    || Number(value.recoveryCount) < 0
  ) throw new Error('Rust kernel returned an invalid memory inspection.');
  active.forEach((entry) => validateProjected(entry, expectedScope));
  (recovery ?? []).forEach((entry) => validateRecovery(entry, expectedScope));
  (grants ?? []).forEach(validateGrant);
  return candidate as MemoryInspection;
};

const validateOperation = (
  candidate: unknown,
  expectedScope: MemoryScope,
): MemoryOperationResult => {
  const value = object(candidate);
  if (value?.schemaVersion !== 1
    || ![
      'admitted', 'corrected', 'restored', 'unchanged', 'capture_mode_changed',
      'grant_revoked', 'auto_capture_undone',
    ].includes(String(value.status))
    || !sameScope(value.scope, expectedScope)
    || !Number.isSafeInteger(value.activeCount)
    || Number(value.activeCount) < 0
    || !Number.isSafeInteger(value.recoveryCount)
    || Number(value.recoveryCount) < 0
    || typeof value.ledgerHeadSha256 !== 'string'
    || !digestPattern.test(value.ledgerHeadSha256)
    || typeof value.compacted !== 'boolean'
  ) throw new Error('Rust kernel returned an invalid memory operation result.');
  if (value.activeObservation !== undefined) validateObservation(value.activeObservation, expectedScope);
  if (value.grant !== undefined) validateGrant(value.grant);
  if (value.activeObservation === undefined
    && value.grant === undefined
    && value.status !== 'auto_capture_undone') {
    throw new Error('Rust kernel returned a memory operation without an authoritative result.');
  }
  return candidate as MemoryOperationResult;
};

export class MemoryRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MemoryRuntimeError';
    this.code = code;
  }
}

export class RustMemoryRuntime implements MemoryCaptureRuntime {
  readonly #options: RustMemoryRuntimeOptions;

  constructor(options: RustMemoryRuntimeOptions) {
    if (options.engineRoot.trim().length === 0 || options.workspaceRoot.trim().length === 0) {
      throw new Error('Memory engine and workspace roots must not be empty.');
    }
    if (options.actorId.trim().length === 0) throw new Error('Memory actor ID must not be empty.');
    this.#options = options;
  }

  remember(statement: string, observedAtMillis = this.#now()): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'remember',
      statement,
      actorId: this.#options.actorId,
      observedAtMillis,
    });
  }

  inspect(includeRecovery = false): Promise<MemoryInspection> {
    return this.#execute({ operation: 'inspect', includeRecovery, asOfMillis: this.#now() }).then((outcome) => {
      if (outcome.kind !== 'inspection') throw new Error('Rust kernel returned an operation for memory inspection.');
      return outcome.inspection;
    });
  }

  correct(
    targetObservationId: string,
    replacementStatement: string,
    disposition: MemoryCorrectionDisposition,
    occurredAtMillis = this.#now(),
  ): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'correct',
      targetObservationId,
      replacementStatement,
      actorId: this.#options.actorId,
      disposition,
      occurredAtMillis,
    });
  }

  restore(targetObservationId: string, occurredAtMillis = this.#now()): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'restore',
      targetObservationId,
      occurredAtMillis,
    });
  }

  setCaptureMode(
    mode: MemoryCaptureMode,
    grantScope: MemoryGrantScope,
    occurredAtMillis = this.#now(),
  ): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'set_capture_mode',
      mode,
      actorId: this.#options.actorId,
      grantScope,
      occurredAtMillis,
    });
  }

  rememberPreference(statement: string, observedAtMillis = this.#now()): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'remember_preference',
      statement,
      actorId: this.#options.actorId,
      observedAtMillis,
    });
  }

  revokeGrant(grantId: string, occurredAtMillis = this.#now()): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'revoke_grant',
      grantId,
      actorId: this.#options.actorId,
      occurredAtMillis,
    });
  }

  autoCapture(
    statement: string,
    grantId: string,
    grantScope: MemoryGrantScope,
    observedAtMillis = this.#now(),
  ): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'auto_capture',
      statement,
      actorId: this.#options.actorId,
      grantId,
      grantScope,
      observedAtMillis,
    });
  }

  undoAutoCapture(
    targetObservationId: string,
    grantId: string,
    occurredAtMillis = this.#now(),
  ): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'undo_auto_capture',
      targetObservationId,
      grantId,
      actorId: this.#options.actorId,
      occurredAtMillis,
    });
  }

  async #operation(action: Readonly<Record<string, unknown>>): Promise<MemoryOperationResult> {
    const outcome = await this.#execute(action);
    if (outcome.kind !== 'operation') throw new Error('Rust kernel returned an inspection for a memory operation.');
    return outcome.result;
  }

  #now(): number {
    const value = this.#options.clock?.() ?? Date.now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Memory clock returned an invalid timestamp.');
    return value;
  }

  async #execute(action: Readonly<Record<string, unknown>>): Promise<MemoryRuntimeOutcome> {
    const requestId = this.#options.requestIdFactory?.() ?? `memory:${randomUUID()}`;
    const timeoutMs = this.#options.timeoutMs ?? 5_000;
    return new Promise<MemoryRuntimeOutcome>((resolve, reject) => {
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
      const finish = (error?: Error, outcome?: MemoryRuntimeOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error !== undefined) reject(error);
        else if (outcome !== undefined) resolve(outcome);
        else reject(new Error('Memory request ended without a result.'));
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error(`Memory request exceeded ${timeoutMs} ms.`));
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        const chunkBytes = Buffer.byteLength(chunk, 'utf8');
        if (stdoutBytes + chunkBytes > maximumOutputBytes) {
          child.kill();
          finish(new Error('Memory request exceeded its output byte limit.'));
          return;
        }
        stdoutBytes += chunkBytes;
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 65_536) stderr += chunk.slice(0, 65_536 - stderr.length);
      });
      child.once('error', (error) => finish(new Error(`Rust kernel failed to start: ${error.message}`)));
      child.once('close', (code) => {
        if (settled) return;
        try {
          const frames = stdout.trim().split(/\r?\n/u);
          if (frames.length !== 1 || frames[0] === undefined || frames[0].length === 0) {
            throw new Error('expected exactly one result frame');
          }
          const frame = object(JSON.parse(frames[0]) as unknown);
          if (code !== 0) {
            if (frame?.type === 'protocol.error'
              && frame.protocolVersion === rustMemoryProtocolVersion
              && (frame.requestId === undefined || frame.requestId === requestId)
              && typeof frame.code === 'string'
              && typeof frame.message === 'string') {
              finish(new MemoryRuntimeError(frame.code, frame.message));
              return;
            }
            const detail = stderr.trim();
            finish(new Error(`Memory request failed with code ${String(code)}${detail.length === 0 ? '.' : `: ${detail}`}`));
            return;
          }
          if (frame?.type !== 'memory.result'
            || frame.protocolVersion !== rustMemoryProtocolVersion
            || frame.requestId !== requestId) throw new Error('result frame does not match the memory protocol');
          const outcome = object(frame.outcome);
          if (outcome?.kind === 'inspection') {
            finish(undefined, {
              kind: 'inspection',
              inspection: validateInspection(outcome.inspection, this.#options.scope),
            });
            return;
          }
          if (outcome?.kind === 'operation') {
            finish(undefined, {
              kind: 'operation',
              result: validateOperation(outcome.result, this.#options.scope),
            });
            return;
          }
          throw new Error('memory outcome kind is invalid');
        } catch (error) {
          finish(new Error(`Rust kernel returned invalid memory output: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
      child.stdin.on('error', () => {
        // Launch and exit handlers provide the actionable failure.
      });
      const request = JSON.stringify({
        type: 'memory.execute',
        protocolVersion: rustMemoryProtocolVersion,
        requestId,
        engineRoot: this.#options.engineRoot,
        workspaceRoot: this.#options.workspaceRoot,
        scope: this.#options.scope,
        action,
      });
      if (Buffer.byteLength(request, 'utf8') > 256 * 1_024) {
        child.kill();
        finish(new Error('Memory request exceeds the 256 KiB input byte limit.'));
        return;
      }
      child.stdin.end(request + '\n');
    });
  }
}
