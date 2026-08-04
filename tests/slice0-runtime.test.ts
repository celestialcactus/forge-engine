import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equivalentTrace, type OutcomeContract } from '../src/slice0/contracts.js';
import {
  allowAll,
  denyAll,
  explodingCapability,
  ScriptedPlanner,
  slice0Workspace,
  workspaceInventory,
} from '../src/slice0/fixtures.js';
import { TypeScriptConformanceRuntime } from '../src/slice0/runtime.js';

const inspectCall = { id: 'call-1', capabilityId: 'workspace.inventory', input: {} };

const outcomeContract = (capabilityId: string): OutcomeContract => ({
  schemaVersion: 1,
  requirements: [
    { id: 'required-capability', kind: 'capability_succeeded', capabilityId, minimumInvocations: 1 },
    { id: 'expected-output', kind: 'output_equals', expected: 'Workspace inspected.' },
  ],
});

const successfulRuntime = () => new TypeScriptConformanceRuntime({
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

  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.outcome.status, 'not_evaluated');
  assert.equal(artifact.output, 'Workspace inspected.');
  assert.deepEqual(
    artifact.events.map((event) => [event.sequence, event.type]),
    [
      [1, 'run.started'],
      [2, 'context.planned'],
      [3, 'capability.requested'],
      [4, 'approval.decided'],
      [5, 'capability.completed'],
      [6, 'outcome.assessed'],
      [7, 'run.completed'],
    ],
  );
  assert.deepEqual(artifact.contextPlan?.selected.map((item) => item.locator), [
    'run://task',
    'workspace://README.md',
    'workspace://package.json',
    'workspace://src/greeting.ts',
  ]);
});

test('verifies only explicit caller-authored requirements', async () => {
  const verified = await successfulRuntime().run({
    runId: 'verified-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2,
    outcomeContract: outcomeContract('workspace.inventory'),
  });
  assert.equal(verified.status, 'completed');
  assert.equal(verified.outcome.status, 'verified');
  assert.deepEqual(verified.outcomeContract, outcomeContract('workspace.inventory'));
  assert.equal(verified.outcome.checks.every((check) => check.satisfied), true);
  assert.equal(verified.events.at(-2)?.type, 'outcome.assessed');

  const unmet = await successfulRuntime().run({
    runId: 'unmet-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2,
    outcomeContract: outcomeContract('workspace.read'),
  });
  assert.equal(unmet.status, 'completed');
  assert.equal(unmet.outcome.status, 'unmet');
  assert.equal(unmet.outcome.checks.find((check) => check.id === 'required-capability')?.satisfied, false);
});

test('uses Rust Unicode whitespace semantics for non-empty output checks', async () => {
  const runOutput = async (runId: string, output: string) => new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{ kind: 'complete', output }]),
    approvalPolicy: allowAll,
    capabilities: [],
  }).run({
    runId,
    task: 'Check output.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 1,
    outcomeContract: { schemaVersion: 1, requirements: [{ id: 'output', kind: 'output_non_empty' }] },
  });
  assert.equal((await runOutput('byte-order-mark-output', '\ufeff')).outcome.status, 'verified');
  assert.equal((await runOutput('next-line-output', '\u0085')).outcome.status, 'unmet');
});

test('rejects invalid outcome contracts before planner work', async () => {
  const artifact = await successfulRuntime().run({
    runId: 'invalid-outcome-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2,
    outcomeContract: { schemaVersion: 1, requirements: [] },
  });
  assert.equal(artifact.status, 'failed');
  assert.equal(artifact.outcome.status, 'not_evaluated');
  assert.equal(artifact.events.at(-1)?.type, 'run.failed');
  const terminal = artifact.events.at(-1);
  if (terminal?.type !== 'run.failed') throw new Error('Expected invalid outcome contract failure.');
  assert.equal(terminal.code, 'invalid_outcome_contract');
});

test('does not credit a capability result for a different call ID', async () => {
  const runtime = new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{ kind: 'call', call: inspectCall }, { kind: 'complete', output: 'Workspace inspected.' }]),
    approvalPolicy: allowAll,
    capabilities: [{
      id: 'workspace.inventory',
      async invoke() {
        return { callId: 'call-other', success: true, content: 'Mismatched fixture result.' };
      },
    }],
  });
  const artifact = await runtime.run({
    runId: 'mismatched-result-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2,
    outcomeContract: outcomeContract('workspace.inventory'),
  });
  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.outcome.status, 'unmet');
  assert.deepEqual(artifact.capabilityResults[0], {
    callId: 'call-1',
    success: false,
    content: 'Capability result call ID call-other does not match call-1.',
  });
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
  const runtime = new TypeScriptConformanceRuntime({
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
    'run.started', 'context.planned', 'capability.requested', 'approval.decided', 'capability.completed', 'outcome.assessed', 'run.completed',
  ]);
});

test('records a capability failure without corrupting the terminal run state', async () => {
  const runtime = new TypeScriptConformanceRuntime({
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
