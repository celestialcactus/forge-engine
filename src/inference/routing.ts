import type { InferenceFetch, InferenceProvider, InferenceRoute } from './contracts.js';
import type { EffectiveProductConfiguration } from '../config/contracts.js';
import { resolveOpenAiCredentialValue } from '../config/secrets.js';
import { OllamaChatProvider } from './ollama.js';
import { OpenAiResponsesProvider } from './openai.js';

export interface InferenceProviderFactoryOptions {
  readonly configuration: EffectiveProductConfiguration;
  readonly secretEnvironment?: Readonly<NodeJS.ProcessEnv>;
  readonly fetch?: InferenceFetch;
}

export function resolveInferenceRoute(provider: string | undefined, model: string | undefined): InferenceRoute {
  if (provider !== 'ollama' && provider !== 'openai') {
    throw new Error('Forge requires provider and model together from one configuration source. No fallback route is selected.');
  }
  if (model === undefined || model.trim().length === 0 || model.length > 200) {
    throw new Error('Forge requires a non-empty model value of at most 200 characters in the same configuration source.');
  }
  return { provider, model: model.trim() };
}

export function createInferenceProvider(
  route: InferenceRoute,
  options: InferenceProviderFactoryOptions,
): InferenceProvider {
  if (route.provider === 'ollama') {
    return new OllamaChatProvider({
      baseUrl: options.configuration.providers.ollama.baseUrl.value,
      contextWindowTokens: options.configuration.providers.ollama.contextWindowTokens.value,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }
  const apiKey = resolveOpenAiCredentialValue(
    options.configuration.providers.openai.credential.value,
    options.secretEnvironment ?? process.env,
  );
  if (apiKey.trim().length === 0) {
    throw new Error(
      `Cannot initialize configured route openai/${route.model}: OPENAI_API_KEY is not available. `
      + 'No fallback provider was attempted.',
    );
  }
  return new OpenAiResponsesProvider({
    apiKey,
    baseUrl: options.configuration.providers.openai.baseUrl.value,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
