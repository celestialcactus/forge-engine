import { isAbsolute, resolve } from 'node:path';
import type { ProductApprovalProfile } from '../approval-profile.js';
import type { InferenceRoute } from '../inference/contracts.js';
import {
  configurationNormalizationRules,
  type ConfigurationFact,
  type ConfigurationFieldId,
  type ConfigurationIssue,
  type ConfigurationIssueCode,
  type ConfigurationSource,
  type ExecutionConfigurationV1,
  type UserConfigurationFileV1,
  type WorkspaceConfigurationFileV1,
} from './contracts.js';

export type FileConfigurationSource = 'workspace' | 'user';

export interface ConfigurationValueContext {
  readonly source: ConfigurationSource;
  readonly location: string;
  readonly field?: ConfigurationFieldId;
}

export interface ParsedConfigurationDocument<Source extends FileConfigurationSource> {
  readonly source: Source;
  readonly location: string;
  readonly configuration: Source extends 'workspace'
    ? WorkspaceConfigurationFileV1
    : UserConfigurationFileV1;
  readonly facts: readonly ConfigurationFact<ConfigurationFieldId, Source>[];
}

export class ConfigurationIssueError extends Error {
  readonly issue: ConfigurationIssue;

  constructor(issue: ConfigurationIssue) {
    super(issue.message);
    this.name = 'ConfigurationIssueError';
    this.issue = issue;
  }
}

const issue = (
  context: ConfigurationValueContext,
  code: ConfigurationIssueCode,
  message: string,
  hint: string,
): ConfigurationIssueError => new ConfigurationIssueError({
  code,
  source: context.source,
  ...(context.field === undefined ? {} : { field: context.field }),
  location: context.location,
  message,
  hint,
});

const located = (
  source: FileConfigurationSource,
  fileLocation: string,
  configPath?: string,
  field?: ConfigurationFieldId,
): ConfigurationValueContext => ({
  source,
  location: configPath === undefined ? fileLocation : `${fileLocation}#${configPath}`,
  ...(field === undefined ? {} : { field }),
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  context: ConfigurationValueContext,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw issue(
    context,
    'config_value_invalid',
    `${label} must be a JSON object.`,
    `Replace ${context.location} with an object containing the supported settings.`,
  );
};

const sensitiveKey = (key: string): boolean =>
  /(?:api[_-]?key|credential|password|secret|token)/iu.test(key);

const knownSuggestion = new Map<string, string>([
  ['approvalProfiles', 'approvalProfile'],
  ['approval_profile', 'approvalProfile'],
  ['schema_version', 'schemaVersion'],
  ['engine_root', 'engineRoot'],
  ['base_url', 'baseUrl'],
  ['context_window_tokens', 'contextWindowTokens'],
  ['max_turns', 'maxTurns'],
  ['max_capability_calls', 'maxCapabilityCalls'],
  ['max_reported_input_tokens', 'maxReportedInputTokens'],
  ['max_reported_output_tokens', 'maxReportedOutputTokens'],
  ['timeout_ms', 'timeoutMs'],
]);

const assertKnownKeys = (
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  source: FileConfigurationSource,
  fileLocation: string,
  parentPath?: string,
): void => {
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    const configPath = parentPath === undefined ? key : `${parentPath}.${key}`;
    const context = located(source, fileLocation, configPath);
    if (sensitiveKey(key)) {
      throw issue(
        context,
        'config_secret_forbidden',
        'Forge configuration files cannot contain credentials.',
        'Set credentials in the supported host environment; do not put secret values in this file.',
      );
    }
    const suggestion = knownSuggestion.get(key);
    throw issue(
      context,
      'config_unknown_field',
      `Forge does not recognize "${key}".`,
      suggestion === undefined
        ? `Remove "${key}" or use a setting supported by schema version 1.`
        : `Use "${suggestion}", or remove the unknown setting.`,
    );
  }
};

const assertKnownContextKeys = (
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  context: ConfigurationValueContext,
): void => {
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    const keyContext: ConfigurationValueContext = {
      ...context,
      location: `${context.location}.${key}`,
    };
    if (sensitiveKey(key)) {
      throw issue(
        keyContext,
        'config_secret_forbidden',
        'Forge configuration cannot contain credentials.',
        'Use the supported host environment for credentials; do not include secret values here.',
      );
    }
    throw issue(
      keyContext,
      'config_unknown_field',
      `Forge does not recognize "${key}".`,
      `Remove "${key}" or use a supported inference-route setting.`,
    );
  }
};

const requireText = (
  value: unknown,
  context: ConfigurationValueContext,
  label: string,
  maximumLength: number,
): string => {
  if (typeof value !== 'string') {
    throw issue(context, 'config_value_invalid', `${label} must be text.`, `Set ${context.location} to a text value.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw issue(
      context,
      'config_value_invalid',
      `${label} must contain between 1 and ${maximumLength} characters.`,
      `Set ${context.location} to a non-empty value no longer than ${maximumLength} characters.`,
    );
  }
  return normalized;
};

export function normalizeInferenceRoute(
  value: unknown,
  context: ConfigurationValueContext,
): InferenceRoute {
  const route = requireRecord(value, context, 'Inference settings');
  assertKnownContextKeys(route, new Set(['provider', 'model']), context);
  if (!Object.hasOwn(route, 'provider') || !Object.hasOwn(route, 'model')) {
    throw issue(
      context,
      'config_route_incomplete',
      'Inference settings must include both "provider" and "model".',
      'Set both values under "inference", or remove the "inference" object.',
    );
  }
  const providerText = requireText(route.provider, context, 'Inference provider', 32).toLowerCase();
  if (providerText !== 'ollama' && providerText !== 'openai') {
    throw issue(
      context,
      'config_value_invalid',
      'Inference provider must be "ollama" or "openai".',
      'Choose "ollama" or "openai" and keep the model in the same inference object.',
    );
  }
  const model = requireText(
    route.model,
    context,
    'Inference model',
    configurationNormalizationRules.atomic_inference_route_v1.model.maximumLength,
  );
  return { provider: providerText, model };
}

export function normalizeApprovalProfile(
  value: unknown,
  context: ConfigurationValueContext,
): ProductApprovalProfile {
  const normalized = requireText(value, context, 'Approval profile', 32).toLowerCase();
  if (normalized === 'developer' || normalized === 'review' || normalized === 'locked') return normalized;
  throw issue(
    context,
    'config_value_invalid',
    'Approval profile must be "developer", "review", or "locked".',
    'Choose developer for normal local use, review for per-call confirmation, or locked to deny capability calls.',
  );
}

export type IntegerConfigurationField =
  | 'provider.ollama.context_window_tokens'
  | 'execution.max_turns'
  | 'execution.max_capability_calls'
  | 'execution.max_reported_input_tokens'
  | 'execution.max_reported_output_tokens'
  | 'execution.timeout_ms';

const integerBounds = {
  'provider.ollama.context_window_tokens': configurationNormalizationRules.ollama_context_window_tokens_v1,
  'execution.max_turns': configurationNormalizationRules.max_turns_v1,
  'execution.max_capability_calls': configurationNormalizationRules.max_capability_calls_v1,
  'execution.max_reported_input_tokens': configurationNormalizationRules.max_reported_tokens_v1,
  'execution.max_reported_output_tokens': configurationNormalizationRules.max_reported_tokens_v1,
  'execution.timeout_ms': configurationNormalizationRules.timeout_ms_v1,
} as const;

export function normalizeConfigurationInteger(
  field: IntegerConfigurationField,
  value: unknown,
  context: ConfigurationValueContext,
): number {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && /^[+-]?\d+$/u.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    throw issue(
      context,
      'config_value_invalid',
      'This setting must be a whole number.',
      `Set ${context.location} to a base-10 integer.`,
    );
  }
  const bounds = integerBounds[field];
  if (!Number.isSafeInteger(parsed) || parsed < bounds.minimum || parsed > bounds.maximum) {
    throw issue(
      context,
      'config_value_invalid',
      `This setting must be a whole number from ${bounds.minimum} through ${bounds.maximum}.`,
      `Choose a value between ${bounds.minimum} and ${bounds.maximum}, inclusive.`,
    );
  }
  return parsed;
}

export function normalizeEngineRoot(
  value: unknown,
  context: ConfigurationValueContext,
  options: { readonly requireAbsolute: boolean; readonly relativeTo?: string },
): string {
  const normalized = requireText(value, context, 'Forge data location', 4_096);
  if (isAbsolute(normalized)) return resolve(normalized);
  if (options.requireAbsolute) {
    throw issue(
      context,
      'config_value_invalid',
      'The Forge data location in user configuration must be an absolute path.',
      'Use a complete path such as "C:\\Users\\you\\.forge" or "/home/you/.forge".',
    );
  }
  if (options.relativeTo === undefined) {
    throw new TypeError('A relative engine root requires an explicit base directory.');
  }
  return resolve(options.relativeTo, normalized);
}

export function normalizeProviderOrigin(
  value: unknown,
  context: ConfigurationValueContext,
): string {
  const input = requireText(value, context, 'Provider endpoint', 2_048);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw issue(
      context,
      'config_value_invalid',
      'Provider endpoints must be valid HTTP(S) URLs.',
      'Use an endpoint such as "https://example.test/".',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw issue(
      context,
      'config_value_invalid',
      'Provider endpoints must use HTTP or HTTPS.',
      'Use an endpoint beginning with "http://" or "https://".',
    );
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw issue(
      context,
      'config_value_invalid',
      'Provider endpoints must be origin-only HTTP(S) URLs without credentials, queries, or fragments.',
      parsed.username !== '' || parsed.password !== ''
        ? 'Use an endpoint such as "https://example.test/" and supply credentials through the supported host environment.'
        : parsed.search !== ''
          ? 'Use an endpoint such as "https://example.test/" without query parameters.'
          : 'Use an endpoint such as "https://example.test/" without a fragment.',
    );
  }
  const origin = `${parsed.origin}/`;
  if (parsed.href !== origin) {
    throw issue(
      context,
      'config_value_invalid',
      'Provider endpoints must use the URL origin without an additional path.',
      `Use "${origin}"; path-prefixed provider gateways are not supported in schema v1.`,
    );
  }
  return origin;
}

const fact = <Field extends ConfigurationFieldId, Source extends FileConfigurationSource>(
  field: Field,
  source: Source,
  value: ConfigurationFact<Field, Source>['value'],
  fileLocation: string,
  configPath: string,
): ConfigurationFact<Field, Source> => ({
  field,
  source,
  value,
  evidence: { path: fileLocation, configPath },
}) as ConfigurationFact<Field, Source>;

const parseExecution = <Source extends FileConfigurationSource>(
  source: Source,
  fileLocation: string,
  value: unknown,
  facts: ConfigurationFact<ConfigurationFieldId, Source>[],
): ExecutionConfigurationV1 => {
  const context = located(source, fileLocation, 'execution');
  const record = requireRecord(value, context, 'Execution settings');
  assertKnownKeys(record, new Set([
    'maxTurns',
    'maxCapabilityCalls',
    'maxReportedInputTokens',
    'maxReportedOutputTokens',
    'timeoutMs',
  ]), source, fileLocation, 'execution');

  const output: {
    maxTurns?: number;
    maxCapabilityCalls?: number;
    maxReportedInputTokens?: number;
    maxReportedOutputTokens?: number;
    timeoutMs?: number;
  } = {};
  const entries = [
    ['maxTurns', 'execution.max_turns'],
    ['maxCapabilityCalls', 'execution.max_capability_calls'],
    ['maxReportedInputTokens', 'execution.max_reported_input_tokens'],
    ['maxReportedOutputTokens', 'execution.max_reported_output_tokens'],
    ['timeoutMs', 'execution.timeout_ms'],
  ] as const;
  for (const [key, field] of entries) {
    if (!Object.hasOwn(record, key)) continue;
    const path = `execution.${key}`;
    const valueContext = located(source, fileLocation, path, field);
    const normalized = normalizeConfigurationInteger(field, record[key], valueContext);
    output[key] = normalized;
    facts.push(fact(field, source, normalized, fileLocation, path));
  }
  return output;
};

const rejectWorkspaceHostSettings = (
  record: Readonly<Record<string, unknown>>,
  fileLocation: string,
): void => {
  if (Object.hasOwn(record, 'engineRoot')) {
    throw issue(
      located('workspace', fileLocation, 'engineRoot', 'engine.root'),
      'config_source_forbidden',
      'A workspace cannot choose the Forge data location.',
      'Move "engineRoot" to ~/.forge/config.json, FORGE_ENGINE_ROOT, or --engine-root.',
    );
  }
  if (!Object.hasOwn(record, 'providers')) return;
  const providers = isRecord(record.providers) ? record.providers : {};
  const ollama = isRecord(providers.ollama) ? providers.ollama : {};
  const openai = isRecord(providers.openai) ? providers.openai : {};
  if (Object.hasOwn(ollama, 'baseUrl')) {
    throw issue(
      located('workspace', fileLocation, 'providers.ollama.baseUrl', 'provider.ollama.base_url'),
      'config_source_forbidden',
      'A workspace cannot choose the Ollama endpoint.',
      'Move this setting to ~/.forge/config.json or FORGE_OLLAMA_URL.',
    );
  }
  if (Object.hasOwn(ollama, 'contextWindowTokens')) {
    throw issue(
      located('workspace', fileLocation, 'providers.ollama.contextWindowTokens', 'provider.ollama.context_window_tokens'),
      'config_source_forbidden',
      'A workspace cannot tune the Ollama provider.',
      'Move this setting to ~/.forge/config.json or FORGE_OLLAMA_CONTEXT_TOKENS.',
    );
  }
  if (Object.hasOwn(openai, 'baseUrl')) {
    throw issue(
      located('workspace', fileLocation, 'providers.openai.baseUrl', 'provider.openai.base_url'),
      'config_source_forbidden',
      'A workspace cannot choose the OpenAI endpoint.',
      'Move this setting to ~/.forge/config.json or FORGE_OPENAI_BASE_URL.',
    );
  }
  throw issue(
    located('workspace', fileLocation, 'providers'),
    'config_source_forbidden',
    'A workspace cannot configure provider endpoints or provider tuning.',
    'Move provider settings to ~/.forge/config.json or the supported host environment.',
  );
};

export function parseConfigurationDocument<Source extends FileConfigurationSource>(
  source: Source,
  value: unknown,
  fileLocation: string,
): ParsedConfigurationDocument<Source> {
  const root = requireRecord(value, located(source, fileLocation), 'Forge configuration');
  if (Object.hasOwn(root, 'credentials')) {
    throw issue(
      located(source, fileLocation, 'credentials'),
      'config_secret_forbidden',
      'Forge configuration files cannot contain credentials.',
      'Set OPENAI_API_KEY in the host environment; do not put the key in this file.',
    );
  }
  if (source === 'workspace') rejectWorkspaceHostSettings(root, fileLocation);
  const allowedRoot = source === 'workspace'
    ? new Set(['schemaVersion', 'inference', 'approvalProfile', 'execution'])
    : new Set(['schemaVersion', 'inference', 'engineRoot', 'providers', 'approvalProfile', 'execution']);
  assertKnownKeys(root, allowedRoot, source, fileLocation);
  if (root.schemaVersion !== 1) {
    throw issue(
      located(source, fileLocation, 'schemaVersion'),
      'config_schema_unsupported',
      'Forge configuration must declare "schemaVersion": 1.',
      'Set "schemaVersion" to 1 and use only schema-v1 settings.',
    );
  }

  const facts: ConfigurationFact<ConfigurationFieldId, Source>[] = [];
  const output: {
    schemaVersion: 1;
    inference?: InferenceRoute;
    engineRoot?: string;
    providers?: {
      ollama?: { baseUrl?: string; contextWindowTokens?: number };
      openai?: { baseUrl?: string };
    };
    approvalProfile?: ProductApprovalProfile;
    execution?: ExecutionConfigurationV1;
  } = { schemaVersion: 1 };

  if (Object.hasOwn(root, 'inference')) {
    const path = 'inference';
    const context = located(source, fileLocation, path, 'inference.route');
    const route = normalizeInferenceRoute(root.inference, context);
    output.inference = route;
    facts.push(fact('inference.route', source, route, fileLocation, path));
  }
  if (source === 'user' && Object.hasOwn(root, 'engineRoot')) {
    const path = 'engineRoot';
    const context = located(source, fileLocation, path, 'engine.root');
    const engineRoot = normalizeEngineRoot(root.engineRoot, context, { requireAbsolute: true });
    output.engineRoot = engineRoot;
    facts.push(fact('engine.root', source, engineRoot, fileLocation, path));
  }
  if (source === 'user' && Object.hasOwn(root, 'providers')) {
    const providers = requireRecord(root.providers, located(source, fileLocation, 'providers'), 'Provider settings');
    assertKnownKeys(providers, new Set(['ollama', 'openai']), source, fileLocation, 'providers');
    const providerOutput: {
      ollama?: { baseUrl?: string; contextWindowTokens?: number };
      openai?: { baseUrl?: string };
    } = {};
    if (Object.hasOwn(providers, 'ollama')) {
      const ollama = requireRecord(providers.ollama, located(source, fileLocation, 'providers.ollama'), 'Ollama settings');
      assertKnownKeys(ollama, new Set(['baseUrl', 'contextWindowTokens']), source, fileLocation, 'providers.ollama');
      const ollamaOutput: { baseUrl?: string; contextWindowTokens?: number } = {};
      if (Object.hasOwn(ollama, 'baseUrl')) {
        const path = 'providers.ollama.baseUrl';
        const context = located(source, fileLocation, path, 'provider.ollama.base_url');
        const baseUrl = normalizeProviderOrigin(ollama.baseUrl, context);
        ollamaOutput.baseUrl = baseUrl;
        facts.push(fact('provider.ollama.base_url', source, baseUrl, fileLocation, path));
      }
      if (Object.hasOwn(ollama, 'contextWindowTokens')) {
        const path = 'providers.ollama.contextWindowTokens';
        const context = located(source, fileLocation, path, 'provider.ollama.context_window_tokens');
        const tokens = normalizeConfigurationInteger('provider.ollama.context_window_tokens', ollama.contextWindowTokens, context);
        ollamaOutput.contextWindowTokens = tokens;
        facts.push(fact('provider.ollama.context_window_tokens', source, tokens, fileLocation, path));
      }
      providerOutput.ollama = ollamaOutput;
    }
    if (Object.hasOwn(providers, 'openai')) {
      const openai = requireRecord(providers.openai, located(source, fileLocation, 'providers.openai'), 'OpenAI settings');
      assertKnownKeys(openai, new Set(['baseUrl']), source, fileLocation, 'providers.openai');
      const openaiOutput: { baseUrl?: string } = {};
      if (Object.hasOwn(openai, 'baseUrl')) {
        const path = 'providers.openai.baseUrl';
        const context = located(source, fileLocation, path, 'provider.openai.base_url');
        const baseUrl = normalizeProviderOrigin(openai.baseUrl, context);
        openaiOutput.baseUrl = baseUrl;
        facts.push(fact('provider.openai.base_url', source, baseUrl, fileLocation, path));
      }
      providerOutput.openai = openaiOutput;
    }
    output.providers = providerOutput;
  }
  if (Object.hasOwn(root, 'approvalProfile')) {
    const path = 'approvalProfile';
    const context = located(source, fileLocation, path, 'approval.profile');
    const profile = normalizeApprovalProfile(root.approvalProfile, context);
    output.approvalProfile = profile;
    facts.push(fact('approval.profile', source, profile, fileLocation, path));
  }
  if (Object.hasOwn(root, 'execution')) {
    output.execution = parseExecution(source, fileLocation, root.execution, facts);
  }

  return {
    source,
    location: fileLocation,
    configuration: output as ParsedConfigurationDocument<Source>['configuration'],
    facts,
  };
}
