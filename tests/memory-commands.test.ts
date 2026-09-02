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
  MemoryContextPreview,
  MemoryInspection,
  MemoryObservation,
  MemoryOperationResult,
  MemoryPreviewRuntime,
  ProjectedMemory,
  RecoveryMemory,
  RepositoryMemoryScope,
} from '../src/memory/contracts.js';
import {
  memoryPrivacyBoundary,
  renderMemoryContextPreview,
  renderMemoryExplanation,
  renderMemoryPrivacyOperation,
} from '../src/memory/presentation.js';

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

class FakeRuntime implements MemoryPreviewRuntime {
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
  forgotten?: string;
  purged?: string;
  historyCleared = false;
  previewBudget?: number;

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

  async preview(budgetBytes = 65_536): Promise<MemoryContextPreview> {
    this.previewBudget = budgetBytes;
    return {
      schemaVersion: 1,
      previewId: `memory_context_preview:v1:sha256:${'9'.repeat(64)}`,
      asOfMillis: 300,
      budgetBytes,
      selectedBytes: 32,
      candidateCount: 2,
      selected: [{
        entry: this.active[0]!,
        contextBytes: 32,
        reason: 'active_fresh_exact_scope',
      }],
      omitted: [{
        observationId: this.active[1]!.observation.observationId,
        scopeKind: 'repository',
        statementPreview: this.active[1]!.observation.statement,
        contextBytes: 39,
        reason: 'budget_exceeded',
      }],
      scopeHeads: [{
        scope,
        ledgerHeadSha256: 'e'.repeat(64),
        activeCount: 2,
        recoveryCount: 1,
      }],
      forgottenExcludedCount: 0,
      supersededRecoveryExcludedCount: 1,
      retrievalActive: false,
      plannerInjection: false,
      providerWorkPerformed: false,
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

  async forget(id: string): Promise<MemoryOperationResult> {
    this.forgotten = id;
    return this.resultWithoutContent('forgotten');
  }

  async purge(id: string): Promise<MemoryOperationResult> {
    this.purged = id;
    return this.resultWithoutContent('purged');
  }

  async clearRecoveryHistory(): Promise<MemoryOperationResult> {
    this.historyCleared = true;
    return this.resultWithoutContent('recovery_history_cleared');
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

  private resultWithoutContent(status: MemoryOperationResult['status']): MemoryOperationResult {
    return {
      schemaVersion: 1,
      status,
      scope,
      activeCount: this.active.length,
      recoveryCount: this.recovery.length,
      ledgerHeadSha256: 'e'.repeat(64),
      compacted: status !== 'forgotten',
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

test('context preview uses a bounded default without a query or ranking step', async () => {
  const runtime = new FakeRuntime();
  const commands = new MemoryCommands(runtime);
  const preview = await commands.preview();
  assert.equal(runtime.previewBudget, 65_536);
  assert.equal(preview.retrievalActive, false);
  assert.equal(preview.plannerInjection, false);
  assert.equal(preview.providerWorkPerformed, false);

  await commands.preview(262_144);
  assert.equal(runtime.previewBudget, 262_144);
  assert.throws(() => commands.preview(0), /integer from 1 to 262144/u);
  assert.throws(() => commands.preview(262_145), /integer from 1 to 262144/u);
  assert.throws(() => commands.preview(1.5), /integer from 1 to 262144/u);
});

test('privacy orchestration resolves natural selectors and authorizes before irreversible mutation', async () => {
  const runtime = new FakeRuntime();
  const commands = new MemoryCommands(runtime);
  await commands.forget('lifecycle authority');
  assert.equal(runtime.forgotten, runtime.active[0]!.observation.observationId);

  let confirmation = '';
  await commands.purge('old orchestration', async (entry) => {
    confirmation = entry.observation.statement;
  });
  assert.equal(confirmation, 'The old orchestration rule.');
  assert.equal(runtime.purged, runtime.recovery[0]!.observation.observationId);

  const results = await commands.clearRecoveryHistory();
  assert.equal(results.length, 1);
  assert.equal(runtime.historyCleared, true);
});

test('declined purge cannot reach the runtime mutation', async () => {
  const runtime = new FakeRuntime();
  const commands = new MemoryCommands(runtime);
  await assert.rejects(
    commands.purge('lifecycle authority', async () => {
      throw new Error('cancelled');
    }),
    /cancelled/u,
  );
  assert.equal(runtime.purged, undefined);
});

test('privacy presentation states the memory-only erasure boundary', () => {
  const runtime = new FakeRuntime();
  const result = {
    schemaVersion: 1,
    status: 'purged',
    scope,
    activeCount: 0,
    recoveryCount: 0,
    ledgerHeadSha256: 'e'.repeat(64),
    compacted: true,
    receipt: {
      schemaVersion: 1,
      operationId: `memory_operation:v1:sha256:${'f'.repeat(64)}`,
      performedAtMillis: 200,
      actorId: 'developer:fixture',
      purgedAtMillis: 200,
      scopeKind: 'repository',
      reasonCode: 'memory_purged',
      removedRecordCount: 2,
    },
  } as const satisfies MemoryOperationResult;
  const lines = renderMemoryPrivacyOperation(result);
  assert.ok(lines.includes(memoryPrivacyBoundary));
  assert.ok(lines.some((line) => line.includes('runs, artifacts, conversations, backups, and media')));
  assert.equal(runtime.purged, undefined);
});

test('memory explanation exposes provenance and the no-retrieval boundary', () => {
  const lines = renderMemoryExplanation(projected('a', 'Rust owns lifecycle authority.'));
  assert.ok(lines.some((line) => line.includes('developer statement')));
  assert.ok(lines.some((line) => line.includes('not injected into a planner or provider')));
  assert.ok(lines.every((line) => !line.includes('undefined')));
});

test('context preview presentation is friendly, model-inactive, and hides internal IDs', async () => {
  const preview = await new FakeRuntime().preview();
  const longMultiline = `First line\nsecond line \u009B\u202E${'x'.repeat(8 * 1024 - 31)}`;
  const lines = renderMemoryContextPreview({
    ...preview,
    selected: [{
      ...preview.selected[0]!,
      entry: {
        ...preview.selected[0]!.entry,
        observation: {
          ...preview.selected[0]!.entry.observation,
          statement: longMultiline,
        },
      },
    }],
  });
  const output = lines.join('\n');
  assert.match(output, /nothing was sent to a model/u);
  assert.match(output, /active, fresh, and belongs to this repository or your local preferences/u);
  assert.match(output, /outside this preview’s byte budget/u);
  assert.match(output, /did not change saved memories or insert them into planner or provider context/u);
  assert.match(output, /use --json for exact selected content/u);
  assert.match(output, /First line second line �+x/u);
  assert.ok(lines.every((line) => !line.includes('\u202E')));
  assert.ok(lines.every((line) => !line.includes('\u009B')));
  assert.ok(lines.every((line) => Buffer.byteLength(line, 'utf8') < 300));
  assert.match(output, /internal IDs are not required/u);
  assert.doesNotMatch(output, /memory_(?:observation|context_preview):/u);
});
