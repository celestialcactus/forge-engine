import type { InferenceEvidence, InferenceFinishReason } from '../slice0/contracts.js';
import type {
  InferenceProvider,
  InferenceRoute,
  InferenceToolCall,
  JsonObject,
  ProviderInferenceRequest,
} from './contracts.js';

const maximumTextCharacters = 65_536;
const maximumToolArgumentCharacters = 65_536;
const maximumIdentifierCharacters = 512;
const maximumRequestCharacters = 1_048_576;
const maximumMessages = 128;
const maximumTools = 64;

type ToolAccumulator = { id?: string; name?: string; arguments: string };

export interface CollectedInference {
  readonly text: string;
  readonly toolCalls: readonly InferenceToolCall[];
  readonly finishReason: InferenceFinishReason;
  readonly evidence: InferenceEvidence;
}

export interface CollectInferenceOptions {
  readonly now?: () => number;
}

const nonNegativeInteger = (value: number | undefined, label: string): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
};

const setStable = (current: string | undefined, next: string | undefined, label: string): string | undefined => {
  if (next === undefined) return current;
  if (next.length === 0 || next.length > maximumIdentifierCharacters) throw new Error(`${label} has an invalid length.`);
  if (current !== undefined && current !== next) throw new Error(`${label} changed during a streamed tool call.`);
  return next;
};

const objectArguments = (raw: string): JsonObject => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Provider tool arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Provider tool arguments must decode to an object.');
  }
  return value as JsonObject;
};

const validateProviderRequest = (
  provider: InferenceProvider,
  route: InferenceRoute,
  request: ProviderInferenceRequest,
): void => {
  if (provider.id.length === 0 || provider.id.length > 100) throw new Error('Inference provider ID has an invalid length.');
  if (request.requestId.length === 0 || request.requestId.length > maximumIdentifierCharacters) {
    throw new Error('Inference request ID has an invalid length.');
  }
  if (request.model.length === 0 || request.model.length > 200) throw new Error('Inference model has an invalid length.');
  if (request.messages.length === 0 || request.messages.length > maximumMessages) {
    throw new Error(`Inference request must contain from 1 to ${maximumMessages} messages.`);
  }
  if (request.tools.length > maximumTools) throw new Error(`Inference request exceeds ${maximumTools} tools.`);
  const names = new Set<string>();
  let characters = 0;
  for (const message of request.messages) {
    characters += message.content.length;
    if (message.role === 'tool') characters += message.toolCallId.length + message.name.length;
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        characters += call.id.length + call.name.length + JSON.stringify(call.arguments).length;
      }
    }
  }
  for (const tool of request.tools) {
    if (tool.name.length === 0 || tool.name.length > 128 || names.has(tool.name)) {
      throw new Error(`Inference tool name is invalid or duplicated: ${tool.name}`);
    }
    names.add(tool.name);
    characters += tool.name.length + tool.capabilityId.length + tool.description.length + JSON.stringify(tool.inputSchema).length;
  }
  if (characters > maximumRequestCharacters) {
    throw new Error(`Inference request exceeds ${maximumRequestCharacters} characters.`);
  }
  if (provider.id !== route.provider) throw new Error(`Selected provider ${provider.id} does not match requested route ${route.provider}.`);
  if (request.model !== route.model) throw new Error(`Selected model ${request.model} does not match requested route ${route.model}.`);
};

export async function collectProviderInference(
  provider: InferenceProvider,
  route: InferenceRoute,
  request: ProviderInferenceRequest,
  signal: AbortSignal,
  options: CollectInferenceOptions = {},
): Promise<CollectedInference> {
  validateProviderRequest(provider, route, request);
  const now = options.now ?? performance.now.bind(performance);
  const started = now();
  let text = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: InferenceFinishReason | undefined;
  const tools = new Map<number, ToolAccumulator>();

  for await (const event of provider.stream(request, signal)) {
    signal.throwIfAborted();
    if (finishReason !== undefined) throw new Error('Inference provider emitted data after response.completed.');
    if (event.type === 'text.delta') {
      text += event.text;
      if (text.length > maximumTextCharacters) throw new Error(`Inference text exceeds ${maximumTextCharacters} characters.`);
    } else if (event.type === 'tool_call.delta') {
      if (!Number.isSafeInteger(event.index) || event.index < 0) throw new Error('Tool-call index must be a non-negative safe integer.');
      if (event.index !== 0 || (tools.size === 1 && !tools.has(event.index))) {
        throw new Error('This Forge slice permits exactly one tool call per model turn.');
      }
      const current = tools.get(event.index) ?? { arguments: '' };
      const id = setStable(current.id, event.id, 'Tool-call ID');
      const name = setStable(current.name, event.name, 'Tool-call name');
      if (id !== undefined) current.id = id;
      if (name !== undefined) current.name = name;
      current.arguments += event.argumentsDelta;
      if (current.arguments.length > maximumToolArgumentCharacters) {
        throw new Error(`Tool arguments exceed ${maximumToolArgumentCharacters} characters.`);
      }
      tools.set(event.index, current);
    } else if (event.type === 'usage') {
      inputTokens = nonNegativeInteger(event.inputTokens, 'inputTokens') ?? inputTokens;
      outputTokens = nonNegativeInteger(event.outputTokens, 'outputTokens') ?? outputTokens;
    } else {
      finishReason = event.finishReason;
    }
  }
  signal.throwIfAborted();
  if (finishReason === undefined) throw new Error('Inference provider ended without response.completed.');

  const toolCalls = [...tools.entries()].sort(([left], [right]) => left - right).map(([, tool]) => {
    if (tool.id === undefined || tool.name === undefined) throw new Error('Provider completed an incomplete tool call.');
    return { id: tool.id, name: tool.name, arguments: objectArguments(tool.arguments) };
  });
  if ((finishReason === 'tool_call') !== (toolCalls.length === 1)) {
    throw new Error(`Provider finish reason ${finishReason} does not match its tool-call payload.`);
  }
  const durationMs = Math.max(0, Math.round(now() - started));
  if (!Number.isSafeInteger(durationMs)) throw new Error('Inference duration is outside the supported range.');
  const usage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
  return {
    text,
    toolCalls,
    finishReason,
    evidence: {
      schemaVersion: 1,
      requestId: request.requestId,
      provider: provider.id,
      locality: provider.locality,
      model: request.model,
      finishReason,
      durationMs,
      outputCharacters: Array.from(text).length,
      toolCallCount: toolCalls.length,
      usage,
      cost: { status: provider.locality === 'local' ? 'not_applicable' : 'unavailable' },
      routing: {
        requestedProvider: route.provider,
        selectedProvider: provider.id,
        requestedModel: route.model,
        selectedModel: request.model,
        fallbackUsed: false,
      },
    },
  };
}
