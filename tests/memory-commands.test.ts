import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MemoryCommands,
  MemorySelectionError,
  filterEntries,
  selectOne,
} from '../src/memory/commands.js';
import type {
  MemoryCorrectionDisposition,
  MemoryInspection,
  MemoryObservation,
  MemoryOperationResult,
  MemoryRuntime,
  ProjectedMemory,
  RecoveryMemory,
  RepositoryMemoryScope,
} from '../src/memory/contracts.js';
import { renderMemoryExplanation } from '../src/memory/presentation.js';

const scope: RepositoryMemoryScope = {
  kind: 'repository',
  workspaceId: `workspace:v1:sha256:${'a'.repeat(64)}`,
  repositoryId: `repository:v1:sha256:${'a'.repeat(64)}`,
};

const observation = (suffix: string, statement: string): MemoryObservation => ({
  schemaVersion: 1,
  normalizationId: 'memory_text_v1',
  claimId: `memory_claim:v1:sha256:${suffix.repeat(64)}`,
  observationId: `memory_observation:v1:sha256:${suffix.repeat(64)}`,
  subjectKind: 'repository_convention',
  statementKind: 'reviewed_decision',
  subject: 'repository decision',
  statement,
  scope,
  provenance: {
    kind: 'developer_statement',
    actorId: 'developer:fixture',
    admission: 'explicit_remember',
  },
  relation: { kind: 'supports' },
  confidence: 100,
  observedAtMillis: 100,
  freshness: { kind: 'persistent_until_reviewed' },
});

const projected = (suffix: string, statement: string): ProjectedMemory => ({
  lineageId: `memory_observation:v1:sha256:${suffix.repeat(64)}`,
  observation: observation(suffix, statement),
  admittedSequence: 1,
  updatedSequence: 1,
});

const recovered = (suffix: string, statement: string): RecoveryMemory => ({
  ...projected(suffix, statement),
  replacedAtMillis: 200,
  replacementObservationId: `memory_observation:v1:sha256:${'f'.repeat(64)}`,
});

class FakeRuntime implements MemoryRuntime {
  active: ProjectedMemory[] = [
    projected('a', 'Rust owns lifecycle authority.'),
    projected('b', 'TypeScript orchestrates the memory UX.'),
  ];
  recovery: RecoveryMemory[] = [recovered('c', 'The old orchestration rule.')];
  lastCorrection?: {
    readonly id: string;
    readonly statement: string;
    readonly disposition: MemoryCorrectionDisposition;
  };
  restored?: string;

  async remember(statement: string): Promise<MemoryOperationResult> {
    return this.result('admitted', observation('d', statement));
  }

  async inspect(includeRecovery = false): Promise<MemoryInspection> {
    return {
      schemaVersion: 1,
      scope,
      ledgerHeadSha256: 'e'.repeat(64),
      active: this.active,
      ...(includeRecovery ? { recovery: this.recovery } : {}),
      activeCount: this.active.length,
      recoveryCount: this.recovery.length,
    };
  }

  async correct(
    id: string,
    statement: string,
    disposition: MemoryCorrectionDisposition,
  ): Promise<MemoryOperationResult> {
    this.lastCorrection = { id, statement, disposition };
    return this.result('corrected', observation('e', statement));
  }

  async restore(id: string): Promise<MemoryOperationResult> {
    this.restored = id;
    return this.result('restored', this.recovery[0]!.observation);
  }

  private result(
    status: MemoryOperationResult['status'],
    activeObservation: MemoryObservation,
  ): MemoryOperationResult {
    return {
      schemaVersion: 1,
      status,
      scope,
      activeObservation,
      activeCount: this.active.length,
      recoveryCount: this.recovery.length,
      ledgerHeadSha256: 'e'.repeat(64),
      compacted: false,
    };
  }
}

test('natural text selectors do not require internal IDs and fail closed on ambiguity', () => {
  const entries = [
    projected('a', 'Rust owns lifecycle authority.'),
    projected('b', 'Rust also owns provenance authority.'),
  ];
  assert.equal(selectOne(entries, 'lifecycle', 'active memory'), entries[0]);
  assert.equal(selectOne(entries, entries[1]!.observation.observationId, 'active memory'), entries[1]);
  assert.throws(
    () => selectOne(entries, 'Rust', 'active memory'),
    (error: unknown) => error instanceof MemorySelectionError
      && error.code === 'memory_selector_ambiguous'
      && /few more words/u.test(error.message),
  );
  assert.equal(filterEntries(entries, 'provenance').length, 1);
});

test('command orchestration resolves exact targets before correction and restore', async () => {
  const runtime = new FakeRuntime();
  const commands = new MemoryCommands(runtime);
  await commands.correct('lifecycle authority', 'Rust owns canonical lifecycle authority.', 'erase_previous');
  assert.deepEqual(runtime.lastCorrection, {
    id: runtime.active[0]!.observation.observationId,
    statement: 'Rust owns canonical lifecycle authority.',
    disposition: 'erase_previous',
  });
  await commands.restore('old orchestration');
  assert.equal(runtime.restored, runtime.recovery[0]!.observation.observationId);
});

test('memory explanation exposes provenance and the no-retrieval boundary', () => {
  const lines = renderMemoryExplanation(projected('a', 'Rust owns lifecycle authority.'));
  assert.ok(lines.some((line) => line.includes('developer statement')));
  assert.ok(lines.some((line) => line.includes('not injected into a planner or provider')));
  assert.ok(lines.every((line) => !line.includes('undefined')));
});
