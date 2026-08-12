import type {
  Capability,
  CapabilityContextBasis,
  CapabilityResult,
} from './slice0/contracts.js';
import {
  buildInteractiveChangePlan,
  type PlannedReplacement,
} from './change-workflow.js';
import {
  executeInteractiveChangePlan,
  type InteractiveChangeExecutionResult,
  type InteractiveChangeIo,
} from './interactive-change.js';
import type {
  RustSovereignChangeRuntime,
  SovereignCoordinatorArtifact,
  SovereignProposalArtifact,
} from './hybrid/rust-sovereign-change-runtime.js';
import { createChangeProposalCapability } from './v1/change-proposal.js';

export const governedChangeEvidenceKind = 'forge.workspace.change.execution.v1';

export interface GovernedChangeReviewEvidence {
  readonly proposalId: string;
  readonly snapshotId: string;
  readonly changes: readonly Omit<PlannedReplacement, 'replacementText'>[];
}

export interface GovernedChangeExecutionEvidence {
  readonly schemaVersion: 1;
  readonly status: InteractiveChangeExecutionResult['status'];
  readonly planningRunId: string;
  readonly basis: CapabilityContextBasis;
  readonly review: GovernedChangeReviewEvidence;
  readonly changeSetId: string;
  readonly transactionId?: string;
  readonly workspacePromoted: boolean;
  readonly proposal?: Pick<
    SovereignProposalArtifact,
    'schemaVersion' | 'status' | 'verification' | 'approval' | 'outcome' | 'candidateCleanup' | 'failure'
  >;
  readonly transaction?: SovereignCoordinatorArtifact;
}

export interface GovernedChangeCapabilityOptions {
  readonly checkIds: readonly string[];
  readonly runtime: Pick<RustSovereignChangeRuntime, 'prepare' | 'propose' | 'accept' | 'discard'>;
  readonly io: InteractiveChangeIo;
}

const publicChange = (
  change: PlannedReplacement,
): Omit<PlannedReplacement, 'replacementText'> => {
  const { replacementText: _replacementText, ...reviewed } = change;
  return reviewed;
};

const proposalEvidence = (
  proposal: SovereignProposalArtifact | undefined,
): GovernedChangeExecutionEvidence['proposal'] => proposal === undefined
  ? undefined
  : {
      schemaVersion: proposal.schemaVersion,
      status: proposal.status,
      verification: proposal.verification,
      approval: proposal.approval,
      outcome: proposal.outcome,
      ...(proposal.candidateCleanup === undefined ? {} : { candidateCleanup: proposal.candidateCleanup }),
      ...(proposal.failure === undefined ? {} : { failure: proposal.failure }),
    };

const completedGovernance = (status: InteractiveChangeExecutionResult['status']): boolean =>
  status !== 'failed' && status !== 'verification_failed' && status !== 'cancelled';

export const createGovernedChangeCapability = (
  workspaceRoot: string,
  options: GovernedChangeCapabilityOptions,
): Capability => {
  if (options.checkIds.length === 0) {
    throw new Error('Governed change capability requires at least one verification check.');
  }
  if (new Set(options.checkIds).size !== options.checkIds.length) {
    throw new Error('Governed change capability verification check IDs must be unique.');
  }
  const planner = createChangeProposalCapability(workspaceRoot, { modelInput: true });
  return {
    id: 'workspace.change.execute',
    replaySafety: 'non_idempotent',
    async invoke(call, snapshot, signal, context, observer): Promise<CapabilityResult> {
      if (context.basis.snapshotId !== snapshot.id || context.basis.runId.length === 0) {
        throw new Error('Governed change capability received mismatched Rust lifecycle context.');
      }
      const planResult = await planner.invoke(
        { ...call, capabilityId: 'workspace.change.plan' },
        snapshot,
        signal,
        context,
      );
      const plan = buildInteractiveChangePlan({
        runId: context.basis.runId,
        snapshotId: snapshot.id,
        call,
        result: planResult,
        priorObservations: context.priorObservations,
      });
      const execution = await executeInteractiveChangePlan({
        plan,
        checkIds: options.checkIds,
        runtime: options.runtime,
        io: options.io,
        signal,
        ...(observer === undefined ? {} : { onRecoveryCheckpoint: observer.checkpoint }),
      });
      const transaction = execution.transaction ?? execution.proposal?.transaction;
      const evidence: GovernedChangeExecutionEvidence = {
        schemaVersion: 1,
        status: execution.status,
        planningRunId: execution.planningRunId,
        basis: context.basis,
        review: {
          proposalId: plan.proposalId,
          snapshotId: plan.snapshotId,
          changes: plan.changes.map(publicChange),
        },
        changeSetId: execution.changeSetId,
        ...(execution.transactionId === undefined ? {} : { transactionId: execution.transactionId }),
        workspacePromoted: execution.status === 'accepted',
        ...(execution.proposal === undefined ? {} : { proposal: proposalEvidence(execution.proposal)! }),
        ...(transaction === undefined ? {} : { transaction }),
      };
      const affected = plan.changes.map((change) => change.path).join(', ');
      return {
        callId: call.id,
        success: completedGovernance(execution.status),
        content: [
          `Forge governed change status=${execution.status}.`,
          `Workspace promoted=${String(evidence.workspacePromoted)}.`,
          `Reviewed paths: ${affected}.`,
          `ChangeSet: ${execution.changeSetId}.`,
          execution.transactionId === undefined ? 'Transaction: none.' : `Transaction: ${execution.transactionId}.`,
          'Report this status exactly; do not claim the workspace changed unless workspace promoted is true.',
        ].join(' '),
        evidence: {
          schemaVersion: 1,
          kind: governedChangeEvidenceKind,
          data: evidence,
        },
      };
    },
  };
};
