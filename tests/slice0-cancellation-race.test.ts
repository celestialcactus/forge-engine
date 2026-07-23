import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskPlanner } from '../src/slice0/contracts.js';
import { allowAll, slice0Workspace, workspaceInventory } from '../src/slice0/fixtures.js';
import { Slice0Runtime } from '../src/slice0/runtime.js';

test('records cancellation that races with planner completion', async () => {
  const controller = new AbortController();
  const planner: TaskPlanner = {
    id: 'cancelling-fixture',
    async next() {
      controller.abort(new Error('Cancelled while planner was responding.'));
      return { kind: 'complete', output: 'This output must not become terminal.' };
    },
  };
  const artifact = await new Slice0Runtime({
    planner,
    approvalPolicy: allowAll,
    capabilities: [workspaceInventory],
  }).run({
    runId: 'cancellation-race-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 1,
    signal: controller.signal,
  });

  assert.equal(artifact.status, 'cancelled');
  assert.equal(artifact.output, undefined);
  assert.deepEqual(artifact.events.map((event) => event.type), [
    'run.started', 'context.planned', 'run.cancelled',
  ]);
});
