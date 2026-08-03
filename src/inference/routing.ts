import type { InferenceFetch, InferenceProvider, InferenceRoute } from './contracts.js';
import { OllamaChatProvider } from './ollama.js';
import { OpenAiResponsesProvider } from './openai.js';

export interface InferenceProviderFactoryOptions {
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly fetch?: InferenceFetch;
}

const optionalContextWindow = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 2_048 || value > 262_144) {
    throw new Error('FORGE_OLLAMA_CONTEXT_TOKENS must be an integer from 2048 to 262144.');
  }
  return value;
};

export function resolveInferenceRoute(provider: string | undefined, model: string | undefined): InferenceRoute {
  if (provider !== 'ollama' && provider !== 'openai') {
    throw new Error('forge run requires an explicit --provider <ollama|openai>. No fallback route is selected.');
  }
  if (model === undefined || model.trim().length === 0 || model.length > 200) {
    throw new Error('forge run requires an explicit non-empty --model value of at most 200 characters.');
  }
  return { provider, model: model.trim() };
}

export function createInferenceProvider(
  route: InferenceRoute,
  options: InferenceProviderFactoryOptions = {},
): InferenceProvider {
  const environment = options.environment ?? process.env;
  if (route.provider === 'ollama') {
    const contextWindowTokens = optionalContextWindow(environment.FORGE_OLLAMA_CONTEXT_TOKENS);
    return new OllamaChatProvider({
      ...(environment.FORGE_OLLAMA_URL === undefined ? {} : { baseUrl: environment.FORGE_OLLAMA_URL }),
      ...(contextWindowTokens === undefined ? {} : { contextWindowTokens }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }
  return new OpenAiResponsesProvider({
    apiKey: environment.OPENAI_API_KEY ?? '',
    ...(environment.FORGE_OPENAI_BASE_URL === undefined ? {} : { baseUrl: environment.FORGE_OPENAI_BASE_URL }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
