import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chooseOllamaModel,
  resolveInteractiveRoute,
  runInteractiveSession,
  type InteractiveSessionIo,
} from '../src/interactive-cli.js';
import type { InferenceRoute } from '../src/inference/contracts.js';

test('discovers a deterministic local coding model without selecting cloud inference', async () => {
  assert.equal(chooseOllamaModel(['zeta', 'qwen2.5-coder:7b', 'alpha-coder']), 'qwen2.5-coder:7b');
  const selection = await resolveInteractiveRoute({
    environment: {},
    fetch: async () => new Response(JSON.stringify({
      models: [{ name: 'llama3:latest' }, { name: 'qwen2.5-coder:7b' }],
    }), { status: 200 }),
  });
  assert.deepEqual(selection, {
    route: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    source: 'ollama-discovery',
  });
});

test('requires complete explicit defaults and does not contact discovery when they exist', async () => {
  await assert.rejects(
    resolveInteractiveRoute({ environment: { FORGE_DEFAULT_PROVIDER: 'ollama' } }),
    /provider and model together/u,
  );
  let fetched = false;
  const selection = await resolveInteractiveRoute({
    provider: 'openai',
    model: 'fixture-cloud',
    environment: {},
    fetch: async () => {
      fetched = true;
      throw new Error('must not fetch');
    },
  });
  assert.equal(fetched, false);
  assert.equal(selection.source, 'command-line');
  assert.deepEqual(selection.route, { provider: 'openai', model: 'fixture-cloud' });
});

test('runs repeated prompts and session controls without creating another runtime contract', async () => {
  const inputs = ['/status', 'Inspect the workspace.', '/model ollama alternate-coder:7b', 'Inspect again.', '/clear', '/exit'];
  const output: string[] = [];
  let cleared = 0;
  let closed = 0;
  const io: InteractiveSessionIo = {
    async question() { return inputs.shift(); },
    write(line) { output.push(line); },
    clear() { cleared++; },
    close() { closed++; },
  };
  const runs: Array<{ readonly task: string; readonly route: InferenceRoute }> = [];
  await runInteractiveSession({
    workspaceRoot: 'C:/workspace',
    initialRoute: {
      route: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
      source: 'ollama-discovery',
    },
    io,
    runTask: async (task, route) => {
      runs.push({ task, route });
      return { runId: 'run:' + runs.length, status: 'completed' };
    },
  });
  assert.deepEqual(runs, [
    { task: 'Inspect the workspace.', route: { provider: 'ollama', model: 'qwen2.5-coder:7b' } },
    { task: 'Inspect again.', route: { provider: 'ollama', model: 'alternate-coder:7b' } },
  ]);
  assert.equal(cleared, 1);
  assert.equal(closed, 1);
  assert.ok(output.some((line) => line.includes('Each prompt creates a new evidence run')));
  assert.ok(output.some((line) => line.includes('route changed: ollama/alternate-coder:7b (session)')));
});
