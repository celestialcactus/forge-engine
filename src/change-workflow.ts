import { createHash } from 'node:crypto';
import type { RunArtifact } from './slice0/contracts.js';
import type { ChangeProposalArtifact, TextChangeRequest } from './v1/change-proposal.js';
import type {
  SovereignChangeProposal,
  SovereignPreparedArtifact,
} from './hybrid/rust-sovereign-change-runtime.js';

type JsonRecord = Record<string, unknown>;

export interface PlannedReplacement extends TextChangeRequest {
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly diff: string;
}

export interface InteractiveChangePlan {
  readonly planningRunId: string;
  readonly proposalId: string;
  readonly snapshotId: string;
  readonly changes: readonly PlannedReplacement[];
  readonly sovereignProposal: SovereignChangeProposal;
}

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;

const sha256 = (value: string): string =>
  createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');

const parsePlanEvidence = (content: string): ChangeProposalArtifact => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content) as unknown;
  } catch {
    throw new Error('Forge change-plan evidence is not valid JSON.');
  }
  const candidate = asRecord(decoded);
  if (candidate?.schemaVersion !== 1
    || typeof candidate.proposalId !== 'string'
    || typeof candidate.snapshotId !== 'string'
    || candidate.status !== 'ready'
    || candidate.mutatesWorkspace !== false
    || candidate.approvalRequiredBeforeApply !== true
    || !Array.isArray(candidate.changes)
    || !Array.isArray(candidate.conflicts)
    || candidate.conflicts.length !== 0) {
    throw new Error('Forge change-plan evidence is not a ready non-mutating proposal.');
  }
  return candidate as unknown as ChangeProposalArtifact;
};

type RetainedChangeRequest = Omit<TextChangeRequest, 'expectedSha256'> & {
  readonly expectedSha256?: string;
};

const parseRequests = (input: unknown): readonly RetainedChangeRequest[] => {
  const record = asRecord(input);
  if (!Array.isArray(record?.changes)) {
    throw new Error('Forge change-plan call did not retain replacement requests.');
  }
  return record.changes.map((candidate, index) => {
    const change = asRecord(candidate);
    const retainedText = typeof change?.content === 'string'
      ? change.content
      : change?.replacementText;
    if (typeof change?.path !== 'string'
      || (change.expectedSha256 !== undefined && typeof change.expectedSha256 !== 'string')
      || typeof retainedText !== 'string'
      || (change.content !== undefined && change.replacementText !== undefined)) {
      throw new Error(`Forge change-plan request ${index + 1} is incomplete or ambiguous.`);
    }
    return {
      path: change.path,
      ...(change.expectedSha256 === undefined ? {} : { expectedSha256: change.expectedSha256 }),
      replacementText: retainedText,
    };
  });
};

interface ReadRangeEvidence {
  readonly path: string;
  readonly snapshotId: string;
  readonly sha256: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
}

const parseReadRange = (content: string): ReadRangeEvidence | undefined => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
  const evidence = asRecord(decoded);
  if (typeof evidence?.path !== 'string'
    || typeof evidence.snapshotId !== 'string'
    || typeof evidence.sha256 !== 'string'
    || !Number.isSafeInteger(evidence.startLine)
    || !Number.isSafeInteger(evidence.endLine)
    || !Number.isSafeInteger(evidence.totalLines)
    || Number(evidence.startLine) < 1
    || Number(evidence.totalLines) < 1
    || Number(evidence.endLine) < Number(evidence.startLine) - 1
    || Number(evidence.endLine) > Number(evidence.totalLines)) return undefined;
  return evidence as unknown as ReadRangeEvidence;
};

const assertCompletePriorRead = (
  artifact: RunArtifact,
  planSequence: number,
  change: PlannedReplacement,
): void => {
  const priorReadCallIds = new Set(artifact.events.flatMap((event) =>
    event.sequence < planSequence
      && event.type === 'capability.requested'
      && event.call.capabilityId === 'workspace.read'
      ? [event.call.id]
      : []));
  const ranges = artifact.events.flatMap((event): readonly ReadRangeEvidence[] => {
    if (event.sequence >= planSequence
      || event.type !== 'capability.completed'
      || !event.result.success
      || !priorReadCallIds.has(event.result.callId)) return [];
    const range = parseReadRange(event.result.content);
    return range === undefined
      || range.path !== change.path
      || range.snapshotId !== artifact.snapshot.id
      || range.sha256 !== change.beforeSha256
      ? []
      : [range];
  }).sort((left, right) => left.startLine - right.startLine);
  const totalLines = ranges[0]?.totalLines;
  let coveredThrough = 0;
  for (const range of ranges) {
    if (range.totalLines !== totalLines || range.startLine > coveredThrough + 1) break;
    coveredThrough = Math.max(coveredThrough, range.endLine);
  }
  if (totalLines === undefined || coveredThrough < totalLines) {
    throw new Error(`Forge refuses approval because prior read evidence does not cover the complete target: ${change.path}`);
  }
};

export const extractInteractiveChangePlan = (artifact: RunArtifact): InteractiveChangePlan | undefined => {
  const requests = artifact.events.filter((event) =>
    event.type === 'capability.requested'
      && event.call.capabilityId === 'workspace.change.plan');
  if (requests.length === 0) return undefined;
  if (requests.length !== 1) {
    throw new Error('Interactive Forge accepts exactly one change plan per prompt.');
  }
  if (artifact.status !== 'completed') {
    throw new Error('Forge will not execute a change plan from an incomplete planning run.');
  }
  const requested = requests[0];
  if (requested?.type !== 'capability.requested') {
    throw new Error('Forge change-plan event correlation failed.');
  }
  const result = artifact.capabilityResults.find((candidate) => candidate.callId === requested.call.id);
  if (result === undefined || !result.success) {
    throw new Error('Forge change planning did not produce successful evidence.');
  }
  const evidence = parsePlanEvidence(result.content);
  if (evidence.snapshotId !== artifact.snapshot.id) {
    throw new Error('Forge change-plan evidence does not match the planning workspace snapshot.');
  }
  const inputs = parseRequests(requested.call.input);
  const changes = evidence.changes.map((change): PlannedReplacement => {
    if (change.truncated) {
      throw new Error(`Forge refuses approval because the review diff is truncated: ${change.path}`);
    }
    const input = inputs.find((candidate) => candidate.path === change.path);
    if (input === undefined
      || (input.expectedSha256 !== undefined && input.expectedSha256 !== change.beforeSha256)
      || sha256(input.replacementText) !== change.afterSha256) {
      throw new Error(`Forge change-plan evidence does not bind the retained replacement: ${change.path}`);
    }
    const planned = {
      ...input,
      expectedSha256: change.beforeSha256,
      beforeSha256: change.beforeSha256,
      afterSha256: change.afterSha256,
      beforeBytes: change.beforeBytes,
      afterBytes: change.afterBytes,
      diff: change.diff,
    };
    assertCompletePriorRead(artifact, requested.sequence, planned);
    return planned;
  });
  if (changes.length === 0) throw new Error('Forge change plan contains no effective changes.');
  return {
    planningRunId: artifact.runId,
    proposalId: evidence.proposalId,
    snapshotId: evidence.snapshotId,
    changes,
    sovereignProposal: {
      schemaVersion: 1,
      operations: changes.map((change) => ({
        kind: 'replace',
        path: change.path,
        after: { encoding: 'utf8', value: change.replacementText },
      })),
    },
  };
};

export const validatePreparedChangePlan = (
  plan: InteractiveChangePlan,
  prepared: SovereignPreparedArtifact,
): void => {
  if (prepared.operations.length !== plan.changes.length) {
    throw new Error('Rust prepared a different number of operations than the reviewed plan.');
  }
  for (const [index, change] of plan.changes.entries()) {
    const operation = asRecord(prepared.operations[index]);
    const after = asRecord(operation?.after);
    if (operation?.kind !== 'replace'
      || operation.path !== change.path
      || operation.beforeSha256 !== change.beforeSha256
      || after?.sha256 !== change.afterSha256
      || after.bytes !== change.afterBytes
      || after.contentKind !== 'utf8_text') {
      throw new Error(`Rust prepared operation does not match the reviewed plan: ${change.path}`);
    }
  }
};

export const renderInteractiveChangePlan = (
  plan: InteractiveChangePlan,
  prepared: SovereignPreparedArtifact,
  checkIds: readonly string[],
): readonly string[] => [
  `[forge] review change ${prepared.changeSetId}`,
  `[forge] planning run ${plan.planningRunId}; proposal ${plan.proposalId}`,
  `[forge] verification ${checkIds.join(', ')}`,
  ...plan.changes.flatMap((change) => [
    `[forge] ${change.path} (${change.beforeBytes} -> ${change.afterBytes} bytes)`,
    change.diff,
  ]),
];