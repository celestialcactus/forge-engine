import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equivalentTrace } from '../src/slice0/contracts.js';
import {
  allowAll,
  denyAll,
  explodingCapability,
  ScriptedPlanner,
  slice0Workspace,
  workspaceInventory,
} from '../src/slice0/fixtures.js';
import { Slice0Runtime } from '../src/slice0/runtime.js';

const inspectCall = { id: 'call-1', capabilityId: 'workspace.inventory', input: {} };

const successfulRuntime = () => new Slice0Runtime({
  planner: new ScriptedPlanner([{ kind: 'call', call: inspectCall }, { kind: 'complete', output: 'Workspace inspected.' }]),
  approvalPolicy: allowAll,
  capabilities: [workspaceInventory],
});

test('produces the Slice 0 golden trace for a successful read-only run', async () => {
  const artifact = await successfulRuntime().run({
    runId: 'golden-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2,
  });

  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.output, 'Workspace inspected.');
  assert.deepEqual(
    artifact.events.map((event) => [event.sequence, event.type]),
    [
      [1, 'run.started'],
      [2, 'context.planned'],
      [3, 'capability.requested'],
      [4, 'approval.decided'],
      [5, 'capability.completed'],
      [6, 'run.completed'],
    ],
  );
  assert.deepEqual(artifact.contextPlan?.selected.map((item) => item.locator), [
    'run://task',
    'workspace://README.md',
    'workspace://package.json',
    'workspace://src/greeting.ts',
  ]);
});

test('produces an equivalent ordered trace for identical fixture inputs', async () => {
  const request = {
    runId: 'repeatable-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2,
  };
  const first = await successfulRuntime().run(request);
  const second = await successfulRuntime().run(request);
  assert.equal(equivalentTrace(first.events, second.events), true);
  assert.deepEqual(first.contextPlan, second.contextPlan);
});

test('records a denied capability as inspectable tool evidence and continues', async () => {
  const runtime = new Slice0Runtime({
    planner: new ScriptedPlanner([{ kind: 'call', call: inspectCall }, { kind: 'complete', output: 'Denied request handled.' }]),
    approvalPolicy: denyAll,
    capabilities: [workspaceInventory],
  });
  const artifact = await runtime.run({
    runId: 'denied-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 200, maxTurns: 2,
  });

  assert.equal(artifact.status, 'completed');
  assert.match(artifact.capabilityResults[0]?.content ?? '', /deny: Fixture policy denied/);
  assert.deepEqual(artifact.events.map((event) => event.type), [
    'run.started', 'context.planned', 'capability.requested', 'approval.decided', 'capability.completed', 'run.completed',
  ]);
});

test('records a capability failure without corrupting the terminal run state', async () => {
  const runtime = new Slice0Runtime({
    planner: new ScriptedPlanner([
      { kind: 'call', call: { id: 'call-explodes', capabilityId: 'fixture.explodes', input: {} } },
      { kind: 'complete', output: 'Failure was reported.' },
    ]),
    approvalPolicy: allowAll,
    capabilities: [explodingCapability],
  });
  const artifact = await runtime.run({
    runId: 'capability-failure-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 200, maxTurns: 2,
  });

  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.capabilityResults[0]?.success, false);
  assert.match(artifact.capabilityResults[0]?.content ?? '', /failed/);
});

test('stops transparently when the developer task cannot fit the context budget', async () => {
  const artifact = await successfulRuntime().run({
    runId: 'budget-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 1, maxTurns: 2,
  });

  assert.equal(artifact.status, 'budget_exhausted');
  assert.deepEqual(artifact.events.map((event) => event.type), ['run.started', 'context.planned', 'run.budget_exhausted']);
  assert.equal(artifact.capabilityResults.length, 0);
});

test('records cancellation before work and leaves a completed run unchanged after a later abort', async () => {
  const cancelled = new AbortController();
  cancelled.abort(new Error('Fixture cancelled before start.'));
  const cancelledArtifact = await successfulRuntime().run({
    runId: 'cancelled-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 200, maxTurns: 2, signal: cancelled.signal,
  });
  assert.equal(cancelledArtifact.status, 'cancelled');
  assert.deepEqual(cancelledArtifact.events.map((event) => event.type), ['run.cancelled']);

  const completed = await successfulRuntime().run({
    runId: 'completed-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 200, maxTurns: 2,
  });
  const afterCompletion = new AbortController();
  afterCompletion.abort(new Error('Too late.'));
  assert.equal(completed.status, 'completed');
  assert.equal(completed.events.at(-1)?.type, 'run.completed');
});
