import type {
  MemoryCaptureMode,
  MemoryCaptureRuntime,
  MemoryGrantScope,
  MemoryOperationResult,
  MemoryStandingGrant,
} from './contracts.js';

export type MemoryCaptureSource = 'developer_input' | 'model_output' | 'tool_output' | 'repository_text';

export type MemoryCaptureEligibility =
  | { readonly eligible: true; readonly statement: string }
  | {
      readonly eligible: false;
      readonly reason: 'ambiguous' | 'not_candidate' | 'ineligible_source' | 'sensitive' | 'authority_change' | 'unbounded';
    };

export type MemoryCaptureIneligibleReason = Exclude<MemoryCaptureEligibility, { readonly eligible: true }>['reason'];

export interface AutoSaveReceipt {
  readonly observationId: string;
  readonly grantId: string;
  readonly statement: string;
}

export type MemoryCaptureOutcome =
  | { readonly kind: 'off' }
  | { readonly kind: 'ineligible'; readonly reason: MemoryCaptureIneligibleReason }
  | { readonly kind: 'proposal'; readonly statement: string }
  | { readonly kind: 'declined'; readonly statement: string }
  | { readonly kind: 'remembered'; readonly result: MemoryOperationResult; readonly receipt?: AutoSaveReceipt };

const explicitPreference = /^(?:i prefer|my preference is)\s+\S/iu;
const boundedAutomaticPreference = /^(?:i prefer|my preference is)\s+(?:(?:concise|brief|detailed|verbose|quiet|plain|colorized)\s+(?:test\s+output|responses?|explanations?|diagnostics)|(?:tabs|spaces)(?:\s+for\s+indentation)?|(?:single|double)\s+quotes?)\.?$/iu;
const ambiguousPreference = /^(?:always\b|please\s+(?:always\b|use\b)|use\s+\S)/iu;
const sensitiveMarker = /(?:\b(?:secret|password|passphrase|credential|api[\s_-]*key|access[\s_-]*key|private[\s_-]*key|bearer|authorization|session[\s_-]*token)\b|\bsk-[a-z0-9_-]+|\bgh[pousr]_[a-z0-9_]+|\bAKIA[A-Z0-9]+|-----BEGIN\s+[^-]*PRIVATE\s+KEY-----|\beyJ[a-zA-Z0-9_-]{12,}\.)/iu;
const authorityMarker = /\b(?:approval|permission|capability|sandbox|policy|governance|administrator|sudo|execute|shell|ignore\s+(?:all\s+)?instructions?)\b/iu;
const structuredOrRemoteMaterial = /(?:https?:\/\/|[A-Za-z]:\\|\$\{|```|[\u0000-\u001f\u007f\u2028\u2029]|\w+\s*=\s*\S)/u;
const opaqueToken = /\b[A-Za-z0-9_+/=-]{24,}\b/u;

export const classifyMemoryCaptureCandidate = (
  input: string,
  source: MemoryCaptureSource = 'developer_input',
): MemoryCaptureEligibility => {
  if (source !== 'developer_input') return { eligible: false, reason: 'ineligible_source' };
  const statement = input.trim();
  if (statement.length === 0 || Buffer.byteLength(statement, 'utf8') > 512) {
    return { eligible: false, reason: 'unbounded' };
  }
  if (sensitiveMarker.test(statement) || structuredOrRemoteMaterial.test(statement) || opaqueToken.test(statement)) {
    return { eligible: false, reason: 'sensitive' };
  }
  if (authorityMarker.test(statement)) return { eligible: false, reason: 'authority_change' };
  if (boundedAutomaticPreference.test(statement)) return { eligible: true, statement };
  return {
    eligible: false,
    reason: explicitPreference.test(statement) || ambiguousPreference.test(statement)
      ? 'ambiguous'
      : 'not_candidate',
  };
};

export class MemoryAutoSaveController {
  readonly #runtime: MemoryCaptureRuntime;
  readonly #grantScope: MemoryGrantScope;

  constructor(runtime: MemoryCaptureRuntime, grantScope: MemoryGrantScope) {
    this.#runtime = runtime;
    this.#grantScope = grantScope;
  }

  async state(): Promise<{ readonly mode: MemoryCaptureMode; readonly grant?: MemoryStandingGrant }> {
    const inspection = await this.#runtime.inspect(false);
    const grant = inspection.grants?.find((candidate) =>
      candidate.revokedAtMillis === undefined && sameScope(candidate.scope, this.#grantScope));
    return grant === undefined ? { mode: 'ask' } : { mode: grant.mode, grant };
  }

  setMode(mode: MemoryCaptureMode): Promise<MemoryOperationResult> {
    return this.#runtime.setCaptureMode(mode, this.#grantScope);
  }

  async captureDirectInput(
    input: string,
    approve?: (statement: string) => Promise<boolean>,
  ): Promise<MemoryCaptureOutcome> {
    const eligibility = classifyMemoryCaptureCandidate(input);
    if (!eligibility.eligible && eligibility.reason !== 'ambiguous') {
      return { kind: 'ineligible', reason: eligibility.reason };
    }
    const state = await this.state();
    if (state.mode === 'off') return { kind: 'off' };
    if (!eligibility.eligible || state.mode === 'ask') {
      const statement = eligibility.eligible ? eligibility.statement : input.trim();
      if (approve === undefined) return { kind: 'proposal', statement };
      if (!await approve(statement)) return { kind: 'declined', statement };
      const result = await this.#runtime.rememberPreference(statement);
      return { kind: 'remembered', result };
    }
    if (state.grant === undefined) throw new Error('Auto memory capture has no active standing grant.');
    const result = await this.#runtime.autoCapture(
      eligibility.statement,
      state.grant.grantId,
      this.#grantScope,
    );
    const observation = result.activeObservation;
    if (observation === undefined) throw new Error('Auto memory capture returned no admitted observation.');
    return {
      kind: 'remembered',
      result,
      receipt: {
        observationId: observation.observationId,
        grantId: state.grant.grantId,
        statement: observation.statement,
      },
    };
  }

  undo(receipt: AutoSaveReceipt): Promise<MemoryOperationResult> {
    return this.#runtime.undoAutoCapture(receipt.observationId, receipt.grantId);
  }
}

const sameScope = (left: MemoryGrantScope, right: MemoryGrantScope): boolean => {
  if (left.kind !== right.kind) return false;
  return left.kind === 'repository' && right.kind === 'repository'
    ? left.workspaceId === right.workspaceId && left.repositoryId === right.repositoryId
    : left.kind === 'developer' && right.kind === 'developer' && left.actorId === right.actorId;
};
