import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { equivalentTrace } from '../src/slice0/contracts.js';
import { artifactPayload, ForgeWorkspaceService } from '../src/v1/service.js';
import { createWorkspaceSnapshot } from '../src/v1/workspace.js';

const fixtureRoot = resolve('tests/fixtures/slice1-workspace');

test('creates a stable real workspace snapshot with canonical path ordering', async () => {
  const first = await createWorkspaceSnapshot(fixtureRoot);
  const second = await createWorkspaceSnapshot(fixtureRoot);
  assert.equal(first.id, second.id);
  assert.deepEqual(first.files.map((file) => file.path), ['README.md', 'src/example.ts']);
  assert.equal(first.rootLabel, 'slice1-workspace');
});

test('preserves the developer task and repeats the same real-adapter trace for fixed inputs', async () => {
  const service = new ForgeWorkspaceService(fixtureRoot, {
    snapshotObserver: () => ({ close() {} }),
    runIdFactory: () => 'run:deterministic-slice-1',
  });
  try {
    const task = 'Explain the fixture workspace deterministically.';
    const first = await service.run(task, 1);
    const second = await service.run(task, 1);

    assert.equal(first.task, task);
    assert.equal(first.events[0]?.type, 'run.started');
    assert.equal(first.events[0]?.type === 'run.started' ? first.events[0].task : undefined, task);
    assert.equal(equivalentTrace(first.events, second.events), true);
    assert.deepEqual(first.contextPlan, second.contextPlan);
    assert.deepEqual(first.capabilityResults, second.capabilityResults);
  } finally {
    service.close();
  }
});

test('rejects an empty developer task instead of inventing intent', async () => {
  await assert.rejects(new ForgeWorkspaceService(fixtureRoot).run('   '), /must not be empty/u);
});

test('reuses an observed workspace snapshot and refreshes after invalidation', async () => {
  let snapshotCalls = 0;
  let invalidate: (() => void) | undefined;
  let observerClosed = false;
  const service = new ForgeWorkspaceService(fixtureRoot, {
    snapshotProvider: async (workspaceRoot) => {
      snapshotCalls++;
      await new Promise<void>((resolveDelay) => setImmediate(resolveDelay));
      return createWorkspaceSnapshot(workspaceRoot);
    },
    snapshotObserver: (_workspaceRoot, onChange) => {
      invalidate = onChange;
      return { close: () => { observerClosed = true; } };
    },
  });

  const [summary, read] = await Promise.all([
    service.inspect(1),
    service.read('README.md', { maxLines: 1 }),
  ]);
  assert.equal(snapshotCalls, 1);
  assert.equal(summary.snapshot.id, read.snapshot.id);

  await service.inspect(1);
  assert.equal(snapshotCalls, 1);
  assert.deepEqual(service.snapshotMetrics(), {
    scans: 1,
    reuses: 2,
    invalidations: 0,
    freshnessMode: 'observed-with-rescan',
  });

  invalidate?.();
  await service.inspect(1);
  assert.equal(snapshotCalls, 2);
  assert.equal(service.snapshotMetrics().invalidations, 1);
  service.close();
  assert.equal(observerClosed, true);
});

test('rescans after the bounded reuse ceiling even without an observed event', async () => {
  let snapshotCalls = 0;
  const service = new ForgeWorkspaceService(fixtureRoot, {
    snapshotProvider: async (workspaceRoot) => {
      snapshotCalls++;
      return createWorkspaceSnapshot(workspaceRoot);
    },
    snapshotObserver: () => ({ close() {} }),
    snapshotMaxReuseMs: 0,
  });

  await service.inspect(1);
  await service.inspect(1);
  assert.equal(snapshotCalls, 2);
  assert.equal(service.snapshotMetrics().freshnessMode, 'observed-with-rescan');
  service.close();
});
test('falls back to scan-per-call when change observation is unavailable', async () => {
  let snapshotCalls = 0;
  const service = new ForgeWorkspaceService(fixtureRoot, {
    snapshotProvider: async (workspaceRoot) => {
      snapshotCalls++;
      return createWorkspaceSnapshot(workspaceRoot);
    },
    snapshotObserver: () => undefined,
  });

  await service.inspect(1);
  await service.inspect(1);
  assert.equal(snapshotCalls, 2);
  assert.equal(service.snapshotMetrics().freshnessMode, 'scan-per-call');
});

test('does not join a stale in-flight scan after invalidation', async () => {
  let snapshotCalls = 0;
  let invalidate: (() => void) | undefined;
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstGate = new Promise<void>((resolveGate) => { releaseFirst = resolveGate; });
  const firstStarted = new Promise<void>((resolveStarted) => { markFirstStarted = resolveStarted; });
  const service = new ForgeWorkspaceService(fixtureRoot, {
    snapshotProvider: async () => {
      const call = ++snapshotCalls;
      if (call === 1) {
        markFirstStarted?.();
        await firstGate;
      }
      return { id: 'workspace:' + call, rootLabel: 'fixture', files: [] };
    },
    snapshotObserver: (_workspaceRoot, onChange) => {
      invalidate = onChange;
      return { close() {} };
    },
  });

  const first = service.inspect(1);
  await firstStarted;
  invalidate?.();
  const second = service.inspect(1);
  releaseFirst?.();
  const [stale, fresh] = await Promise.all([first, second]);

  assert.equal(snapshotCalls, 2);
  assert.equal(stale.snapshot.id, 'workspace:1');
  assert.equal(fresh.snapshot.id, 'workspace:2');
  assert.deepEqual(service.snapshotMetrics(), {
    scans: 2,
    reuses: 0,
    invalidations: 1,
    freshnessMode: 'observed-with-rescan',
  });
  service.close();
});
test('runs real workspace inventory through the accepted Forge run contract', async () => {
  const artifact = await new ForgeWorkspaceService(fixtureRoot).inspect(1);
  const payload = artifactPayload(artifact);
  const evidence = payload.evidence as { totalFiles: number; files: unknown[]; truncated: boolean };
  assert.equal(artifact.status, 'completed');
  assert.equal(evidence.totalFiles, 2);
  assert.equal(evidence.files.length, 1);
  assert.equal(evidence.truncated, true);
  assert.deepEqual(artifact.events.map((event) => event.type), [
    'run.started', 'context.planned', 'capability.requested', 'approval.decided', 'capability.completed', 'run.completed',
  ]);
});

test('returns bounded attributable literal search evidence', async () => {
  const artifact = await new ForgeWorkspaceService(fixtureRoot).search('forge needle', { maxMatches: 5 });
  const payload = artifactPayload(artifact);
  const evidence = payload.evidence as { matches: Array<{ path: string; line: number; preview: string }> };
  assert.equal(artifact.status, 'completed');
  assert.deepEqual(evidence.matches, [{
    path: 'README.md',
    line: 3,
    preview: 'This workspace contains a searchable forge needle.',
  }]);
});
