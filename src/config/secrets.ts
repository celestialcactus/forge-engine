import type {
  ConfigurationFact,
  OpenAiCredentialPresence,
} from './contracts.js';

export type ConfigurationSecretEnvironment = Readonly<Record<string, string | undefined>>;

export const openAiCredentialHandle = Object.freeze({
  kind: 'environment_variable',
  name: 'OPENAI_API_KEY',
} as const satisfies OpenAiCredentialPresence['handle']);

/**
 * Inspect only whether the fixed OpenAI credential reference is usable.
 *
 * The returned value contains no secret bytes, length, prefix, or derivative.
 * Whitespace-only values are treated as absent, matching provider initialization.
 */
export function extractOpenAiCredentialPresence(
  environment: ConfigurationSecretEnvironment,
): OpenAiCredentialPresence {
  const candidate = environment.OPENAI_API_KEY;
  return {
    handle: openAiCredentialHandle,
    present: typeof candidate === 'string' && candidate.trim().length > 0,
  };
}

/** Compile environment inspection into the one secret-safe fact consumed by resolution. */
export function extractOpenAiCredentialFact(
  environment: ConfigurationSecretEnvironment,
): ConfigurationFact<'credential.openai_api_key', 'environment' | 'built_in'> {
  const value = extractOpenAiCredentialPresence(environment);
  return value.present
    ? {
        field: 'credential.openai_api_key',
        source: 'environment',
        value,
        evidence: { variables: ['OPENAI_API_KEY'] },
      }
    : {
        field: 'credential.openai_api_key',
        source: 'built_in',
        value,
        evidence: { name: 'openai_credential_absent' },
      };
}

/** Resolve secret bytes only at adapter construction, through the fixed handle. */
export function resolveOpenAiCredentialValue(
  presence: OpenAiCredentialPresence,
  environment: ConfigurationSecretEnvironment,
): string {
  if (presence.handle.kind !== openAiCredentialHandle.kind
    || presence.handle.name !== openAiCredentialHandle.name) {
    throw new Error('OpenAI credential access requires the fixed OPENAI_API_KEY handle.');
  }
  if (!presence.present) return '';
  return environment.OPENAI_API_KEY ?? '';
}
