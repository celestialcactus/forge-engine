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
  readonly replacementObservationId: string;
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

export type MemoryOperationStatus = 'admitted' | 'corrected' | 'restored' | 'unchanged'
  | 'capture_mode_changed' | 'grant_revoked' | 'auto_capture_undone';

export interface MemoryOperationResult {
  readonly schemaVersion: 1;
  readonly status: MemoryOperationStatus;
  readonly scope: MemoryScope;
  readonly activeObservation?: MemoryObservation;
  readonly grant?: MemoryStandingGrant;
  readonly activeCount: number;
  readonly recoveryCount: number;
  readonly ledgerHeadSha256: string;
  readonly compacted: boolean;
}

export type MemoryCorrectionDisposition = 'keep_bounded' | 'erase_previous';

export type MemoryRuntimeOutcome =
  | { readonly kind: 'operation'; readonly result: MemoryOperationResult }
  | { readonly kind: 'inspection'; readonly inspection: MemoryInspection };

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
