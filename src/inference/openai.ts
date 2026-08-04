import type {
  InferenceFetch,
  InferenceMessage,
  InferenceProvider,
  NormalizedInferenceEvent,
  ProviderInferenceRequest,
} from './contracts.js';
import { decodeSseData, requireSuccessfulResponse } from './http.js';

type JsonRecord = Record<string, unknown>;

const maximumContinuationCharacters = 1_048_576;

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;

const responseInput = (messages: readonly InferenceMessage[]): readonly JsonRecord[] => {
  const input: JsonRecord[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
      continue;
    }
    if (message.content.length > 0) input.push({ role: message.role, content: message.content });
    if (message.role === 'assistant' && message.toolCalls !== undefined) {
      for (const call of message.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        });
      }
    }
  }
  return input;
};

const outputIndex = (record: JsonRecord): number =>
  typeof record.output_index === 'number'
    && Number.isSafeInteger(record.output_index)
    && record.output_index >= 0
    ? record.output_index
    : 0;

const responseOutput = (record: JsonRecord): readonly JsonRecord[] | undefined => {
  const response = asRecord(record.response);
  if (!Array.isArray(response?.output)) return undefined;
  const output: JsonRecord[] = [];
  for (const item of response.output) {
    const candidate = asRecord(item);
    if (candidate === undefined || typeof candidate.type !== 'string') {
      throw new Error('OpenAI Responses completed with an invalid output item.');
    }
    output.push(candidate);
  }
  return output;
};

const failureMessage = (record: JsonRecord): string => {
  const response = asRecord(record.response);
  const error = asRecord(record.error) ?? asRecord(response?.error);
  return typeof error?.message === 'string' ? error.message : 'unknown provider error';
};

const usageEvent = (record: JsonRecord): NormalizedInferenceEvent | undefined => {
  const response = asRecord(record.response);
  const usage = asRecord(response?.usage);
  const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined;
  const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined;
  return inputTokens === undefined && outputTokens === undefined
    ? undefined
    : {
        type: 'usage',
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
      };
};

export interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: InferenceFetch;
}

export class OpenAiResponsesProvider implements InferenceProvider {
  readonly id = 'openai';
  readonly locality = 'cloud' as const;
  readonly #apiKey: string;
  readonly #endpoint: URL;
  readonly #fetch: InferenceFetch;
  #conversation: JsonRecord[] | undefined;
  #processedMessages = 0;
  #active = false;

  constructor(options: OpenAiProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error('OPENAI_API_KEY is required for the explicit OpenAI route.');
    this.#apiKey = options.apiKey;
    const base = options.baseUrl ?? 'https://api.openai.com';
    this.#endpoint = new URL('/v1/responses', base.endsWith('/') ? base : `${base}/`);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async *stream(request: ProviderInferenceRequest, signal: AbortSignal): AsyncGenerator<NormalizedInferenceEvent> {
    if (this.#active) throw new Error('OpenAI Responses provider does not permit concurrent streams.');
    this.#active = true;
    try {
      const input = this.#prepareInput(request.messages);
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          input,
          tools: request.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
          parallel_tool_calls: false,
          store: false,
          stream: true,
        }),
        signal,
      });
      await requireSuccessfulResponse(response, 'OpenAI Responses');
      const argumentDeltas = new Set<number>();
      const toolIndexes = new Map<number, number>();
      const outputItems = new Map<number, JsonRecord>();
      const functionItems = new Map<number, { callId: string; name: string; arguments: string }>();
      const toolIndex = (itemIndex: number): number => {
        const existing = toolIndexes.get(itemIndex);
        if (existing !== undefined) return existing;
        const normalized = toolIndexes.size;
        toolIndexes.set(itemIndex, normalized);
        return normalized;
      };
      for await (const data of decodeSseData(response.body)) {
        signal.throwIfAborted();
        if (data === '[DONE]') return;
        let decoded: unknown;
        try {
          decoded = JSON.parse(data) as unknown;
        } catch (error) {
          throw new Error(`OpenAI Responses emitted invalid SSE JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        const record = asRecord(decoded);
        if (record === undefined || typeof record.type !== 'string') throw new Error('OpenAI Responses emitted an event without a type.');
        if (record.type === 'response.output_text.delta') {
          if (typeof record.delta !== 'string') throw new Error('OpenAI text delta is not a string.');
          yield { type: 'text.delta', text: record.delta };
        } else if (record.type === 'response.output_item.added') {
          const item = asRecord(record.item);
          if (item?.type === 'function_call') {
            const itemIndex = outputIndex(record);
            const index = toolIndex(itemIndex);
            if (typeof item.call_id !== 'string' || typeof item.name !== 'string') {
              throw new Error('OpenAI function-call item is missing call_id or name.');
            }
            functionItems.set(itemIndex, { callId: item.call_id, name: item.name, arguments: '' });
            yield { type: 'tool_call.delta', index, id: item.call_id, name: item.name, argumentsDelta: '' };
          }
        } else if (record.type === 'response.function_call_arguments.delta') {
          const itemIndex = outputIndex(record);
          const index = toolIndex(itemIndex);
          if (typeof record.delta !== 'string') throw new Error('OpenAI function-call argument delta is not a string.');
          argumentDeltas.add(index);
          const functionItem = functionItems.get(itemIndex);
          if (functionItem !== undefined) functionItem.arguments += record.delta;
          yield { type: 'tool_call.delta', index, argumentsDelta: record.delta };
        } else if (record.type === 'response.function_call_arguments.done' || record.type === 'response.output_item.done') {
          const itemIndex = outputIndex(record);
          const item = record.type === 'response.output_item.done' ? asRecord(record.item) : record;
          if (record.type === 'response.output_item.done') {
            if (item === undefined || typeof item.type !== 'string') {
              throw new Error('OpenAI Responses emitted an invalid completed output item.');
            }
            outputItems.set(itemIndex, item);
          }
          if (item?.type === 'function_call' || record.type === 'response.function_call_arguments.done') {
            const index = toolIndex(itemIndex);
            const id = typeof item?.call_id === 'string' ? item.call_id : undefined;
            const name = typeof item?.name === 'string' ? item.name : undefined;
            const argumentsText = typeof item?.arguments === 'string' && !argumentDeltas.has(index) ? item.arguments : '';
            const functionItem = functionItems.get(itemIndex);
            if (functionItem !== undefined && typeof item?.arguments === 'string') functionItem.arguments = item.arguments;
            yield {
              type: 'tool_call.delta',
              index,
              ...(id === undefined ? {} : { id }),
              ...(name === undefined ? {} : { name }),
              argumentsDelta: argumentsText,
            };
          }
        } else if (record.type === 'response.completed') {
          const completed = responseOutput(record);
          this.#appendOutputItems(completed ?? this.#completedItems(outputItems, functionItems));
          const usage = usageEvent(record);
          if (usage !== undefined) yield usage;
          yield { type: 'response.completed', finishReason: toolIndexes.size > 0 ? 'tool_call' : 'stop' };
          return;
        } else if (record.type === 'response.incomplete') {
          const usage = usageEvent(record);
          if (usage !== undefined) yield usage;
          const responseRecord = asRecord(record.response);
          const detail = asRecord(responseRecord?.incomplete_details);
          const reason = detail?.reason;
          yield {
            type: 'response.completed',
            finishReason: reason === 'content_filter' ? 'content_filter' : reason === 'max_output_tokens' ? 'length' : 'error',
          };
          return;
        } else if (record.type === 'response.failed' || record.type === 'error') {
          throw new Error(`OpenAI Responses inference failed: ${failureMessage(record)}`);
        }
      }
    } finally {
      this.#active = false;
    }
  }

  #prepareInput(messages: readonly InferenceMessage[]): readonly JsonRecord[] {
    if (this.#conversation === undefined) {
      this.#conversation = [...responseInput(messages)];
      this.#processedMessages = messages.length;
      this.#assertConversationBound();
      return this.#conversation;
    }
    if (messages.length < this.#processedMessages) {
      throw new Error('OpenAI Responses message history moved backwards between turns.');
    }
    for (const message of messages.slice(this.#processedMessages)) {
      if (message.role === 'assistant') continue;
      if (message.role !== 'tool') {
        throw new Error('OpenAI Responses provider cannot be reused for a different conversation.');
      }
      this.#conversation.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content,
      });
    }
    this.#processedMessages = messages.length;
    this.#assertConversationBound();
    return this.#conversation;
  }

  #completedItems(
    outputItems: ReadonlyMap<number, JsonRecord>,
    functionItems: ReadonlyMap<number, { callId: string; name: string; arguments: string }>,
  ): readonly JsonRecord[] {
    const indexes = new Set([...outputItems.keys(), ...functionItems.keys()]);
    return [...indexes].sort((left, right) => left - right).map((index) => {
      const output = outputItems.get(index);
      if (output !== undefined) return output;
      const functionItem = functionItems.get(index);
      if (functionItem === undefined) throw new Error('OpenAI Responses output item disappeared during normalization.');
      return {
        type: 'function_call',
        call_id: functionItem.callId,
        name: functionItem.name,
        arguments: functionItem.arguments,
      };
    });
  }

  #appendOutputItems(items: readonly JsonRecord[]): void {
    if (this.#conversation === undefined) throw new Error('OpenAI Responses continuation was not initialized.');
    this.#conversation.push(...items);
    this.#assertConversationBound();
  }

  #assertConversationBound(): void {
    if (this.#conversation === undefined) return;
    if (JSON.stringify(this.#conversation).length > maximumContinuationCharacters) {
      throw new Error(`OpenAI Responses continuation exceeded ${maximumContinuationCharacters} characters.`);
    }
  }
}
