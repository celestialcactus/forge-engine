import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { InferenceEvidence, TaskPlanner } from '../src/slice0/contracts.js';
import type {
  InferenceProvider,
  NormalizedInferenceEvent,
  ProviderInferenceRequest,
} from '../src/inference/contracts.js';
import { developerEvidenceTools } from '../src/inference/developer-tools.js';
import { OllamaChatProvider } from '../src/inference/ollama.js';
import { OpenAiResponsesProvider } from '../src/inference/openai.js';
import { ProviderTaskPlanner } from '../src/inference/planner.js';
import { createInferenceProvider, resolveInferenceRoute } from '../src/inference/routing.js';
import { collectProviderInference } from '../src/inference/stream.js';
import { ForgeWorkspaceService, typeScriptConformanceFixture } from '../src/v1/service.js';

const route = { provider: 'ollama', model: 'fixture-model' } as const;
const request: ProviderInferenceRequest = {
  requestId: 'inference:fixture',
  model: route.model,
  messages: [{ role: 'user', content: 'Inspect the workspace.' }],
  tools: [],
};

const fixedNow = (...values: number[]): (() => number) => () => {
  const value = values.shift();
  if (value === undefined) throw new Error('Fixture clock exhausted.');
  return value;
};

test('normalizes an Ollama text stream into bounded terminal evidence', async () => {
  let posted: unknown;
  const provider = new OllamaChatProvider({
    fetch: async (_input, init) => {
      posted = JSON.parse(String(init?.body)) as unknown;
      return new Response([
        '{"message":{"content":"Forge"},"done":false}',
        '{"message":{"content":" ready"},"done":false}',
        '{"message":{"content":""},"done":true,"done_reason":"stop","prompt_eval_count":12,"eval_count":3}',
        '',
      ].join('\n'), { status: 200 });
    },
  });
  const result = await collectProviderInference(provider, route, request, new AbortController().signal, {
    now: fixedNow(10, 35),
  });
  assert.equal(result.text, 'Forge ready');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(result.evidence, {
    schemaVersion: 1,
    requestId: 'inference:fixture',
    provider: 'ollama',
    locality: 'local',
    model: 'fixture-model',
    finishReason: 'stop',
    durationMs: 25,
    outputCharacters: 11,
    toolCallCount: 0,
    usage: { inputTokens: 12, outputTokens: 3 },
    cost: { status: 'not_applicable' },
    routing: {
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      requestedModel: 'fixture-model',
      selectedModel: 'fixture-model',
      fallbackUsed: false,
    },
  });
  assert.deepEqual(posted, {
    model: 'fixture-model',
    messages: [{ role: 'user', content: 'Inspect the workspace.' }],
    tools: [],
    stream: true,
  });
});

test('normalizes Ollama and OpenAI tool streams to the same semantic call', async () => {
  const tool = developerEvidenceTools.find((candidate) => candidate.name === 'forge_workspace_read');
  if (tool === undefined) throw new Error('Read tool fixture is missing.');
  const toolRequest = { ...request, tools: [tool] };
  const ollama = new OllamaChatProvider({
    fetch: async () => new Response([
      '{"message":{"content":"","tool_calls":[{"function":{"name":"forge_workspace_read","arguments":{"path":"README.md","maxLines":5}}}]},"done":false}',
      '{"message":{"content":""},"done":true,"done_reason":"stop","prompt_eval_count":20,"eval_count":4}',
      '',
    ].join('\n'), { status: 200 }),
  });
  let authorization = '';
  let openAiBody: unknown;
  const openai = new OpenAiResponsesProvider({
    apiKey: 'fixture-secret',
    fetch: async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      openAiBody = JSON.parse(String(init?.body)) as unknown;
      return new Response([
        'data: {"type":"response.output_item.added","output_index":2,"item":{"type":"function_call","call_id":"inference:fixture:ollama-tool-0","name":"forge_workspace_read","arguments":""}}',
        '',
        'data: {"type":"response.function_call_arguments.delta","output_index":2,"delta":"{\\"path\\":\\"README.md\\",\\"maxLines\\":5}"}',
        '',
        'data: {"type":"response.function_call_arguments.done","output_index":2,"arguments":"{\\"path\\":\\"README.md\\",\\"maxLines\\":5}"}',
        '',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":20,"output_tokens":4}}}',
        '',
      ].join('\n'), { status: 200 });
    },
  });
  const ollamaResult = await collectProviderInference(ollama, route, toolRequest, new AbortController().signal, {
    now: fixedNow(0, 1),
  });
  const openAiResult = await collectProviderInference(
    openai,
    { provider: 'openai', model: route.model },
    toolRequest,
    new AbortController().signal,
    { now: fixedNow(0, 1) },
  );
  assert.deepEqual(openAiResult.toolCalls, ollamaResult.toolCalls);
  assert.equal(openAiResult.finishReason, 'tool_call');
  assert.deepEqual(openAiResult.evidence.usage, ollamaResult.evidence.usage);
  assert.equal(authorization, 'Bearer fixture-secret');
  assert.equal(JSON.stringify(openAiBody).includes('fixture-secret'), false);
  assert.equal((openAiBody as { parallel_tool_calls?: unknown }).parallel_tool_calls, false);
  assert.equal((openAiBody as { store?: unknown }).store, false);
});

test('runs a provider tool call and final response through the canonical Forge runtime', async () => {
  const observed: ProviderInferenceRequest[] = [];
  let turn = 0;
  const provider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(next): AsyncGenerator<NormalizedInferenceEvent> {
      observed.push(next);
      turn++;
      if (turn === 1) {
        yield {
          type: 'tool_call.delta',
          index: 0,
          id: 'provider-call-1',
          name: 'forge_workspace_read',
          argumentsDelta: '{"path":"README.md","startLine":1,"maxLines":2}',
        };
        yield { type: 'response.completed', finishReason: 'tool_call' };
        return;
      }
      yield { type: 'text.delta', text: 'The README evidence was returned by Forge.' };
      yield { type: 'response.completed', finishReason: 'stop' };
    },
  };
  const ids = ['inference:one', 'inference:two'];
  const planner = new ProviderTaskPlanner({
    provider,
    route,
    tools: developerEvidenceTools,
    requestIdFactory: () => ids.shift() ?? 'exhausted',
    now: fixedNow(0, 5, 10, 17),
  });
  const service = new ForgeWorkspaceService(resolve('tests/fixtures/slice1-workspace'), {
    runtime: typeScriptConformanceFixture,
    runIdFactory: () => 'run:provider-fixture',
  });
  const artifact = await service.executeTask('Read the fixture README.', planner, { maxTurns: 2 });
  service.close();
  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.output, 'The README evidence was returned by Forge.');
  assert.equal(artifact.capabilityResults.length, 1);
  assert.equal(artifact.capabilityResults[0]?.success, true);
  assert.equal(artifact.inferenceEvidence?.length, 2);
  assert.deepEqual(artifact.events.map((event) => event.type), [
    'run.started',
    'context.planned',
    'inference.completed',
    'capability.requested',
    'approval.decided',
    'capability.completed',
    'inference.completed',
    'run.completed',
  ]);
  const toolResult = observed[1]?.messages.find((message) => message.role === 'tool');
  assert.equal(toolResult?.role, 'tool');
  assert.match(toolResult?.content ?? '', /"path":"README.md"/u);
});

test('fails explicit routing and multiple-tool violations without fallback', async () => {
  assert.throws(() => resolveInferenceRoute(undefined, 'model'), /explicit --provider/u);
  assert.throws(() => resolveInferenceRoute('ollama', undefined), /explicit non-empty --model/u);
  assert.throws(
    () => createInferenceProvider({ provider: 'openai', model: 'fixture' }, { environment: {} }),
    /OPENAI_API_KEY/u,
  );
  const invalidProvider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(): AsyncGenerator<NormalizedInferenceEvent> {
      yield { type: 'tool_call.delta', index: 0, id: 'one', name: 'first', argumentsDelta: '{}' };
      yield { type: 'tool_call.delta', index: 1, id: 'two', name: 'second', argumentsDelta: '{}' };
      yield { type: 'response.completed', finishReason: 'tool_call' };
    },
  };
  await assert.rejects(
    collectProviderInference(invalidProvider, route, request, new AbortController().signal),
    /exactly one tool call/u,
  );
  await assert.rejects(
    collectProviderInference(invalidProvider, route, {
      ...request,
      messages: [{ role: 'user', content: 'x'.repeat(1_048_577) }],
    }, new AbortController().signal),
    /request exceeds 1048576 characters/u,
  );
});
test('records provider cancellation and rejects tampered inference evidence', async () => {
  const fixtureRoot = resolve('tests/fixtures/slice1-workspace');
  let markProviderStarted: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolveStarted) => { markProviderStarted = resolveStarted; });
  const waitingProvider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(_request, signal): AsyncGenerator<NormalizedInferenceEvent> {
      markProviderStarted?.();
      await new Promise<void>((resolveAbort) => {
        if (signal.aborted) resolveAbort();
        else signal.addEventListener('abort', () => resolveAbort(), { once: true });
      });
      signal.throwIfAborted();
    },
  };
  const cancellationService = new ForgeWorkspaceService(fixtureRoot, { runtime: typeScriptConformanceFixture });
  const controller = new AbortController();
  const pending = cancellationService.executeTask(
    'Wait for cancellation.',
    new ProviderTaskPlanner({ provider: waitingProvider, route, tools: [] }),
    {},
    controller.signal,
  );
  await providerStarted;
  controller.abort(new Error('Fixture cancelled inference.'));
  const cancelled = await pending;
  cancellationService.close();
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.events.at(-1)?.type, 'run.cancelled');
  assert.equal(cancelled.inferenceEvidence, undefined);

  const tampered = {
    schemaVersion: 1,
    requestId: 'inference:tampered',
    provider: 'ollama',
    locality: 'local',
    model: 'fixture-model',
    finishReason: 'stop',
    durationMs: 1,
    outputCharacters: 2,
    toolCallCount: 0,
    usage: {},
    cost: { status: 'not_applicable' },
    routing: {
      requestedProvider: 'ollama',
      selectedProvider: 'openai',
      requestedModel: 'fixture-model',
      selectedModel: 'fixture-model',
      fallbackUsed: true,
    },
  } as unknown as InferenceEvidence;
  const invalidPlanner: TaskPlanner = {
    id: 'tampered-inference-fixture',
    async next() { return { kind: 'complete', output: 'ok', inference: tampered }; },
  };
  const validationService = new ForgeWorkspaceService(fixtureRoot, { runtime: typeScriptConformanceFixture });
  const invalid = await validationService.executeTask('Reject tampered evidence.', invalidPlanner);
  validationService.close();
  assert.equal(invalid.status, 'failed');
  assert.equal(invalid.inferenceEvidence, undefined);
  assert.deepEqual(invalid.events.map((event) => event.type), ['run.started', 'context.planned', 'run.failed']);
  const failed = invalid.events.at(-1);
  assert.equal(failed?.type === 'run.failed' ? failed.code : undefined, 'invalid_inference_evidence');
});
