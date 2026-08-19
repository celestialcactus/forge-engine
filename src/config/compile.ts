import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  configurationContractVersion,
  type ConfigurationFact,
  type ConfigurationFieldId,
  type ConfigurationFieldValueMap,
  type ConfigurationIssue,
  type EffectiveField,
  type EffectiveProductConfiguration,
  type ManagedConfigurationFactsV1,
  type OpenAiCredentialPresence,
} from './contracts.js';
import {
  projectEffectiveConfigurationDiagnostics,
  projectEffectiveField,
  projectOpenAiCredentialField,
} from './projection.js';
import {
  type ResolvedConfigurationField,
  resolveConfigurationFacts,
} from './resolve.js';
import {
  ConfigurationIssueError,
  normalizeApprovalProfile,
  normalizeConfigurationInteger,
  normalizeEngineRoot,
  normalizeInferenceRoute,
  normalizeProviderOrigin,
  type ConfigurationValueContext,
  type IntegerConfigurationField,
} from './schema.js';
import { extractOpenAiCredentialFact, openAiCredentialHandle } from './secrets.js';
import {
  loadFileConfigurationSources,
  type LoadedFileConfigurationSources,
} from './sources.js';

export interface ProductConfigurationCommandLine {
  readonly provider?: string;
  readonly model?: string;
  readonly engineRoot?: string;
  readonly approvalProfile?: string;
  readonly maxTurns?: string;
  readonly maxCapabilityCalls?: string;
  readonly maxReportedInputTokens?: string;
  readonly maxReportedOutputTokens?: string;
  readonly timeoutMs?: string;
}

export type ProductConfigurationEnvironment = Readonly<Record<string, string | undefined>>;

export interface CompileProductConfigurationOptions {
  readonly workspaceRoot: string;
  readonly currentWorkingDirectory?: string;
  readonly homeDirectory?: string;
  readonly commandLine?: ProductConfigurationCommandLine;
  readonly environment?: ProductConfigurationEnvironment;
  readonly managed?: ManagedConfigurationFactsV1;
}

export interface CompiledProductConfiguration {
  readonly effective: EffectiveProductConfiguration;
  readonly files: LoadedFileConfigurationSources;
}

const issue = (problem: ConfigurationIssue): never => {
  throw new ConfigurationIssueError(problem);
};

const context = (
  source: ConfigurationValueContext['source'],
  location: string,
  field: ConfigurationFieldId,
): ConfigurationValueContext => ({ source, location, field });

const routeFact = (
  source: 'command_line' | 'environment',
  provider: string | undefined,
  model: string | undefined,
): ConfigurationFact<'inference.route', typeof source> | undefined => {
  if (provider === undefined && model === undefined) return undefined;
  const location = source === 'command_line'
    ? '--provider and --model'
    : 'FORGE_DEFAULT_PROVIDER and FORGE_DEFAULT_MODEL';
  const value = normalizeInferenceRoute(
    {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    },
    context(source, location, 'inference.route'),
  );
  return source === 'command_line'
    ? {
        field: 'inference.route',
        source,
        value,
        evidence: { options: ['--provider', '--model'] },
      }
    : {
        field: 'inference.route',
        source,
        value,
        evidence: { variables: ['FORGE_DEFAULT_PROVIDER', 'FORGE_DEFAULT_MODEL'] },
      };
};

const commandLineFacts = (
  options: ProductConfigurationCommandLine,
  currentWorkingDirectory: string,
): readonly ConfigurationFact[] => {
  const facts: ConfigurationFact[] = [];
  const route = routeFact('command_line', options.provider, options.model);
  if (route !== undefined) facts.push(route);
  if (options.engineRoot !== undefined) {
    facts.push({
      field: 'engine.root',
      source: 'command_line',
      value: normalizeEngineRoot(
        options.engineRoot,
        context('command_line', '--engine-root', 'engine.root'),
        { requireAbsolute: false, relativeTo: currentWorkingDirectory },
      ),
      evidence: { options: ['--engine-root'] },
    });
  }
  if (options.approvalProfile !== undefined) {
    facts.push({
      field: 'approval.profile',
      source: 'command_line',
      value: normalizeApprovalProfile(
        options.approvalProfile,
        context('command_line', '--approval-profile', 'approval.profile'),
      ),
      evidence: { options: ['--approval-profile'] },
    });
  }
  const ceilings: readonly [
    IntegerConfigurationField,
    string | undefined,
    string,
  ][] = [
    ['execution.max_turns', options.maxTurns, '--max-turns'],
    ['execution.max_capability_calls', options.maxCapabilityCalls, '--max-capability-calls'],
    ['execution.max_reported_input_tokens', options.maxReportedInputTokens, '--max-input-tokens'],
    ['execution.max_reported_output_tokens', options.maxReportedOutputTokens, '--max-output-tokens'],
    ['execution.timeout_ms', options.timeoutMs, '--timeout-ms'],
  ];
  for (const [field, value, option] of ceilings) {
    if (value === undefined) continue;
    facts.push({
      field,
      source: 'command_line',
      value: normalizeConfigurationInteger(field, value, context('command_line', option, field)),
      evidence: { options: [option] },
    } as ConfigurationFact);
  }
  return facts;
};

const environmentFacts = (
  environment: ProductConfigurationEnvironment,
  currentWorkingDirectory: string,
): readonly ConfigurationFact[] => {
  const facts: ConfigurationFact[] = [];
  const route = routeFact(
    'environment',
    environment.FORGE_DEFAULT_PROVIDER,
    environment.FORGE_DEFAULT_MODEL,
  );
  if (route !== undefined) facts.push(route);
  if (environment.FORGE_ENGINE_ROOT !== undefined) {
    facts.push({
      field: 'engine.root',
      source: 'environment',
      value: normalizeEngineRoot(
        environment.FORGE_ENGINE_ROOT,
        context('environment', 'FORGE_ENGINE_ROOT', 'engine.root'),
        { requireAbsolute: false, relativeTo: currentWorkingDirectory },
      ),
      evidence: { variables: ['FORGE_ENGINE_ROOT'] },
    });
  }
  const providerOrigins: readonly [
    'provider.ollama.base_url' | 'provider.openai.base_url',
    string | undefined,
    'FORGE_OLLAMA_URL' | 'FORGE_OPENAI_BASE_URL',
  ][] = [
    ['provider.ollama.base_url', environment.FORGE_OLLAMA_URL, 'FORGE_OLLAMA_URL'],
    ['provider.openai.base_url', environment.FORGE_OPENAI_BASE_URL, 'FORGE_OPENAI_BASE_URL'],
  ];
  for (const [field, value, variable] of providerOrigins) {
    if (value === undefined) continue;
    facts.push({
      field,
      source: 'environment',
      value: normalizeProviderOrigin(value, context('environment', variable, field)),
      evidence: { variables: [variable] },
    } as ConfigurationFact);
  }
  if (environment.FORGE_OLLAMA_CONTEXT_TOKENS !== undefined) {
    facts.push({
      field: 'provider.ollama.context_window_tokens',
      source: 'environment',
      value: normalizeConfigurationInteger(
        'provider.ollama.context_window_tokens',
        environment.FORGE_OLLAMA_CONTEXT_TOKENS,
        context(
          'environment',
          'FORGE_OLLAMA_CONTEXT_TOKENS',
          'provider.ollama.context_window_tokens',
        ),
      ),
      evidence: { variables: ['FORGE_OLLAMA_CONTEXT_TOKENS'] },
    });
  }
  if (environment.FORGE_APPROVAL_PROFILE !== undefined) {
    facts.push({
      field: 'approval.profile',
      source: 'environment',
      value: normalizeApprovalProfile(
        environment.FORGE_APPROVAL_PROFILE,
        context('environment', 'FORGE_APPROVAL_PROFILE', 'approval.profile'),
      ),
      evidence: { variables: ['FORGE_APPROVAL_PROFILE'] },
    });
  }
  const ceilings: readonly [
    IntegerConfigurationField,
    string | undefined,
    string,
  ][] = [
    ['execution.max_turns', environment.FORGE_MAX_TURNS, 'FORGE_MAX_TURNS'],
    ['execution.max_capability_calls', environment.FORGE_MAX_CAPABILITY_CALLS, 'FORGE_MAX_CAPABILITY_CALLS'],
    ['execution.max_reported_input_tokens', environment.FORGE_MAX_INPUT_TOKENS, 'FORGE_MAX_INPUT_TOKENS'],
    ['execution.max_reported_output_tokens', environment.FORGE_MAX_OUTPUT_TOKENS, 'FORGE_MAX_OUTPUT_TOKENS'],
    ['execution.timeout_ms', environment.FORGE_TIMEOUT_MS, 'FORGE_TIMEOUT_MS'],
  ];
  for (const [field, value, variable] of ceilings) {
    if (value === undefined) continue;
    facts.push({
      field,
      source: 'environment',
      value: normalizeConfigurationInteger(field, value, context('environment', variable, field)),
      evidence: { variables: [variable] },
    } as ConfigurationFact);
  }
  facts.push(extractOpenAiCredentialFact(environment));
  return facts;
};

const assertFixedCredentialPresence = (
  value: OpenAiCredentialPresence,
  authority: string,
): OpenAiCredentialPresence => {
  if (value.handle.kind !== openAiCredentialHandle.kind
    || value.handle.name !== openAiCredentialHandle.name
    || typeof value.present !== 'boolean') {
    issue({
      code: 'config_value_invalid',
      source: 'managed',
      field: 'credential.openai_api_key',
      location: authority,
      message: 'Managed OpenAI credential facts must use the fixed OPENAI_API_KEY presence handle.',
      hint: 'Pass only the fixed handle and a boolean presence value; never pass credential bytes.',
    });
  }
  return { handle: openAiCredentialHandle, present: value.present };
};

const normalizeManagedFact = (fact: ConfigurationFact<ConfigurationFieldId, 'managed'>): ConfigurationFact => {
  const location = fact.evidence.authority;
  const value: ConfigurationFieldValueMap[typeof fact.field] = (() => {
    switch (fact.field) {
      case 'inference.route':
        return normalizeInferenceRoute(fact.value, context('managed', location, fact.field));
      case 'engine.root':
        return normalizeEngineRoot(
          fact.value,
          context('managed', location, fact.field),
          { requireAbsolute: true },
        );
      case 'provider.ollama.base_url':
      case 'provider.openai.base_url':
        return normalizeProviderOrigin(fact.value, context('managed', location, fact.field));
      case 'provider.ollama.context_window_tokens':
      case 'execution.max_turns':
      case 'execution.max_capability_calls':
      case 'execution.max_reported_input_tokens':
      case 'execution.max_reported_output_tokens':
      case 'execution.timeout_ms':
        return normalizeConfigurationInteger(fact.field, fact.value, context('managed', location, fact.field));
      case 'approval.profile':
        return normalizeApprovalProfile(fact.value, context('managed', location, fact.field));
      case 'credential.openai_api_key':
        return assertFixedCredentialPresence(fact.value, location);
    }
  })() as ConfigurationFieldValueMap[typeof fact.field];
  return { ...fact, value } as ConfigurationFact;
};

const managedFacts = (managed: ManagedConfigurationFactsV1 | undefined): readonly ConfigurationFact[] => {
  if (managed === undefined) return [];
  if (managed.schemaVersion !== 1 || !Array.isArray(managed.facts)) {
    issue({
      code: 'config_schema_unsupported',
      source: 'managed',
      location: 'managed configuration',
      message: 'Managed configuration must use schemaVersion 1.',
      hint: 'Update the trusted host integration to the Forge managed-facts v1 contract.',
    });
  }
  return managed.facts.map((fact) => normalizeManagedFact(fact));
};

const required = <Field extends ConfigurationFieldId>(
  field: Field,
  resolved: ResolvedConfigurationField<Field> | undefined,
): ResolvedConfigurationField<Field> => {
  if (resolved === undefined) {
    throw new Error(`Effective configuration is missing required field "${field}".`);
  }
  return resolved;
};

const project = <Field extends Exclude<ConfigurationFieldId, 'credential.openai_api_key'>>(
  field: Field,
  resolved: ResolvedConfigurationField<Field>,
): EffectiveField<Field> => projectEffectiveField(field, resolved.value, resolved.sources);

const freezeConfiguration = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) freezeConfiguration(nested);
  return Object.freeze(value);
};

const projectConfiguration = (
  resolved: ReturnType<typeof resolveConfigurationFacts>,
): EffectiveProductConfiguration => {
  const route = resolved.fields['inference.route'];
  const engineRoot = required('engine.root', resolved.fields['engine.root']);
  const ollamaBaseUrl = required('provider.ollama.base_url', resolved.fields['provider.ollama.base_url']);
  const ollamaContext = required(
    'provider.ollama.context_window_tokens',
    resolved.fields['provider.ollama.context_window_tokens'],
  );
  const openAiBaseUrl = required('provider.openai.base_url', resolved.fields['provider.openai.base_url']);
  const approvalProfile = required('approval.profile', resolved.fields['approval.profile']);
  const maxTurns = required('execution.max_turns', resolved.fields['execution.max_turns']);
  const maxCapabilityCalls = required(
    'execution.max_capability_calls',
    resolved.fields['execution.max_capability_calls'],
  );
  const maxReportedInputTokens = required(
    'execution.max_reported_input_tokens',
    resolved.fields['execution.max_reported_input_tokens'],
  );
  const maxReportedOutputTokens = required(
    'execution.max_reported_output_tokens',
    resolved.fields['execution.max_reported_output_tokens'],
  );
  const timeoutMs = required('execution.timeout_ms', resolved.fields['execution.timeout_ms']);
  const credential = required('credential.openai_api_key', resolved.fields['credential.openai_api_key']);
  const fields: EffectiveField[] = [
    ...(route === undefined ? [] : [project('inference.route', route)]),
    project('engine.root', engineRoot),
    project('provider.ollama.base_url', ollamaBaseUrl),
    project('provider.ollama.context_window_tokens', ollamaContext),
    project('provider.openai.base_url', openAiBaseUrl),
    project('approval.profile', approvalProfile),
    project('execution.max_turns', maxTurns),
    project('execution.max_capability_calls', maxCapabilityCalls),
    project('execution.max_reported_input_tokens', maxReportedInputTokens),
    project('execution.max_reported_output_tokens', maxReportedOutputTokens),
    project('execution.timeout_ms', timeoutMs),
    projectOpenAiCredentialField(credential.value, credential.sources),
  ];
  const byField = new Map(fields.map((field) => [field.field, field] as const));
  const effective: EffectiveProductConfiguration = {
    schemaVersion: 1,
    contractVersion: configurationContractVersion,
    ...(route === undefined
      ? {}
      : { route: byField.get('inference.route') as EffectiveField<'inference.route'> }),
    engineRoot: byField.get('engine.root') as EffectiveField<'engine.root'>,
    providers: {
      ollama: {
        baseUrl: byField.get('provider.ollama.base_url') as EffectiveField<'provider.ollama.base_url'>,
        contextWindowTokens: byField.get('provider.ollama.context_window_tokens') as EffectiveField<'provider.ollama.context_window_tokens'>,
      },
      openai: {
        baseUrl: byField.get('provider.openai.base_url') as EffectiveField<'provider.openai.base_url'>,
        credential: byField.get('credential.openai_api_key') as EffectiveField<'credential.openai_api_key'>,
      },
    },
    approvalProfile: byField.get('approval.profile') as EffectiveField<'approval.profile'>,
    execution: {
      maxTurns: byField.get('execution.max_turns') as EffectiveField<'execution.max_turns'>,
      maxCapabilityCalls: byField.get('execution.max_capability_calls') as EffectiveField<'execution.max_capability_calls'>,
      maxReportedInputTokens: byField.get('execution.max_reported_input_tokens') as EffectiveField<'execution.max_reported_input_tokens'>,
      maxReportedOutputTokens: byField.get('execution.max_reported_output_tokens') as EffectiveField<'execution.max_reported_output_tokens'>,
      timeoutMs: byField.get('execution.timeout_ms') as EffectiveField<'execution.timeout_ms'>,
    },
    diagnostics: projectEffectiveConfigurationDiagnostics(fields),
  };
  if (effective.diagnostics.length !== 12) {
    throw new Error('Effective configuration diagnostics are incomplete.');
  }
  return freezeConfiguration(effective);
};

/** Load, normalize, combine, project, and freeze one process-wide product configuration. */
export async function compileProductConfiguration(
  options: CompileProductConfigurationOptions,
): Promise<CompiledProductConfiguration> {
  const currentWorkingDirectory = resolve(options.currentWorkingDirectory ?? process.cwd());
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  const environment = options.environment ?? process.env;
  const commandLine = options.commandLine ?? {};
  const files = await loadFileConfigurationSources({
    workspaceRoot: options.workspaceRoot,
    homeDirectory,
  });
  const facts: ConfigurationFact[] = [
    ...managedFacts(options.managed),
    ...commandLineFacts(commandLine, currentWorkingDirectory),
    ...environmentFacts(environment, currentWorkingDirectory),
    ...(files.workspace.kind === 'present' ? files.workspace.document.facts : []),
    ...(files.user.kind === 'present' ? files.user.document.facts : []),
    {
      field: 'engine.root',
      source: 'built_in',
      value: resolve(homeDirectory, '.forge'),
      evidence: { name: 'host_home/.forge' },
    },
  ];
  return freezeConfiguration({
    effective: projectConfiguration(resolveConfigurationFacts(facts)),
    files,
  });
}
