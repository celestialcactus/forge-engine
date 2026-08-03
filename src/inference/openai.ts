import type {
  InferenceFetch,
  InferenceMessage,
  InferenceProvider,
  NormalizedInferenceEvent,
  ProviderInferenceRequest,
} from './contracts.js';
import { decodeSseData, requireSuccessfulResponse } from './http.js';

type JsonRecord = Record<string, unknown>;

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

  constructor(options: OpenAiProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error('OPENAI_API_KEY is required for the explicit OpenAI route.');
    this.#apiKey = options.apiKey;
    const base = options.baseUrl ?? 'https://api.openai.com';
    this.#endpoint = new URL('/v1/responses', base.endsWith('/') ? base : `${base}/`);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async *stream(request: ProviderInferenceRequest, signal: AbortSignal): AsyncGenerator<NormalizedInferenceEvent> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        input: responseInput(request.messages),
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
    const toolIndex = (outputIndex: number): number => {
      const existing = toolIndexes.get(outputIndex);
      if (existing !== undefined) return existing;
      const normalized = toolIndexes.size;
      toolIndexes.set(outputIndex, normalized);
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
          const index = toolIndex(typeof record.output_index === 'number' ? record.output_index : 0);
          if (typeof item.call_id !== 'string' || typeof item.name !== 'string') {
            throw new Error('OpenAI function-call item is missing call_id or name.');
          }
          yield { type: 'tool_call.delta', index, id: item.call_id, name: item.name, argumentsDelta: '' };
        }
      } else if (record.type === 'response.function_call_arguments.delta') {
        const index = toolIndex(typeof record.output_index === 'number' ? record.output_index : 0);
        if (typeof record.delta !== 'string') throw new Error('OpenAI function-call argument delta is not a string.');
        argumentDeltas.add(index);
        yield { type: 'tool_call.delta', index, argumentsDelta: record.delta };
      } else if (record.type === 'response.function_call_arguments.done' || record.type === 'response.output_item.done') {
        const item = record.type === 'response.output_item.done' ? asRecord(record.item) : record;
        if (item?.type === 'function_call' || record.type === 'response.function_call_arguments.done') {
          const index = toolIndex(typeof record.output_index === 'number' ? record.output_index : 0);
          const id = typeof item?.call_id === 'string' ? item.call_id : undefined;
          const name = typeof item?.name === 'string' ? item.name : undefined;
          const argumentsText = typeof item?.arguments === 'string' && !argumentDeltas.has(index) ? item.arguments : '';
          yield {
            type: 'tool_call.delta',
            index,
            ...(id === undefined ? {} : { id }),
            ...(name === undefined ? {} : { name }),
            argumentsDelta: argumentsText,
          };
        }
      } else if (record.type === 'response.completed') {
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
  }
}
