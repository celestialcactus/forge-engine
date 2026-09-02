export const rustMemoryProtocolVersion = 'forge.kernel.memory.v1';

export interface RepositoryMemoryScope {
  readonly kind: 'repository';
  readonly workspaceId: string;
  readonly repositoryId: string;
}

export interface DeveloperMemoryScope {
  readonly kind: 'developer';
  readonly actorId: string;
}

export type MemoryScope = RepositoryMemoryScope | DeveloperMemoryScope;
export type MemoryGrantScope = RepositoryMemoryScope | DeveloperMemoryScope;
export type MemoryCaptureMode = 'off' | 'ask' | 'auto';

export interface MemoryStandingGrant {
  readonly schemaVersion: 1;
  readonly grantId: string;
  readonly actorId: string;
  readonly scope: MemoryGrantScope;
  readonly mode: MemoryCaptureMode;
  readonly createdAtMillis: number;
  readonly revokedAtMillis?: number;
}

export interface MemoryObservation {
  readonly schemaVersion: 1;
  readonly normalizationId: 'memory_text_v1';
  readonly claimId: string;
  readonly observationId: string;
  readonly subjectKind: string;
  readonly statementKind: string;
  readonly subject: string;
  readonly statement: string;
  readonly scope: MemoryScope;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly relation: unknown;
  readonly confidence: number;
  readonly observedAtMillis: number;
  readonly freshness: unknown;
}

export interface ProjectedMemory {
  readonly lineageId: string;
  readonly observation: MemoryObservation;
  readonly admittedSequence: number;
  readonly updatedSequence: number;
}

export interface RecoveryMemory {
  readonly lineageId: string;
  readonly observation: MemoryObservation;
  readonly replacedAtMillis: number;
  readonly replacementObservationId?: string;
  readonly updatedSequence: number;
}

export interface MemoryInspection {
  readonly schemaVersion: 1;
  readonly scope: MemoryScope;
  readonly ledgerHeadSha256?: string;
  readonly active: readonly ProjectedMemory[];
  readonly recovery?: readonly RecoveryMemory[];
  readonly activeCount: number;
  readonly recoveryCount: number;
  readonly grants?: readonly MemoryStandingGrant[];
}

export const defaultMemoryContextPreviewBudgetBytes = 65_536;
export const maximumMemoryContextPreviewBudgetBytes = 262_144;

export type MemoryContextPreviewSelectionReason = 'active_fresh_exact_scope';

export type MemoryContextPreviewOmissionReason =
  | 'observation_not_yet_effective'
  | 'declared_contradiction'
  | 'inferred_hypothesis'
  | 'source_not_eligible'
  | 'explicit_validity_expired'
  | 'evidence_currentness_unavailable'
  | 'run_context_unavailable'
  | 'budget_exceeded';

export interface MemoryContextPreviewSelection {
  readonly entry: ProjectedMemory;
  readonly contextBytes: number;
  readonly reason: MemoryContextPreviewSelectionReason;
}

export interface MemoryContextPreviewOmission {
  readonly observationId: string;
  readonly scopeKind: MemoryScope['kind'];
  readonly statementPreview: string;
  readonly contextBytes: number;
  readonly reason: MemoryContextPreviewOmissionReason;
}

export interface MemoryContextPreviewScopeHead {
  readonly scope: MemoryScope;
  readonly ledgerHeadSha256: string | null;
  readonly activeCount: number;
  readonly recoveryCount: number;
}

export interface MemoryContextPreview {
  readonly schemaVersion: 1;
  readonly previewId: string;
  readonly asOfMillis: number;
  readonly budgetBytes: number;
  readonly selectedBytes: number;
  readonly candidateCount: number;
  readonly selected: readonly MemoryContextPreviewSelection[];
  readonly omitted: readonly MemoryContextPreviewOmission[];
  readonly scopeHeads: readonly MemoryContextPreviewScopeHead[];
  readonly forgottenExcludedCount: number;
  readonly supersededRecoveryExcludedCount: number;
  readonly retrievalActive: false;
  readonly plannerInjection: false;
  readonly providerWorkPerformed: false;
}

export type MemoryOperationStatus = 'admitted' | 'corrected' | 'restored' | 'unchanged'
  | 'forgotten' | 'purged' | 'recovery_history_cleared'
  | 'capture_mode_changed' | 'grant_revoked' | 'auto_capture_undone';

export type MemoryReceiptReason = 'correction_history_erased' | 'recovery_compacted'
  | 'auto_capture_undone' | 'memory_purged' | 'recovery_history_cleared';

export interface MemoryNonContentReceipt {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly performedAtMillis: number;
  readonly actorId?: string;
  readonly purgedAtMillis?: number;
  readonly scopeKind: MemoryScope['kind'];
  readonly reasonCode: MemoryReceiptReason;
  readonly removedRecordCount: number;
}

export interface MemoryOperationResult {
  readonly schemaVersion: 1;
  readonly status: MemoryOperationStatus;
  readonly scope: MemoryScope;
  readonly activeObservation?: MemoryObservation;
  readonly grant?: MemoryStandingGrant;
  readonly receipt?: MemoryNonContentReceipt;
  readonly activeCount: number;
  readonly recoveryCount: number;
  readonly ledgerHeadSha256: string;
  readonly compacted: boolean;
}

export type MemoryCorrectionDisposition = 'keep_bounded' | 'erase_previous';

export type MemoryRuntimeOutcome =
  | { readonly kind: 'operation'; readonly result: MemoryOperationResult }
  | { readonly kind: 'inspection'; readonly inspection: MemoryInspection }
  | { readonly kind: 'context_preview'; readonly preview: MemoryContextPreview };

export interface MemoryRuntime {
  remember(statement: string, observedAtMillis?: number): Promise<MemoryOperationResult>;
  inspect(includeRecovery?: boolean): Promise<MemoryInspection>;
  correct(
    targetObservationId: string,
    replacementStatement: string,
    disposition: MemoryCorrectionDisposition,
    occurredAtMillis?: number,
  ): Promise<MemoryOperationResult>;
  restore(targetObservationId: string, occurredAtMillis?: number): Promise<MemoryOperationResult>;
  forget(targetObservationId: string, occurredAtMillis?: number): Promise<MemoryOperationResult>;
  purge(targetObservationId: string, purgedAtMillis?: number): Promise<MemoryOperationResult>;
  clearRecoveryHistory(clearedAtMillis?: number): Promise<MemoryOperationResult>;
}

export interface MemoryPreviewRuntime extends MemoryRuntime {
  preview(budgetBytes?: number, asOfMillis?: number): Promise<MemoryContextPreview>;
}

export interface MemoryCaptureRuntime extends MemoryRuntime {
  rememberPreference(statement: string, observedAtMillis?: number): Promise<MemoryOperationResult>;
  setCaptureMode(
    mode: MemoryCaptureMode,
    grantScope: MemoryGrantScope,
    occurredAtMillis?: number,
  ): Promise<MemoryOperationResult>;
  revokeGrant(grantId: string, occurredAtMillis?: number): Promise<MemoryOperationResult>;
  autoCapture(
    statement: string,
    grantId: string,
    grantScope: MemoryGrantScope,
    observedAtMillis?: number,
  ): Promise<MemoryOperationResult>;
  undoAutoCapture(
    targetObservationId: string,
    grantId: string,
    occurredAtMillis?: number,
  ): Promise<MemoryOperationResult>;
}
