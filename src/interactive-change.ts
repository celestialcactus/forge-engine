import { randomUUID } from 'node:crypto';
import type { ApprovalFacts, CapabilityCall } from './slice0/contracts.js';
import {
  renderInteractiveChangePlan,
  validatePreparedChangePlan,
  type InteractiveChangePlan,
} from './change-workflow.js';
import type {
  RustSovereignChangeRuntime,
  SovereignCoordinatorArtifact,
  SovereignProposalArtifact,
} from './hybrid/rust-sovereign-change-runtime.js';
import type { CapabilityRecoveryCheckpoint } from './slice0/contracts.js';

export interface InteractiveChangeIo {
  question(prompt: string, signal?: AbortSignal): Promise<string | undefined>;
  write(line: string): void;
}

export interface InteractiveChangeExecutionResult {
  readonly planningRunId: string;
  readonly status:
    | 'declined'
    | 'cancelled'
    | 'failed'
    | 'verification_failed'
    | 'accepted'
    | 'discarded'
    | 'retained';
  readonly changeSetId: string;
  readonly transactionId?: string;
  readonly proposal?: SovereignProposalArtifact;
  readonly transaction?: SovereignCoordinatorArtifact;
}

export interface InteractiveChangeExecutionOptions {
  readonly plan: InteractiveChangePlan;
  readonly checkIds: readonly string[];
  readonly runtime: Pick<RustSovereignChangeRuntime, 'prepare' | 'propose' | 'accept' | 'discard'>;
  readonly io: InteractiveChangeIo;
  readonly signal?: AbortSignal;
  readonly callIdFactory?: () => string;
  readonly onRecoveryCheckpoint?: (checkpoint: CapabilityRecoveryCheckpoint) => Promise<void>;
}

const approval = (
  capabilityId: string,
  input: unknown,
  reason: string,
  callIdFactory: () => string,
): { readonly call: CapabilityCall; readonly facts: ApprovalFacts } => {
  const callId = callIdFactory();
  return {
    call: { id: callId, capabilityId, input },
    facts: {
      schemaVersion: 1,
      callId,
      capabilityId,
      hostPolicy: {
        posture: 'ask',
        source: 'forge.cli.interactive-change',
        reason: 'Interactive change operations require a visible developer decision.',
      },
      userConsent: {
        status: 'granted',
        source: 'forge.cli.interactive-change',
        reason,
      },
    },
  };
};

const normalizedChoice = (value: string | undefined): string => value?.trim().toLowerCase() ?? '';
const approvedChoice = (value: string | undefined): boolean => ['y', 'yes', 'approve'].includes(normalizedChoice(value));

interface PromptAnswer {
  readonly kind: 'answer';
  readonly value: string | undefined;
}

interface PromptCancellation {
  readonly kind: 'cancelled';
  readonly reason: string;
}

const cancellationReason = (signal: AbortSignal): string => {
  const reason = signal.reason;
  return reason instanceof Error ? reason.message : reason === undefined ? 'Forge approval was cancelled.' : String(reason);
};

const askWithCancellation = async (
  io: InteractiveChangeIo,
  prompt: string,
  signal: AbortSignal,
): Promise<PromptAnswer | PromptCancellation> => {
  if (signal.aborted) return { kind: 'cancelled', reason: cancellationReason(signal) };
  return new Promise<PromptAnswer | PromptCancellation>((resolve, reject) => {
    let settled = false;
    let onAbort: () => void = () => {};
    const finish = (result: PromptAnswer | PromptCancellation): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    onAbort = () => finish({ kind: 'cancelled', reason: cancellationReason(signal) });
    signal.addEventListener('abort', onAbort, { once: true });
    void io.question(prompt, signal).then(
      (value) => signal.aborted
        ? onAbort()
        : finish({ kind: 'answer', value }),
      (error: unknown) => {
        if (signal.aborted) onAbort();
        else {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      },
    );
    if (signal.aborted) onAbort();
  });
};

const writeVerification = (io: InteractiveChangeIo, proposal: SovereignProposalArtifact): void => {
  io.write(`[forge] candidate status=${proposal.status}; outcome=${proposal.outcome.status}`);
  for (const raw of proposal.verification) {
    const evidence = raw as Record<string, unknown>;
    io.write(
      `[forge] verify ${String(evidence.checkId ?? 'unknown')}: success=${String(evidence.success ?? false)}`
      + ` exit=${String(evidence.exitCode ?? 'none')}`
      + ` timeout=${String(evidence.timedOut ?? false)}`
      + ` cancelled=${String(evidence.cancelled ?? false)}`,
    );
    if (evidence.success !== true) {
      if (typeof evidence.stdout === 'string' && evidence.stdout.length > 0) io.write(evidence.stdout);
      if (typeof evidence.stderr === 'string' && evidence.stderr.length > 0) io.write(evidence.stderr);
    }
  }
  if (proposal.failure !== undefined) io.write('[forge] change failure: ' + proposal.failure);
};

export async function executeInteractiveChangePlan(
  options: InteractiveChangeExecutionOptions,
): Promise<InteractiveChangeExecutionResult> {
  if (options.checkIds.length === 0) throw new Error('Interactive change execution requires at least one verifier.');
  const signal = options.signal ?? new AbortController().signal;
  const callIdFactory = options.callIdFactory ?? (() => `forge-cli:${randomUUID()}`);
  signal.throwIfAborted();
  const prepared = await options.runtime.prepare(options.plan.sovereignProposal);
  validatePreparedChangePlan(options.plan, prepared);
  for (const line of renderInteractiveChangePlan(options.plan, prepared, options.checkIds)) {
    options.io.write(line);
  }
  const consent = await askWithCancellation(
    options.io,
    'Apply this exact change in an isolated candidate and run verification? [y/N] ',
    signal,
  );
  if (consent.kind === 'cancelled') {
    options.io.write(`[forge] change cancelled before candidate execution: ${consent.reason}`);
    return {
      planningRunId: options.plan.planningRunId,
      status: 'cancelled',
      changeSetId: prepared.changeSetId,
    };
  }
  if (!approvedChoice(consent.value)) {
    options.io.write('[forge] change declined; no candidate or workspace mutation was requested.');
    return {
      planningRunId: options.plan.planningRunId,
      status: 'declined',
      changeSetId: prepared.changeSetId,
    };
  }

  const executeInput = { changeSetId: prepared.changeSetId, selectedCheckIds: options.checkIds };
  const executeApproval = approval(
    'workspace.change.propose',
    executeInput,
    `The developer approved prepared ChangeSet ${prepared.changeSetId}.`,
    callIdFactory,
  );
  const proposal = await options.runtime.propose(
    options.plan.sovereignProposal,
    prepared.changeSetId,
    options.checkIds,
    executeApproval.call,
    executeApproval.facts,
    signal,
  );
  writeVerification(options.io, proposal);
  if (proposal.status !== 'verified_candidate') {
    return {
      planningRunId: options.plan.planningRunId,
      status: proposal.status,
      changeSetId: prepared.changeSetId,
      proposal,
    };
  }
  if (proposal.outcome.status !== 'verified') {
    options.io.write('[forge] verified-candidate lifecycle was not outcome-verified; promotion is blocked.');
    return {
      planningRunId: options.plan.planningRunId,
      status: 'failed',
      changeSetId: prepared.changeSetId,
      proposal,
    };
  }
  const transactionId = proposal.transaction?.transactionId;
  if (transactionId === undefined) {
    throw new Error('Verified candidate did not retain a durable transaction ID.');
  }
  await options.onRecoveryCheckpoint?.({
    schemaVersion: 1,
    kind: 'change_set_transaction',
    changeSetId: prepared.changeSetId,
    transactionId,
    phase: 'registered',
  });

  options.io.write(`[forge] verified candidate transaction=${transactionId}; awaiting explicit promotion or discard.`);
  const promotionChoice = await askWithCancellation(
    options.io,
    'Candidate verified. [a]ccept into workspace, [d]iscard, or [k]eep for later? ',
    signal,
  );
  if (promotionChoice.kind === 'cancelled') {
    options.io.write(`[forge] transaction ${transactionId} retained after cancellation: ${promotionChoice.reason}`);
    return {
      planningRunId: options.plan.planningRunId,
      status: 'cancelled',
      changeSetId: prepared.changeSetId,
      transactionId,
      proposal,
    };
  }
  const choice = normalizedChoice(promotionChoice.value);
  if (choice === 'a' || choice === 'accept' || choice === 'y' || choice === 'yes') {
    const exact = approval(
      'workspace.change.accept',
      { transactionId },
      `The developer approved promotion of transaction ${transactionId}.`,
      callIdFactory,
    );
    const transaction = await options.runtime.accept(transactionId, exact.call, exact.facts, signal);
    options.io.write(`[forge] transaction ${transactionId}: ${transaction.state}`);
    if (transaction.state !== 'promoted') {
      throw new Error(`Rust did not confirm promotion for transaction ${transactionId}; state=${transaction.state}.`);
    }
    return {
      planningRunId: options.plan.planningRunId,
      status: 'accepted',
      changeSetId: prepared.changeSetId,
      transactionId,
      proposal,
      transaction,
    };
  }
  if (choice === 'd' || choice === 'discard' || choice === 'n' || choice === 'no') {
    const exact = approval(
      'workspace.change.discard',
      { transactionId },
      `The developer approved discard of transaction ${transactionId}.`,
      callIdFactory,
    );
    const transaction = await options.runtime.discard(transactionId, exact.call, exact.facts, signal);
    options.io.write(`[forge] transaction ${transactionId}: ${transaction.state}`);
    if (transaction.state !== 'discarded') {
      throw new Error(`Rust did not confirm discard for transaction ${transactionId}; state=${transaction.state}.`);
    }
    return {
      planningRunId: options.plan.planningRunId,
      status: 'discarded',
      changeSetId: prepared.changeSetId,
      transactionId,
      proposal,
      transaction,
    };
  }
  options.io.write(`[forge] transaction ${transactionId} retained; use forge change inspect/accept/discard to resume.`);
  return {
    planningRunId: options.plan.planningRunId,
    status: 'retained',
    changeSetId: prepared.changeSetId,
    transactionId,
    proposal,
  };
}