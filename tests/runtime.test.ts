import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForgeRuntime, Slice0Runtime } from '../src/runtime.js';
import { allowAll, ScriptedPlanner, slice0Workspace, workspaceInventory } from '../src/slice0/fixtures.js';

test('exports one Forge runtime backed by the accepted host-neutral protocol', async () => {
  assert.equal(ForgeRuntime, Slice0Runtime);
  const artifact = await new ForgeRuntime({
    planner: new ScriptedPlanner([
      { kind: 'call', call: { id: 'call-1', capabilityId: 'workspace.inventory', input: { maxFiles: 1 } } },
      { kind: 'complete', output: 'Inventory collected.' },
    ]),
    approvalPolicy: allowAll,
    capabilities: [workspaceInventory],
  }).run({
    runId: 'public-runtime-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2,
  });

  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.output, 'Inventory collected.');
  assert.deepEqual(artifact.events.map((event) => event.type), [
    'run.started',
    'context.planned',
    'capability.requested',
    'approval.decided',
    'capability.completed',
    'run.completed',
  ]);
});
