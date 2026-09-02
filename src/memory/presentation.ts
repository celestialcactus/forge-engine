import type {
  MemoryInspection,
  MemoryContextPreview,
  MemoryContextPreviewOmissionReason,
  MemoryObservation,
  MemoryOperationResult,
  ProjectedMemory,
  RecoveryMemory,
} from './contracts.js';

const previewOmissionLabels: Readonly<Record<MemoryContextPreviewOmissionReason, string>> = {
  observation_not_yet_effective: 'its observation time has not arrived yet',
  declared_contradiction: 'declared contradiction',
  inferred_hypothesis: 'inferred hypothesis',
  source_not_eligible: 'source is not eligible',
  explicit_validity_expired: 'explicit validity expired',
  evidence_currentness_unavailable: 'current evidence could not be verified',
  run_context_unavailable: 'its originating run is not active',
  budget_exceeded: 'outside this preview’s byte budget',
};

const maximumHumanPreviewBytes = 160;
const bidiFormattingCharacters = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const terminalControlCharacters = /\p{Cc}/gu;

const terminalMemoryExcerpt = (value: string): string => {
  const singleLine = value
    .replace(/\r\n?|\n/gu, ' ')
    .replace(terminalControlCharacters, '�')
    .replace(bidiFormattingCharacters, '�')
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .join(' ');
  if (Buffer.byteLength(singleLine, 'utf8') <= maximumHumanPreviewBytes) return singleLine;
  const ellipsisBytes = Buffer.byteLength('…', 'utf8');
  let excerpt = '';
  for (const character of singleLine) {
    if (Buffer.byteLength(excerpt + character, 'utf8') > maximumHumanPreviewBytes - ellipsisBytes) break;
    excerpt += character;
  }
  return `${excerpt}…`;
};

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

export const memoryPrivacyBoundary =
  'This changes Forge memory only. Separately retained runs, artifacts, conversations, backups, and media are not erased.';

export const renderMemoryPrivacyOperation = (result: MemoryOperationResult): readonly string[] => {
  if (!['forgotten', 'purged', 'recovery_history_cleared'].includes(result.status)) {
    throw new Error('Expected a memory privacy operation result.');
  }
  const summary = result.status === 'forgotten'
    ? 'Forgotten. The memory is inactive and can be restored from bounded recovery history.'
    : result.status === 'purged'
      ? `Purged ${String(result.receipt?.removedRecordCount ?? 0)} record(s) from the selected memory lineage.`
      : `Cleared ${String(result.receipt?.removedRecordCount ?? 0)} recoverable memory record(s). Active memory was retained.`;
  return [
    summary,
    `Active: ${result.activeCount}; recovery: ${result.recoveryCount}${result.compacted ? '; storage rewritten' : ''}.`,
    memoryPrivacyBoundary,
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

export const renderMemoryContextPreview = (preview: MemoryContextPreview): readonly string[] => {
  const lines = [
    'Memory context preview — nothing was sent to a model.',
    `Currently, ${String(preview.selected.length)} of ${String(preview.candidateCount)} active memories would qualify `
      + `using ${String(preview.selectedBytes)} of ${String(preview.budgetBytes)} bytes.`,
  ];
  if (preview.selected.length === 0) {
    lines.push('No active memory would currently qualify.');
  } else {
    lines.push('Would qualify:');
    preview.selected.forEach((selected, index) => {
      lines.push(`${String(index + 1)}. ${terminalMemoryExcerpt(selected.entry.observation.statement)} `
        + '— active, fresh, and belongs to this repository or your local preferences.');
    });
  }
  if (preview.omitted.length > 0) {
    lines.push('Not included:');
    preview.omitted.forEach((omitted, index) => {
      lines.push(`${String(index + 1)}. ${terminalMemoryExcerpt(omitted.statementPreview)} `
        + `— ${previewOmissionLabels[omitted.reason]}.`);
    });
  }
  const excludedRecovery = preview.forgottenExcludedCount + preview.supersededRecoveryExcludedCount;
  if (excludedRecovery > 0) {
    lines.push(
      `Excluded inactive history: ${String(preview.forgottenExcludedCount)} forgotten; `
        + `${String(preview.supersededRecoveryExcludedCount)} superseded recoverable record(s).`,
    );
  }
  lines.push('Terminal excerpts are shortened for safety; use --json for exact selected content.');
  lines.push('This preview did not change saved memories or insert them into planner or provider context.');
  lines.push('Choose memories by ordinary words in other memory commands; internal IDs are not required.');
  return lines;
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
