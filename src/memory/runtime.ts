import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type {
  MemoryCaptureMode,
  MemoryCaptureRuntime,
  MemoryCorrectionDisposition,
  MemoryContextPreview,
  MemoryContextPreviewOmission,
  MemoryContextPreviewOmissionReason,
  MemoryContextPreviewScopeHead,
  MemoryContextPreviewSelection,
  MemoryGrantScope,
  MemoryInspection,
  MemoryObservation,
  MemoryOperationResult,
  MemoryPreviewRuntime,
  MemoryNonContentReceipt,
  MemoryRuntimeOutcome,
  MemoryScope,
  MemoryStandingGrant,
  ProjectedMemory,
  RecoveryMemory,
} from './contracts.js';
import {
  defaultMemoryContextPreviewBudgetBytes,
  maximumMemoryContextPreviewBudgetBytes,
  rustMemoryProtocolVersion,
} from './contracts.js';

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
const contextPreviewIdPattern = /^memory_context_preview:v1:sha256:[a-f0-9]{64}$/u;
const contextPreviewOmissionReasons = new Set<MemoryContextPreviewOmissionReason>([
  'observation_not_yet_effective',
  'declared_contradiction',
  'inferred_hypothesis',
  'source_not_eligible',
  'explicit_validity_expired',
  'evidence_currentness_unavailable',
  'run_context_unavailable',
  'budget_exceeded',
]);

const containsForbiddenMemoryControl = (value: string): boolean =>
  [...value].some((character) => character !== '\n' && /\p{Cc}/u.test(character));

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const sameScope = (candidate: unknown, expected: MemoryScope): candidate is MemoryScope => {
  const value = object(candidate);
  if (expected.kind === 'repository') {
    return value?.kind === 'repository'
      && value.workspaceId === expected.workspaceId
      && value.repositoryId === expected.repositoryId;
  }
  return value?.kind === 'developer' && value.actorId === expected.actorId;
};

const allowedPreviewScope = (
  candidate: unknown,
  requestedScope: MemoryScope,
  actorId: string,
): candidate is MemoryScope => sameScope(candidate, requestedScope)
  || sameScope(candidate, { kind: 'developer', actorId });

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
    || containsForbiddenMemoryControl(value.subject)
    || typeof value.statement !== 'string'
    || value.statement.length === 0
    || Buffer.byteLength(value.statement, 'utf8') > 8 * 1024
    || containsForbiddenMemoryControl(value.statement)
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
    || (value.replacementObservationId !== undefined
      && (typeof value.replacementObservationId !== 'string'
        || !observationIdPattern.test(value.replacementObservationId)))
    || !Number.isSafeInteger(value.replacedAtMillis)
    || Number(value.replacedAtMillis) < 0
    || !Number.isSafeInteger(value.updatedSequence)
    || Number(value.updatedSequence) < 1
  ) throw new Error('Rust kernel returned an invalid recovery memory.');
  validateObservation(value.observation, expectedScope);
  return candidate as RecoveryMemory;
};

const validateReceipt = (candidate: unknown, expectedScope: MemoryScope): MemoryNonContentReceipt => {
  const value = object(candidate);
  const forbidden = [
    'claimId', 'observationId', 'targetId', 'contentSha256', 'statement', 'subject',
  ];
  if (value?.schemaVersion !== 1
    || typeof value.operationId !== 'string'
    || !value.operationId.startsWith('memory_operation:v1:sha256:')
    || !digestPattern.test(value.operationId.slice('memory_operation:v1:sha256:'.length))
    || !Number.isSafeInteger(value.performedAtMillis)
    || Number(value.performedAtMillis) < 0
    || (value.actorId !== undefined && (typeof value.actorId !== 'string' || value.actorId.length === 0))
    || (value.purgedAtMillis !== undefined
      && (!Number.isSafeInteger(value.purgedAtMillis) || Number(value.purgedAtMillis) < 0))
    || value.scopeKind !== expectedScope.kind
    || ![
      'correction_history_erased', 'recovery_compacted', 'auto_capture_undone',
      'memory_purged', 'recovery_history_cleared',
    ].includes(String(value.reasonCode))
    || !Number.isSafeInteger(value.removedRecordCount)
    || Number(value.removedRecordCount) < 0
    || forbidden.some((key) => Object.hasOwn(value, key))) {
    throw new Error('Rust kernel returned an invalid memory receipt.');
  }
  return candidate as MemoryNonContentReceipt;
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

const validatePreviewScopeHead = (
  candidate: unknown,
  requestedScope: MemoryScope,
  actorId: string,
): MemoryContextPreviewScopeHead => {
  const value = object(candidate);
  if (Object.keys(value ?? {}).length !== 3
    || !allowedPreviewScope(value?.scope, requestedScope, actorId)
    || !Number.isSafeInteger(value.activeCount)
    || Number(value.activeCount) < 0
    || !Number.isSafeInteger(value.recoveryCount)
    || Number(value.recoveryCount) < 0
  ) throw new Error('Rust kernel returned an invalid memory preview scope head.');
  return candidate as MemoryContextPreviewScopeHead;
};

const validatePreviewSelection = (
  candidate: unknown,
  scopeHeads: readonly MemoryContextPreviewScopeHead[],
): MemoryContextPreviewSelection => {
  const value = object(candidate);
  if (value?.reason !== 'active_fresh_exact_scope'
    || !Number.isSafeInteger(value.contextBytes)
    || Number(value.contextBytes) < 1
  ) throw new Error('Rust kernel returned an invalid selected memory preview entry.');
  const entry = object(value.entry);
  const entryScope = object(object(entry?.observation)?.scope);
  const head = scopeHeads.find((candidateHead) => sameScope(entryScope, candidateHead.scope));
  if (head === undefined) throw new Error('Rust kernel selected memory outside its preview scope heads.');
  validateProjected(value.entry, head.scope);
  if (Number(value.contextBytes) !== Buffer.byteLength(JSON.stringify(value.entry), 'utf8')) {
    throw new Error('Rust kernel returned a selected memory preview entry with invalid byte accounting.');
  }
  return candidate as MemoryContextPreviewSelection;
};

const validatePreviewOmission = (
  candidate: unknown,
  scopeHeads: readonly MemoryContextPreviewScopeHead[],
): MemoryContextPreviewOmission => {
  const value = object(candidate);
  if (typeof value?.observationId !== 'string'
    || !observationIdPattern.test(value.observationId)
    || !['repository', 'developer'].includes(String(value.scopeKind))
    || !scopeHeads.some((head) => head.scope.kind === value.scopeKind)
    || typeof value.statementPreview !== 'string'
    || value.statementPreview.length === 0
    || Buffer.byteLength(value.statementPreview, 'utf8') > 120
    || value.statementPreview.includes('\n')
    || containsForbiddenMemoryControl(value.statementPreview)
    || !Number.isSafeInteger(value.contextBytes)
    || Number(value.contextBytes) < 1
    || !contextPreviewOmissionReasons.has(value.reason as MemoryContextPreviewOmissionReason)
  ) throw new Error('Rust kernel returned an invalid omitted memory preview entry.');
  return candidate as MemoryContextPreviewOmission;
};

const validateContextPreview = (
  candidate: unknown,
  requestedScope: MemoryScope,
  actorId: string,
  expectedAsOfMillis: number,
  expectedBudgetBytes: number,
): MemoryContextPreview => {
  const value = object(candidate);
  if (value?.schemaVersion !== 1
    || typeof value.previewId !== 'string'
    || !contextPreviewIdPattern.test(value.previewId)
    || !Number.isSafeInteger(value.asOfMillis)
    || Number(value.asOfMillis) < 0
    || Number(value.asOfMillis) !== expectedAsOfMillis
    || !Number.isSafeInteger(value.budgetBytes)
    || Number(value.budgetBytes) < 1
    || Number(value.budgetBytes) > maximumMemoryContextPreviewBudgetBytes
    || Number(value.budgetBytes) !== expectedBudgetBytes
    || !Number.isSafeInteger(value.selectedBytes)
    || Number(value.selectedBytes) < 0
    || Number(value.selectedBytes) > Number(value.budgetBytes)
    || !Number.isSafeInteger(value.candidateCount)
    || Number(value.candidateCount) < 0
    || !Array.isArray(value.selected)
    || !Array.isArray(value.omitted)
    || !Array.isArray(value.scopeHeads)
    || value.scopeHeads.length !== 2
    || !Number.isSafeInteger(value.forgottenExcludedCount)
    || Number(value.forgottenExcludedCount) < 0
    || !Number.isSafeInteger(value.supersededRecoveryExcludedCount)
    || Number(value.supersededRecoveryExcludedCount) < 0
    || value.retrievalActive !== false
    || value.plannerInjection !== false
    || value.providerWorkPerformed !== false
  ) throw new Error('Rust kernel returned an invalid memory context preview.');

  const scopeHeads = value.scopeHeads.map((head) =>
    validatePreviewScopeHead(head, requestedScope, actorId));
  const scopeKeys = new Set(scopeHeads.map((head) => JSON.stringify(head.scope)));
  if (requestedScope.kind !== 'repository'
    || scopeKeys.size !== scopeHeads.length
    || scopeHeads.filter((head) => sameScope(head.scope, requestedScope)).length !== 1
    || scopeHeads.filter((head) => sameScope(head.scope, { kind: 'developer', actorId })).length !== 1) {
    throw new Error('Rust kernel returned duplicate or incomplete memory preview scope heads.');
  }
  const selected = value.selected.map((entry) => validatePreviewSelection(entry, scopeHeads));
  const omitted = value.omitted.map((entry) => validatePreviewOmission(entry, scopeHeads));
  const observationIds = [
    ...selected.map((entry) => entry.entry.observation.observationId),
    ...omitted.map((entry) => entry.observationId),
  ];
  const selectedBytes = selected.reduce((sum, entry) => sum + entry.contextBytes, 0);
  const activeCount = scopeHeads.reduce((sum, head) => sum + head.activeCount, 0);
  const recoveryCount = scopeHeads.reduce((sum, head) => sum + head.recoveryCount, 0);
  if (new Set(observationIds).size !== observationIds.length
    || Number(value.selectedBytes) !== selectedBytes
    || Number(value.candidateCount) !== selected.length + omitted.length
    || Number(value.candidateCount) !== activeCount
    || Number(value.forgottenExcludedCount) + Number(value.supersededRecoveryExcludedCount) !== recoveryCount) {
    throw new Error('Rust kernel returned internally inconsistent memory context preview counts.');
  }
  const identityMaterial = {
    schemaVersion: 1,
    asOfMillis: value.asOfMillis,
    budgetBytes: value.budgetBytes,
    selectedBytes: value.selectedBytes,
    candidateCount: value.candidateCount,
    selected,
    omitted,
    scopeHeads,
    forgottenExcludedCount: value.forgottenExcludedCount,
    supersededRecoveryExcludedCount: value.supersededRecoveryExcludedCount,
    retrievalActive: false,
    plannerInjection: false,
    providerWorkPerformed: false,
  };
  const expectedPreviewId = `memory_context_preview:v1:sha256:${createHash('sha256')
    .update(canonicalJson(identityMaterial), 'utf8')
    .digest('hex')}`;
  if (value.previewId !== expectedPreviewId) {
    throw new Error('Rust kernel returned a memory context preview with an invalid identity digest.');
  }
  return candidate as MemoryContextPreview;
};

const validateOperation = (
  candidate: unknown,
  expectedScope: MemoryScope,
): MemoryOperationResult => {
  const value = object(candidate);
  if (value?.schemaVersion !== 1
    || ![
      'admitted', 'corrected', 'restored', 'forgotten', 'purged',
      'recovery_history_cleared', 'unchanged', 'capture_mode_changed',
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
  if (value.receipt !== undefined) validateReceipt(value.receipt, expectedScope);
  if (value.activeObservation === undefined
    && value.grant === undefined
    && !['auto_capture_undone', 'forgotten', 'purged', 'recovery_history_cleared'].includes(String(value.status))) {
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

export class RustMemoryRuntime implements MemoryCaptureRuntime, MemoryPreviewRuntime {
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

  preview(
    budgetBytes = defaultMemoryContextPreviewBudgetBytes,
    asOfMillis = this.#now(),
  ): Promise<MemoryContextPreview> {
    return this.#execute({
      operation: 'preview',
      actorId: this.#options.actorId,
      asOfMillis,
      budgetBytes,
    }).then((outcome) => {
      if (outcome.kind !== 'context_preview') {
        throw new Error('Rust kernel returned a non-preview outcome for memory context preview.');
      }
      return outcome.preview;
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

  forget(targetObservationId: string, occurredAtMillis = this.#now()): Promise<MemoryOperationResult> {
    return this.#operation({ operation: 'forget', targetObservationId, occurredAtMillis });
  }

  purge(targetObservationId: string, purgedAtMillis = this.#now()): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'purge',
      targetObservationId,
      actorId: this.#options.actorId,
      purgedAtMillis,
    });
  }

  clearRecoveryHistory(clearedAtMillis = this.#now()): Promise<MemoryOperationResult> {
    return this.#operation({
      operation: 'clear_recovery_history',
      actorId: this.#options.actorId,
      clearedAtMillis,
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
          if (outcome?.kind === 'context_preview') {
            if (action.operation !== 'preview'
              || !Number.isSafeInteger(action.asOfMillis)
              || !Number.isSafeInteger(action.budgetBytes)) {
              throw new Error('memory context preview result does not match its request action');
            }
            finish(undefined, {
              kind: 'context_preview',
              preview: validateContextPreview(
                outcome.preview,
                this.#options.scope,
                this.#options.actorId,
                Number(action.asOfMillis),
                Number(action.budgetBytes),
              ),
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
