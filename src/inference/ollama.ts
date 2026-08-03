import type {
  InferenceFetch,
  InferenceMessage,
  InferenceProvider,
  NormalizedInferenceEvent,
  ProviderInferenceRequest,
} from './contracts.js';
import { decodeResponseLines, requireSuccessfulResponse } from './http.js';

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;

const ollamaMessage = (message: InferenceMessage): JsonRecord => {
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, tool_name: message.name };
  }
  if (message.role === 'assistant' && message.toolCalls !== undefined) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
};

const toolArguments = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (asRecord(value) !== undefined) return JSON.stringify(value);
  throw new Error('Ollama returned tool arguments that are neither an object nor a JSON string.');
};

export interface OllamaProviderOptions {
  readonly baseUrl?: string;
  readonly fetch?: InferenceFetch;
}

export class OllamaChatProvider implements InferenceProvider {
  readonly id = 'ollama';
  readonly locality = 'local' as const;
  readonly #endpoint: URL;
  readonly #fetch: InferenceFetch;

  constructor(options: OllamaProviderOptions = {}) {
    const base = options.baseUrl ?? 'http://127.0.0.1:11434';
    this.#endpoint = new URL('/api/chat', base.endsWith('/') ? base : `${base}/`);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async *stream(request: ProviderInferenceRequest, signal: AbortSignal): AsyncGenerator<NormalizedInferenceEvent> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(ollamaMessage),
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        stream: true,
      }),
      signal,
    });
    await requireSuccessfulResponse(response, 'Ollama');
    let toolObserved = false;
    for await (const line of decodeResponseLines(response.body)) {
      signal.throwIfAborted();
      if (line.trim().length === 0) continue;
      let decoded: unknown;
      try {
        decoded = JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`Ollama emitted invalid NDJSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      const record = asRecord(decoded);
      if (record === undefined) throw new Error('Ollama emitted a non-object response frame.');
      if (typeof record.error === 'string') throw new Error(`Ollama inference failed: ${record.error}`);
      const message = asRecord(record.message);
      if (typeof message?.content === 'string' && message.content.length > 0) {
        yield { type: 'text.delta', text: message.content };
      }
      if (Array.isArray(message?.tool_calls)) {
        for (const [index, rawCall] of message.tool_calls.entries()) {
          const call = asRecord(rawCall);
          const fn = asRecord(call?.function);
          if (typeof fn?.name !== 'string') throw new Error('Ollama returned a tool call without a function name.');
          toolObserved = true;
          yield {
            type: 'tool_call.delta',
            index,
            id: typeof call?.id === 'string' ? call.id : `${request.requestId}:ollama-tool-${index}`,
            name: fn.name,
            argumentsDelta: toolArguments(fn.arguments),
          };
        }
      }
      if (record.done === true) {
        const inputTokens = typeof record.prompt_eval_count === 'number' ? record.prompt_eval_count : undefined;
        const outputTokens = typeof record.eval_count === 'number' ? record.eval_count : undefined;
        if (inputTokens !== undefined || outputTokens !== undefined) {
          yield {
            type: 'usage',
            ...(inputTokens === undefined ? {} : { inputTokens }),
            ...(outputTokens === undefined ? {} : { outputTokens }),
          };
        }
        const doneReason = typeof record.done_reason === 'string' ? record.done_reason : 'stop';
        yield {
          type: 'response.completed',
          finishReason: toolObserved ? 'tool_call' : doneReason === 'length' ? 'length' : 'stop',
        };
        return;
      }
    }
  }
}
