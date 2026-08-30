export const rustMemoryProtocolVersion = 'forge.kernel.memory.v1';

export interface RepositoryMemoryScope {
  readonly kind: 'repository';
  readonly workspaceId: string;
  readonly repositoryId: string;
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
  readonly scope: RepositoryMemoryScope;
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
  readonly scope: RepositoryMemoryScope;
  readonly ledgerHeadSha256?: string;
  readonly active: readonly ProjectedMemory[];
  readonly recovery?: readonly RecoveryMemory[];
  readonly activeCount: number;
  readonly recoveryCount: number;
}

export type MemoryOperationStatus = 'admitted' | 'corrected' | 'restored' | 'unchanged';

export interface MemoryOperationResult {
  readonly schemaVersion: 1;
  readonly status: MemoryOperationStatus;
  readonly scope: RepositoryMemoryScope;
  readonly activeObservation: MemoryObservation;
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
