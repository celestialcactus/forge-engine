import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { extractInteractiveChangePlan } from '../src/change-workflow.js';
import type {
  InferenceProvider,
  NormalizedInferenceEvent,
  ProviderInferenceRequest,
} from '../src/inference/contracts.js';
import { developerChangePlanningTools } from '../src/inference/developer-tools.js';
import { ProviderTaskPlanner } from '../src/inference/planner.js';
import { ForgeWorkspaceService, typeScriptConformanceFixture } from '../src/v1/service.js';

test('runs provider read and change planning without mutating the workspace', async () => {
  const workspaceRoot = resolve('tests/fixtures/slice1-workspace');
  const target = resolve(workspaceRoot, 'README.md');
  const before = await readFile(target, 'utf8');

  const replacementText = before + '\nPlanned only.\n';
  const requests: ProviderInferenceRequest[] = [];
  let turn = 0;
  const provider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(request): AsyncGenerator<NormalizedInferenceEvent> {
      requests.push(request);
      turn++;
      if (turn === 1) {
        yield {
          type: 'tool_call.delta',
          index: 0,
          id: 'read-call',
          name: 'forge_workspace_read',
          argumentsDelta: JSON.stringify({ path: 'README.md', startLine: 1, maxLines: 200 }),
        };
        yield { type: 'response.completed', finishReason: 'tool_call' };
        return;
      }
      if (turn === 2) {
        yield {
          type: 'tool_call.delta',
          index: 0,
          id: 'plan-call',
          name: 'forge_workspace_change_plan',
          argumentsDelta: JSON.stringify({
            changes: [{ path: 'README.md', content: replacementText }],
          }),
        };
        yield { type: 'response.completed', finishReason: 'tool_call' };
        return;
      }
      yield { type: 'text.delta', text: 'The change is planned and still requires Forge approval.' };
      yield { type: 'response.completed', finishReason: 'stop' };
    },
  };
  const planner = new ProviderTaskPlanner({
    provider,
    route: { provider: 'ollama', model: 'fixture-model' },
    tools: developerChangePlanningTools,
  });
  const service = new ForgeWorkspaceService(workspaceRoot, {
    runtime: typeScriptConformanceFixture,
    runIdFactory: () => 'run:change-planning-fixture',
  });
  try {
    const artifact = await service.executeChangePlanningTask(
      'Add a planned-only line to the README.',
      planner,
      { maxTurns: 3 },
    );
    const plan = extractInteractiveChangePlan(artifact);
    assert.equal(artifact.status, 'completed');
    assert.deepEqual(
      artifact.capabilityResults.map((result) => result.success),
      [true, true],
    );
    assert.equal(plan?.changes[0]?.path, 'README.md');
    assert.equal(plan?.changes[0]?.replacementText, replacementText);
    assert.equal(await readFile(target, 'utf8'), before);
    const system = requests[0]?.messages.find((message) => message.role === 'system');
    assert.match(system?.content ?? '', /Forge owns the visible approval, candidate execution, verification, and promotion/u);
  } finally {
    service.close();
  }
});
