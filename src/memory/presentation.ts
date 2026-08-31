import type {
  MemoryInspection,
  MemoryObservation,
  MemoryOperationResult,
  ProjectedMemory,
  RecoveryMemory,
} from './contracts.js';

export const memorySummary = (entry: ProjectedMemory | RecoveryMemory): string =>
  entry.observation.statement;

export const renderMemoryList = (
  entries: readonly (ProjectedMemory | RecoveryMemory)[],
  emptyMessage: string,
): readonly string[] => entries.length === 0
  ? [emptyMessage]
  : entries.map((entry, index) => `${index + 1}. ${memorySummary(entry)}`);

export const renderMemoryOperation = (result: MemoryOperationResult): readonly string[] => {
  if (result.activeObservation === undefined) {
    throw new Error('Memory content operation completed without an active observation.');
  }
  const verb = result.status === 'unchanged'
    ? 'Already remembered'
    : result.status === 'corrected'
      ? 'Corrected'
      : result.status === 'restored'
        ? 'Restored'
        : 'Remembered';
  return [
    `${verb} ${result.activeObservation.scope.kind === 'developer' ? 'as your developer preference' : 'for this repository'}: ${result.activeObservation.statement}`,
    `Active: ${result.activeCount}; recovery: ${result.recoveryCount}${result.compacted ? '; storage compacted' : ''}.`,
    'Next: forge memory explain <words from this memory>',
  ];
};

export const renderMemoryExplanation = (entry: ProjectedMemory): readonly string[] => {
  const observation = entry.observation;
  const provenance = observation.provenance;
  const sourceKind = typeof provenance.kind === 'string'
    ? provenance.kind.replaceAll('_', ' ')
    : 'attributable input';
  const actor = typeof provenance.actorId === 'string' ? provenance.actorId : 'recorded source';
  const developerPreference = observation.scope.kind === 'developer';
  return [
    observation.statement,
    developerPreference
      ? 'Applies to: your exact local developer identity; automatic capture, when used, was granted only for this repository.'
      : 'Applies to: this repository (exact repository scope).',
    `Why retained: ${developerPreference ? 'direct preference admitted by review or standing grant' : 'explicitly reviewed repository decision'}; freshness=${freshnessLabel(observation)}.`,
    `Source: ${sourceKind} from ${actor}; observed=${new Date(observation.observedAtMillis).toISOString()}.`,
    'Retrieval: not injected into a planner or provider in CLI8A.',
  ];
};

export const memoryStatusReport = (inspection: MemoryInspection): Readonly<Record<string, unknown>> => ({
  ok: true,
  scope: inspection.scope,
  activeCount: inspection.activeCount,
  recoveryCount: inspection.recoveryCount,
  ledgerHeadSha256: inspection.ledgerHeadSha256 ?? null,
  retrievalActive: false,
  skillsActive: false,
});

const freshnessLabel = (observation: MemoryObservation): string => {
  const freshness = observation.freshness;
  if (typeof freshness === 'string') return freshness;
  if (typeof freshness === 'object' && freshness !== null && 'kind' in freshness) {
    const kind = (freshness as { readonly kind?: unknown }).kind;
    if (typeof kind === 'string') return kind;
  }
  return 'explicit';
};
