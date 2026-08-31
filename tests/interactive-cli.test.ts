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
    fetch: async () => new Response(JSON.stringify({
      models: [{ name: 'llama3:latest' }, { name: 'qwen2.5-coder:7b' }],
    }), { status: 200 }),
  });
  assert.deepEqual(selection, {
    route: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    source: 'ollama_discovery',
  });
});

test('uses the compiled route and does not contact discovery when it exists', async () => {
  let fetched = false;
  const selection = await resolveInteractiveRoute({
    configured: {
      route: { provider: 'openai', model: 'fixture-cloud' },
      source: 'command_line',
    },
    fetch: async () => {
      fetched = true;
      throw new Error('must not fetch');
    },
  });
  assert.equal(fetched, false);
  assert.equal(selection.source, 'command_line');
  assert.deepEqual(selection.route, { provider: 'openai', model: 'fixture-cloud' });
});

test('never labels or probes an off-device endpoint as local auto-discovery', async () => {
  let fetched = false;
  await assert.rejects(
    resolveInteractiveRoute({
      ollamaBaseUrl: 'https://ollama.example.test/',
      fetch: async () => {
        fetched = true;
        throw new Error('must not fetch');
      },
    }),
    /off-device or network Ollama endpoint/u,
  );
  assert.equal(fetched, false);
});

test('runs repeated prompts and session controls without creating another runtime contract', async () => {
  const inputs = ['/status', '/permissions', 'Inspect the workspace.', '/status', '/model ollama alternate-coder:7b', 'Inspect again.', '/clear', '/exit'];
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
      source: 'ollama_discovery',
    },
    approvalProfile: 'developer',
    io,
    notices: ['changes: disabled for fixture'],
    runTask: async (task, route) => {
      runs.push({ task, route });
      return { runId: 'run:' + runs.length, status: 'completed', outcome: 'not_evaluated' };
    },
  });
  assert.deepEqual(runs, [
    { task: 'Inspect the workspace.', route: { provider: 'ollama', model: 'qwen2.5-coder:7b' } },
    { task: 'Inspect again.', route: { provider: 'ollama', model: 'alternate-coder:7b' } },
  ]);
  assert.equal(cleared, 1);
  assert.equal(closed, 1);
  assert.ok(output.some((line) => line.includes('Each prompt creates a new evidence run')));
  assert.ok(output.some((line) => line.includes('approval: developer')));
  assert.ok(output.some((line) => line.includes('governed mutations still require')));
  assert.ok(output.includes('changes: disabled for fixture'));
  assert.ok(output.some((line) => line.includes('status=completed, outcome=not_evaluated')));
  assert.ok(output.some((line) => line.includes('route changed: ollama/alternate-coder:7b (session)')));
});

test('interactive memory capture is non-blocking and exposes session-scoped undo and explanation', async () => {
  const inputs = ['I prefer concise test output.', '/memory', '/memory explain', '/memory undo', '/exit'];
  const output: string[] = [];
  const captured: string[] = [];
  let undoCalls = 0;
  const io: InteractiveSessionIo = {
    async question() { return inputs.shift(); },
    write(line) { output.push(line); },
    clear() {},
    close() {},
  };
  await runInteractiveSession({
    workspaceRoot: 'C:/workspace',
    initialRoute: { route: { provider: 'ollama', model: 'fixture' }, source: 'session' },
    approvalProfile: 'developer',
    io,
    runTask: async (task) => {
      captured.push(`run:${task}`);
      return { runId: 'run:memory', status: 'completed', outcome: 'not_evaluated' };
    },
    memory: {
      async capture(input) {
        captured.push(`memory:${input}`);
        return ['Remembered: I prefer concise test output. · /memory undo · /memory explain'];
      },
      async status() { return ['memory autosave: auto for this repository']; },
      async explain() { return ['remembered from exact direct input']; },
      async undo() {
        undoCalls++;
        return ['Undone. No recovery copy was retained.'];
      },
    },
  });
  assert.deepEqual(captured, [
    'memory:I prefer concise test output.',
    'run:I prefer concise test output.',
  ]);
  assert.equal(undoCalls, 1);
  assert.ok(output.some((line) => line.includes('/memory undo')));
  assert.ok(output.includes('memory autosave: auto for this repository'));
  assert.ok(output.includes('remembered from exact direct input'));
  assert.ok(output.some((line) => line.includes('No recovery copy')));
});
