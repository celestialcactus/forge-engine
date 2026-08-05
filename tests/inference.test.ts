import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { InferenceEvidence, TaskPlanner } from '../src/slice0/contracts.js';
import type {
  InferenceProvider,
  NormalizedInferenceEvent,
  ProviderInferenceObservation,
  ProviderInferenceRequest,
} from '../src/inference/contracts.js';
import { developerEvidenceTools } from '../src/inference/developer-tools.js';
import { OllamaChatProvider } from '../src/inference/ollama.js';
import { OpenAiResponsesProvider } from '../src/inference/openai.js';
import { ProviderTaskPlanner } from '../src/inference/planner.js';
import { createInferenceProvider, resolveInferenceRoute } from '../src/inference/routing.js';
import { collectProviderInference } from '../src/inference/stream.js';
import { providerToolResultContent } from '../src/inference/tool-evidence.js';
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
  const normalizedEvents: NormalizedInferenceEvent[] = [];
  const result = await collectProviderInference(provider, route, request, new AbortController().signal, {
    now: fixedNow(10, 35),
    onEvent: (event) => normalizedEvents.push(event),
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
  assert.deepEqual(normalizedEvents.map((event) => event.type), [
    'text.delta',
    'text.delta',
    'usage',
    'response.completed',
  ]);
  assert.deepEqual(posted, {
    model: 'fixture-model',
    options: { num_ctx: 8_192, temperature: 0 },
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
test('replays complete OpenAI output items across store:false tool turns', async () => {
  const bodies: Array<{ readonly input?: unknown; readonly store?: unknown }> = [];
  let turn = 0;
  const reasoningItem = {
    type: 'reasoning',
    id: 'reasoning-1',
    encrypted_content: 'sealed-reasoning-fixture',
    summary: [],
  };
  const functionArguments = JSON.stringify({ path: 'README.md', maxLines: 5 });
  const functionItem = {
    type: 'function_call',
    id: 'function-1',
    call_id: 'provider-call-1',
    name: 'forge_workspace_read',
    arguments: functionArguments,
  };
  const stream = (...events: readonly Record<string, unknown>[]): string =>
    events.map((event) => 'data: ' + JSON.stringify(event)).join('\n\n') + '\n\n';
  const provider = new OpenAiResponsesProvider({
    apiKey: 'fixture-secret',
    fetch: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as { readonly input?: unknown; readonly store?: unknown });
      turn++;
      if (turn === 1) {
        return new Response(stream(
          { type: 'response.output_item.done', output_index: 0, item: reasoningItem },
          {
            type: 'response.output_item.added',
            output_index: 1,
            item: {
              type: 'function_call',
              id: 'function-1',
              call_id: 'provider-call-1',
              name: 'forge_workspace_read',
              arguments: '',
            },
          },
          { type: 'response.function_call_arguments.delta', output_index: 1, delta: functionArguments },
          { type: 'response.output_item.done', output_index: 1, item: functionItem },
          { type: 'response.completed', response: { usage: { input_tokens: 20, output_tokens: 4 } } },
        ), { status: 200 });
      }
      return new Response(stream(
        { type: 'response.output_text.delta', delta: 'done' },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'message',
            id: 'message-2',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'done', annotations: [] }],
          },
        },
        { type: 'response.completed', response: { usage: { input_tokens: 30, output_tokens: 2 } } },
      ), { status: 200 });
    },
  });
  const tool = developerEvidenceTools.find((candidate) => candidate.name === 'forge_workspace_read');
  if (tool === undefined) throw new Error('Read tool fixture is missing.');
  const firstRequest: ProviderInferenceRequest = {
    requestId: 'inference:openai-one',
    model: 'fixture-model',
    messages: [{ role: 'user', content: 'Inspect the workspace.' }],
    tools: [tool],
  };
  const first = await collectProviderInference(
    provider,
    { provider: 'openai', model: 'fixture-model' },
    firstRequest,
    new AbortController().signal,
    { now: fixedNow(0, 1) },
  );
  const providerCall = first.toolCalls[0];
  if (providerCall === undefined) throw new Error('OpenAI tool call fixture was not normalized.');
  const second = await collectProviderInference(
    provider,
    { provider: 'openai', model: 'fixture-model' },
    {
      requestId: 'inference:openai-two',
      model: 'fixture-model',
      messages: [
        ...firstRequest.messages,
        { role: 'assistant', content: first.text, toolCalls: first.toolCalls },
        {
          role: 'tool',
          toolCallId: providerCall.id,
          name: providerCall.name,
          content: '{"ok":true}',
        },
      ],
      tools: [tool],
    },
    new AbortController().signal,
    { now: fixedNow(2, 3) },
  );
  assert.equal(second.text, 'done');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1]?.store, false);
  assert.deepEqual(bodies[1]?.input, [
    { role: 'user', content: 'Inspect the workspace.' },
    reasoningItem,
    functionItem,
    {
      type: 'function_call_output',
      call_id: 'provider-call-1',
      output: '{"ok":true}',
    },
  ]);
  const secondInput = bodies[1]?.input;
  assert.ok(Array.isArray(secondInput));
  assert.equal(secondInput.filter((item) =>
    typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'function_call').length, 1);
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
        yield { type: 'usage', inputTokens: 20, outputTokens: 4 };
        yield { type: 'response.completed', finishReason: 'tool_call' };
        return;
      }
      yield { type: 'text.delta', text: 'The README evidence was returned by Forge.' };
      yield { type: 'usage', inputTokens: 30, outputTokens: 5 };
      yield { type: 'response.completed', finishReason: 'stop' };
    },
  };
  const ids = ['inference:one', 'inference:two'];
  const observations: ProviderInferenceObservation[] = [];
  const planner = new ProviderTaskPlanner({
    provider,
    route,
    tools: developerEvidenceTools,
    requestIdFactory: () => ids.shift() ?? 'exhausted',
    now: fixedNow(0, 5, 10, 17),
    onInferenceEvent: (observation) => observations.push(observation),
  });
  const service = new ForgeWorkspaceService(resolve('tests/fixtures/slice1-workspace'), {
    runtime: typeScriptConformanceFixture,
    runIdFactory: () => 'run:provider-fixture',
  });
  const streamedRunEvents: string[] = [];
  const artifact = await service.executeTask('Read the fixture README.', planner, {
    maxTurns: 2,
    onEvent: (event) => streamedRunEvents.push(event.type),
  });
  service.close();
  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.outcome.status, 'not_evaluated');
  assert.equal(artifact.output, 'The README evidence was returned by Forge.');
  assert.equal(artifact.capabilityResults.length, 1);
  assert.equal(artifact.capabilityResults[0]?.success, true);
  assert.equal(artifact.inferenceEvidence?.length, 2);
  assert.deepEqual(streamedRunEvents, artifact.events.map((event) => event.type));
  assert.deepEqual(observations.map((observation) => ({
    requestId: observation.requestId,
    provider: observation.provider,
    model: observation.model,
    type: observation.event.type,
  })), [
    { requestId: 'inference:one', provider: 'ollama', model: 'fixture-model', type: 'tool_call.delta' },
    { requestId: 'inference:one', provider: 'ollama', model: 'fixture-model', type: 'usage' },
    { requestId: 'inference:one', provider: 'ollama', model: 'fixture-model', type: 'response.completed' },
    { requestId: 'inference:two', provider: 'ollama', model: 'fixture-model', type: 'text.delta' },
    { requestId: 'inference:two', provider: 'ollama', model: 'fixture-model', type: 'usage' },
    { requestId: 'inference:two', provider: 'ollama', model: 'fixture-model', type: 'response.completed' },
  ]);
  assert.deepEqual(artifact.events.map((event) => event.type), [
    'run.started',
    'context.planned',
    'inference.completed',
    'capability.requested',
    'approval.decided',
    'capability.completed',
    'inference.completed',
    'outcome.assessed',
    'run.completed',
  ]);
  const toolResult = observed[1]?.messages.find((message) => message.role === 'tool');
  assert.equal(toolResult?.role, 'tool');
  assert.match(toolResult?.content ?? '', /Forge capability evidence: workspace\.read/u);
  assert.match(toolResult?.content ?? '', /path: README\.md/u);
  assert.match(toolResult?.content ?? '', /1: # Slice 1 fixture/u);
  assert.doesNotMatch(toolResult?.content ?? '', /"text":/u);
  const system = observed[0]?.messages.find((message) => message.role === 'system');
  assert.match(system?.content ?? '', /Final answers must directly answer the developer in plain text/u);
  const developerContext = observed[0]?.messages.find((message) => message.role === 'user');
  assert.match(developerContext?.content ?? '', /Manifest counts are not file contents or source evidence/u);
  assert.match(developerContext?.content ?? '', /new planning turn begins and you may call one additional tool/u);
  assert.doesNotMatch(developerContext?.content ?? '', /workspace:\/\//u);
});

test('restores provider conversation state without duplicating the completed inference turn', async () => {
  let initialCalls = 0;
  const initialProvider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(): AsyncGenerator<NormalizedInferenceEvent> {
      initialCalls++;
      yield {
        type: 'tool_call.delta',
        index: 0,
        id: 'provider-call-recovered',
        name: 'forge_workspace_read',
        argumentsDelta: '{"path":"README.md","startLine":1,"maxLines":2}',
      };
      yield { type: 'response.completed', finishReason: 'tool_call' };
    },
  };
  const plannerRequest = {
    task: 'Read the fixture README.',
    contextPlan: {
      id: 'context:recovery',
      budgetBytes: 65_536,
      selected: [],
      omitted: [],
    },
    capabilityResults: [],
    turn: 1,
  } as const;
  const original = new ProviderTaskPlanner({
    provider: initialProvider,
    route,
    tools: developerEvidenceTools,
    requestIdFactory: () => 'inference:before-restart',
    now: fixedNow(0, 1),
  });
  const firstTurn = await original.next(plannerRequest, new AbortController().signal);
  assert.equal(firstTurn.kind, 'call');
  assert.equal(initialCalls, 1);
  const checkpoint = original.checkpoint();

  const resumedRequests: ProviderInferenceRequest[] = [];
  const resumedProvider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(next): AsyncGenerator<NormalizedInferenceEvent> {
      resumedRequests.push(next);
      yield { type: 'text.delta', text: 'Recovered from the durable tool boundary.' };
      yield { type: 'response.completed', finishReason: 'stop' };
    },
  };
  const resumed = new ProviderTaskPlanner({
    provider: resumedProvider,
    route,
    tools: developerEvidenceTools,
    requestIdFactory: () => 'inference:after-restart',
    now: fixedNow(2, 3),
  });
  resumed.restore(checkpoint);
  assert.equal(firstTurn.kind, 'call');
  const finalTurn = await resumed.next({
    ...plannerRequest,
    turn: 2,
    capabilityResults: [{
      callId: firstTurn.call.id,
      success: true,
      content: 'path: README.md\n1: # Slice 1 fixture',
    }],
  }, new AbortController().signal);

  assert.deepEqual(finalTurn.kind === 'complete' ? finalTurn.output : undefined,
    'Recovered from the durable tool boundary.');
  assert.equal(initialCalls, 1, 'the completed provider request must not be issued again');
  assert.equal(resumedRequests.length, 1);
  const resumedMessages = resumedRequests[0]?.messages ?? [];
  assert.equal(resumedMessages.filter((message) => message.role === 'user').length, 1);
  const assistant = resumedMessages.find((message) => message.role === 'assistant');
  assert.equal(assistant?.role, 'assistant');
  assert.equal(assistant?.role === 'assistant' ? assistant.toolCalls?.[0]?.id : undefined,
    'provider-call-recovered');
  const toolResult = resumedMessages.find((message) => message.role === 'tool');
  assert.equal(toolResult?.role === 'tool' ? toolResult.toolCallId : undefined,
    'provider-call-recovered');
  assert.equal(toolResult?.role === 'tool' ? toolResult.name : undefined,
    'forge_workspace_read');

  const wrongModel = JSON.parse(JSON.stringify(checkpoint)) as {
    schemaVersion: 1;
    plannerId: string;
    state: { model: string };
  };
  wrongModel.state.model = 'different-model';
  const invalidTarget = new ProviderTaskPlanner({
    provider: resumedProvider,
    route,
    tools: developerEvidenceTools,
  });
  assert.throws(() => invalidTarget.restore(wrongModel), /checkpoint state is invalid/u);

  const wrongCorrelation = JSON.parse(JSON.stringify(checkpoint)) as {
    schemaVersion: 1;
    plannerId: string;
    state: {
      messages: Array<{
        role: string;
        toolCalls?: Array<{ id: string }>;
      }>;
    };
  };
  const toolCall = wrongCorrelation.state.messages
    .find((message) => message.role === 'assistant')
    ?.toolCalls?.[0];
  assert.ok(toolCall);
  toolCall.id = 'tampered-provider-call';
  const correlationTarget = new ProviderTaskPlanner({
    provider: resumedProvider,
    route,
    tools: developerEvidenceTools,
  });
  assert.throws(
    () => correlationTarget.restore(wrongCorrelation),
    /pending tool correlation is invalid/u,
  );
});

test('fails closed when a provider prints a tool envelope as terminal text', async () => {
  const provider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(): AsyncGenerator<NormalizedInferenceEvent> {
      yield {
        type: 'text.delta',
        text: '<tool_response>{"path":"src/live-cli.ts","startLine":130}</tool_response>',
      };
      yield { type: 'response.completed', finishReason: 'stop' };
    },
  };
  const planner = new ProviderTaskPlanner({
    provider,
    route,
    tools: developerEvidenceTools,
    now: fixedNow(0, 1),
  });
  const service = new ForgeWorkspaceService(resolve('tests/fixtures/slice1-workspace'), {
    runtime: typeScriptConformanceFixture,
    runIdFactory: () => 'run:leaked-tool-envelope',
  });
  const artifact = await service.executeTask('Read source evidence.', planner);
  service.close();
  assert.equal(artifact.status, 'failed');
  assert.equal(artifact.output, undefined);
  assert.equal(artifact.capabilityResults.length, 0);
  const terminal = artifact.events.at(-1);
  assert.equal(terminal?.type, 'run.failed');
  assert.equal(terminal?.type === 'run.failed' ? terminal.code : undefined, 'runtime_error');
  assert.match(
    terminal?.type === 'run.failed' ? terminal.message : '',
    /tool-protocol envelope as terminal text/u,
  );
});

test('fails closed when a provider prints a registered tool call as terminal JSON', async () => {
  const provider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(): AsyncGenerator<NormalizedInferenceEvent> {
      yield {
        type: 'text.delta',
        text: '{"name":"forge_workspace_read","arguments":{"path":"README.md"}}',
      };
      yield { type: 'response.completed', finishReason: 'stop' };
    },
  };
  const planner = new ProviderTaskPlanner({
    provider,
    route,
    tools: developerEvidenceTools,
    now: fixedNow(0, 1),
  });
  const service = new ForgeWorkspaceService(resolve('tests/fixtures/slice1-workspace'), {
    runtime: typeScriptConformanceFixture,
    runIdFactory: () => 'run:printed-tool-json',
  });
  const artifact = await service.executeTask('Read source evidence.', planner);
  service.close();
  assert.equal(artifact.status, 'failed');
  const terminal = artifact.events.at(-1);
  assert.equal(terminal?.type, 'run.failed');
  assert.match(
    terminal?.type === 'run.failed' ? terminal.message : '',
    /printed a registered Forge tool call as terminal JSON/u,
  );
});

test('compacts duplicate read evidence before returning it to a provider', () => {
  const lines = Array.from({ length: 80 }, (_, index) => ({
    line: index + 1,
    text: 'const fixture' + index + ' = "bounded evidence";',
  }));
  const raw = JSON.stringify({
    snapshotId: 'workspace:fixture',
    path: 'src/example.ts',
    sha256: 'a'.repeat(64),
    startLine: 1,
    endLine: 80,
    totalLines: 100,
    text: lines.map((line) => line.text).join('\n'),
    lines,
    truncated: true,
  });
  const compact = providerToolResultContent('workspace.read', raw);
  assert.ok(compact.length < raw.length * 0.7);
  assert.match(compact, /snapshot: workspace:fixture/u);
  assert.match(compact, /range: 1-80 of 100/u);
  assert.match(compact, /80: const fixture79/u);
  assert.doesNotMatch(compact, /"text":/u);
  assert.equal(providerToolResultContent('git.status', raw), raw);
});

test('fails explicit routing and multiple-tool violations without fallback', async () => {
  assert.throws(() => resolveInferenceRoute(undefined, 'model'), /explicit --provider/u);
  assert.throws(() => resolveInferenceRoute('ollama', undefined), /explicit non-empty --model/u);
  assert.throws(
    () => createInferenceProvider({ provider: 'openai', model: 'fixture' }, { environment: {} }),
    /OPENAI_API_KEY/u,
  );
  assert.throws(
    () => createInferenceProvider(
      { provider: 'ollama', model: 'fixture' },
      { environment: { FORGE_OLLAMA_CONTEXT_TOKENS: '1024' } },
    ),
    /FORGE_OLLAMA_CONTEXT_TOKENS/u,
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
