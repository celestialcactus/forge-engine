import type { InferenceFinishReason, InferenceLocality } from '../slice0/contracts.js';

export type JsonObject = Readonly<Record<string, unknown>>;

export interface InferenceToolDefinition {
  readonly name: string;
  readonly capabilityId: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
}

export interface InferenceToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
}

export type InferenceMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string; readonly toolCalls?: readonly InferenceToolCall[] }
  | { readonly role: 'tool'; readonly toolCallId: string; readonly name: string; readonly content: string };

export interface ProviderInferenceRequest {
  readonly requestId: string;
  readonly model: string;
  readonly messages: readonly InferenceMessage[];
  readonly tools: readonly InferenceToolDefinition[];
}

export type NormalizedInferenceEvent =
  | { readonly type: 'text.delta'; readonly text: string }
  | {
      readonly type: 'tool_call.delta';
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsDelta: string;
    }
  | { readonly type: 'usage'; readonly inputTokens?: number; readonly outputTokens?: number }
  | { readonly type: 'response.completed'; readonly finishReason: InferenceFinishReason };

export interface InferenceProvider {
  readonly id: string;
  readonly locality: InferenceLocality;
  stream(request: ProviderInferenceRequest, signal: AbortSignal): AsyncIterable<NormalizedInferenceEvent>;
}

export interface InferenceRoute {
  readonly provider: 'ollama' | 'openai';
  readonly model: string;
}

export type InferenceFetch = typeof fetch;
