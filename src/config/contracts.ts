import type { ProductApprovalProfile } from '../approval-profile.js';
import type { InferenceRoute } from '../inference/contracts.js';

export const configurationContractVersion = 'forge.effective-configuration.v1' as const;
export const configurationFileRelativePath = '.forge/config.json' as const;
export const maximumConfigurationFileBytes = 65_536 as const;

export const configurationSources = [
  'managed',
  'command_line',
  'environment',
  'workspace',
  'user',
  'built_in',
] as const;

export type ConfigurationSource = typeof configurationSources[number];

export const configurationFieldIds = [
  'inference.route',
  'engine.root',
  'provider.ollama.base_url',
  'provider.ollama.context_window_tokens',
  'provider.openai.base_url',
  'approval.profile',
  'execution.max_turns',
  'execution.max_capability_calls',
  'execution.max_reported_input_tokens',
  'execution.max_reported_output_tokens',
  'execution.timeout_ms',
  'credential.openai_api_key',
] as const;

export type ConfigurationFieldId = typeof configurationFieldIds[number];

export interface OpenAiCredentialPresence {
  readonly handle: {
    readonly kind: 'environment_variable';
    readonly name: 'OPENAI_API_KEY';
  };
  readonly present: boolean;
}

export interface ConfigurationFieldValueMap {
  readonly 'inference.route': InferenceRoute;
  readonly 'engine.root': string;
  readonly 'provider.ollama.base_url': string;
  readonly 'provider.ollama.context_window_tokens': number;
  readonly 'provider.openai.base_url': string;
  readonly 'approval.profile': ProductApprovalProfile;
  readonly 'execution.max_turns': number;
  readonly 'execution.max_capability_calls': number;
  readonly 'execution.max_reported_input_tokens': number;
  readonly 'execution.max_reported_output_tokens': number;
  readonly 'execution.timeout_ms': number;
  readonly 'credential.openai_api_key': OpenAiCredentialPresence;
}

export type ConfigurationResolutionRule = 'selection' | 'ceiling' | 'secret_presence';

export const configurationNormalizationRules = {
  atomic_inference_route_v1: {
    kind: 'atomic_object',
    partialValue: 'error',
    provider: {
      trimOuterWhitespace: true,
      canonicalCase: 'lowercase',
      allowedValues: ['ollama', 'openai'],
    },
    model: { trimOuterWhitespace: true, minimumLength: 1, maximumLength: 200 },
  },
  engine_root_v1: {
    kind: 'path',
    trimOuterWhitespace: true,
    commandLineAndEnvironmentRelativeTo: 'process_working_directory',
    userFileRequiresAbsolutePath: true,
    workspaceFileAllowed: false,
    canonicalizeExistingAncestors: false,
  },
  absolute_http_url_v1: {
    kind: 'url',
    trimOuterWhitespace: true,
    allowedProtocols: ['http:', 'https:'],
    serialization: 'whatwg_url',
  },
  ollama_context_window_tokens_v1: {
    kind: 'integer',
    minimum: 2_048,
    maximum: 262_144,
    textSyntax: 'base10',
  },
  approval_profile_v1: {
    kind: 'enum',
    trimOuterWhitespace: true,
    canonicalCase: 'lowercase',
    allowedValues: ['developer', 'review', 'locked'],
    restrictionOrder: ['developer', 'review', 'locked'],
  },
  max_turns_v1: { kind: 'integer', minimum: 1, maximum: 32, textSyntax: 'base10' },
  max_capability_calls_v1: { kind: 'integer', minimum: 0, maximum: 64, textSyntax: 'base10' },
  max_reported_tokens_v1: {
    kind: 'integer',
    minimum: 0,
    maximum: 1_000_000_000_000,
    textSyntax: 'base10',
  },
  timeout_ms_v1: { kind: 'integer', minimum: 1, maximum: 900_000, textSyntax: 'base10' },
  openai_api_key_presence_v1: {
    kind: 'secret_presence',
    reference: 'OPENAI_API_KEY',
    retainSecretBytes: false,
  },
} as const;

export type ConfigurationNormalizationId = keyof typeof configurationNormalizationRules;

export type ConfigurationBuiltIn<Field extends ConfigurationFieldId> =
  | { readonly kind: 'absent' }
  | { readonly kind: 'value'; readonly value: ConfigurationFieldValueMap[Field] }
  | { readonly kind: 'host_derived'; readonly description: string };

export type ConfigurationFieldDefinition = {
  [Field in ConfigurationFieldId]: {
    readonly field: Field;
    readonly label: string;
    readonly description: string;
    readonly resolution: ConfigurationResolutionRule;
    readonly normalization: ConfigurationNormalizationId;
    readonly eligibleSources: readonly ConfigurationSource[];
    readonly commandLineOptions: readonly string[];
    readonly environmentVariables: readonly string[];
    readonly configPath?: string;
    readonly sensitive: boolean;
    readonly builtIn: ConfigurationBuiltIn<Field>;
  };
}[ConfigurationFieldId];

export const configurationFieldDefinitions = [
  {
    field: 'inference.route',
    label: 'Inference route',
    description: 'The provider and model Forge will use as one indivisible choice.',
    resolution: 'selection',
    normalization: 'atomic_inference_route_v1',
    eligibleSources: ['managed', 'command_line', 'environment', 'workspace', 'user', 'built_in'],
    commandLineOptions: ['--provider', '--model'],
    environmentVariables: ['FORGE_DEFAULT_PROVIDER', 'FORGE_DEFAULT_MODEL'],
    configPath: 'inference',
    sensitive: false,
    builtIn: { kind: 'absent' },
  },
  {
    field: 'engine.root',
    label: 'Forge data location',
    description: 'The host-controlled directory for Forge state, kept separate from the workspace.',
    resolution: 'selection',
    normalization: 'engine_root_v1',
    eligibleSources: ['managed', 'command_line', 'environment', 'user', 'built_in'],
    commandLineOptions: ['--engine-root'],
    environmentVariables: ['FORGE_ENGINE_ROOT'],
    configPath: 'engineRoot',
    sensitive: false,
    builtIn: { kind: 'host_derived', description: '<home>/.forge' },
  },
  {
    field: 'provider.ollama.base_url',
    label: 'Ollama endpoint',
    description: 'The exact operator-selected Ollama-compatible base URL.',
    resolution: 'selection',
    normalization: 'absolute_http_url_v1',
    eligibleSources: ['managed', 'environment', 'user', 'built_in'],
    commandLineOptions: [],
    environmentVariables: ['FORGE_OLLAMA_URL'],
    configPath: 'providers.ollama.baseUrl',
    sensitive: false,
    builtIn: { kind: 'value', value: 'http://127.0.0.1:11434/' },
  },
  {
    field: 'provider.ollama.context_window_tokens',
    label: 'Ollama context window',
    description: 'The maximum context window requested from Ollama, in tokens.',
    resolution: 'selection',
    normalization: 'ollama_context_window_tokens_v1',
    eligibleSources: ['managed', 'environment', 'user', 'built_in'],
    commandLineOptions: [],
    environmentVariables: ['FORGE_OLLAMA_CONTEXT_TOKENS'],
    configPath: 'providers.ollama.contextWindowTokens',
    sensitive: false,
    builtIn: { kind: 'value', value: 8_192 },
  },
  {
    field: 'provider.openai.base_url',
    label: 'OpenAI endpoint',
    description: 'The exact operator-selected OpenAI-compatible base URL.',
    resolution: 'selection',
    normalization: 'absolute_http_url_v1',
    eligibleSources: ['managed', 'environment', 'user', 'built_in'],
    commandLineOptions: [],
    environmentVariables: ['FORGE_OPENAI_BASE_URL'],
    configPath: 'providers.openai.baseUrl',
    sensitive: false,
    builtIn: { kind: 'value', value: 'https://api.openai.com/' },
  },
  {
    field: 'approval.profile',
    label: 'Approval profile',
    description: 'The strictest applicable capability-approval posture.',
    resolution: 'ceiling',
    normalization: 'approval_profile_v1',
    eligibleSources: configurationSources,
    commandLineOptions: ['--approval-profile'],
    environmentVariables: ['FORGE_APPROVAL_PROFILE'],
    configPath: 'approvalProfile',
    sensitive: false,
    builtIn: { kind: 'value', value: 'developer' },
  },
  {
    field: 'execution.max_turns',
    label: 'Maximum turns',
    description: 'The maximum number of planning turns in one run.',
    resolution: 'ceiling',
    normalization: 'max_turns_v1',
    eligibleSources: configurationSources,
    commandLineOptions: ['--max-turns'],
    environmentVariables: ['FORGE_MAX_TURNS'],
    configPath: 'execution.maxTurns',
    sensitive: false,
    builtIn: { kind: 'value', value: 8 },
  },
  {
    field: 'execution.max_capability_calls',
    label: 'Maximum capability calls',
    description: 'The maximum number of model-requested capability calls in one run.',
    resolution: 'ceiling',
    normalization: 'max_capability_calls_v1',
    eligibleSources: configurationSources,
    commandLineOptions: ['--max-capability-calls'],
    environmentVariables: ['FORGE_MAX_CAPABILITY_CALLS'],
    configPath: 'execution.maxCapabilityCalls',
    sensitive: false,
    builtIn: { kind: 'value', value: 6 },
  },
  {
    field: 'execution.max_reported_input_tokens',
    label: 'Maximum reported input tokens',
    description: 'The cumulative provider-reported input-token ceiling for one run.',
    resolution: 'ceiling',
    normalization: 'max_reported_tokens_v1',
    eligibleSources: configurationSources,
    commandLineOptions: ['--max-input-tokens'],
    environmentVariables: ['FORGE_MAX_INPUT_TOKENS'],
    configPath: 'execution.maxReportedInputTokens',
    sensitive: false,
    builtIn: { kind: 'value', value: 262_144 },
  },
  {
    field: 'execution.max_reported_output_tokens',
    label: 'Maximum reported output tokens',
    description: 'The cumulative provider-reported output-token ceiling for one run.',
    resolution: 'ceiling',
    normalization: 'max_reported_tokens_v1',
    eligibleSources: configurationSources,
    commandLineOptions: ['--max-output-tokens'],
    environmentVariables: ['FORGE_MAX_OUTPUT_TOKENS'],
    configPath: 'execution.maxReportedOutputTokens',
    sensitive: false,
    builtIn: { kind: 'value', value: 32_768 },
  },
  {
    field: 'execution.timeout_ms',
    label: 'Run timeout',
    description: 'The wall-clock timeout for one run, in milliseconds.',
    resolution: 'ceiling',
    normalization: 'timeout_ms_v1',
    eligibleSources: configurationSources,
    commandLineOptions: ['--timeout-ms'],
    environmentVariables: ['FORGE_TIMEOUT_MS'],
    configPath: 'execution.timeoutMs',
    sensitive: false,
    builtIn: { kind: 'value', value: 120_000 },
  },
  {
    field: 'credential.openai_api_key',
    label: 'OpenAI credential',
    description: 'Whether the fixed OPENAI_API_KEY reference is available; its bytes are never retained.',
    resolution: 'secret_presence',
    normalization: 'openai_api_key_presence_v1',
    eligibleSources: ['managed', 'environment', 'built_in'],
    commandLineOptions: [],
    environmentVariables: ['OPENAI_API_KEY'],
    sensitive: true,
    builtIn: { kind: 'absent' },
  },
] as const satisfies readonly ConfigurationFieldDefinition[];

export interface InferenceRouteConfigurationV1 {
  readonly provider: InferenceRoute['provider'];
  readonly model: string;
}

export interface ProviderConfigurationV1 {
  readonly ollama?: {
    readonly baseUrl?: string;
    readonly contextWindowTokens?: number;
  };
  readonly openai?: {
    readonly baseUrl?: string;
  };
}

export interface ExecutionConfigurationV1 {
  readonly maxTurns?: number;
  readonly maxCapabilityCalls?: number;
  readonly maxReportedInputTokens?: number;
  readonly maxReportedOutputTokens?: number;
  readonly timeoutMs?: number;
}

export interface WorkspaceConfigurationFileV1 {
  readonly schemaVersion: 1;
  readonly inference?: InferenceRouteConfigurationV1;
  readonly approvalProfile?: ProductApprovalProfile;
  readonly execution?: ExecutionConfigurationV1;
}

export interface UserConfigurationFileV1 extends WorkspaceConfigurationFileV1 {
  readonly engineRoot?: string;
  readonly providers?: ProviderConfigurationV1;
}

export type ConfigurationEvidenceBySource = {
  readonly managed: { readonly authority: string };
  readonly command_line: { readonly options: readonly string[] };
  readonly environment: { readonly variables: readonly string[] };
  readonly workspace: { readonly path: string; readonly configPath: string };
  readonly user: { readonly path: string; readonly configPath: string };
  readonly built_in: { readonly name: string };
};

export type ConfigurationFact<
  Field extends ConfigurationFieldId = ConfigurationFieldId,
  Source extends ConfigurationSource = ConfigurationSource,
> = Field extends ConfigurationFieldId
  ? Source extends ConfigurationSource
    ? {
        readonly field: Field;
        readonly source: Source;
        readonly value: ConfigurationFieldValueMap[Field];
        readonly evidence: ConfigurationEvidenceBySource[Source];
      }
    : never
  : never;

export interface ManagedConfigurationFactsV1 {
  readonly schemaVersion: 1;
  readonly facts: readonly ConfigurationFact<ConfigurationFieldId, 'managed'>[];
}

export type EffectiveField<Field extends ConfigurationFieldId = ConfigurationFieldId> =
  Field extends ConfigurationFieldId
    ? {
        readonly field: Field;
        readonly value: ConfigurationFieldValueMap[Field];
        readonly sources: readonly ConfigurationSource[];
        readonly digest: string;
      }
    : never;

export type ConfigurationDigestMaterial = {
  [Field in ConfigurationFieldId]: Field extends 'credential.openai_api_key'
    ? {
        readonly schemaVersion: 1;
        readonly field: Field;
        readonly sources: readonly ConfigurationSource[];
        readonly present: boolean;
        readonly secret: OpenAiCredentialPresence['handle'];
      }
    : {
        readonly schemaVersion: 1;
        readonly field: Field;
        readonly sources: readonly ConfigurationSource[];
        readonly present: true;
        readonly value: ConfigurationFieldValueMap[Field];
      };
}[ConfigurationFieldId];

export const configurationDigestContract = {
  algorithm: 'sha256',
  encoding: 'lowercase_hex',
  inputEncoding: 'utf8',
  canonicalization: 'recursive_lexicographic_object_keys_compact_json',
  arrayOrder: 'preserved',
  sourcesOrder: 'configuration_precedence',
  excludes: ['secret_bytes', 'secret_length', 'secret_prefix', 'secret_hash'],
} as const;

export type EffectiveConfigurationDiagnostic = {
  [Field in ConfigurationFieldId]: Field extends 'credential.openai_api_key'
    ? {
        readonly field: Field;
        readonly label: string;
        readonly sources: readonly ConfigurationSource[];
        readonly digest: string;
        readonly present: boolean;
        readonly redacted: true;
      }
    : {
        readonly field: Field;
        readonly label: string;
        readonly sources: readonly ConfigurationSource[];
        readonly digest: string;
        readonly present: boolean;
        readonly redacted: false;
        readonly value?: ConfigurationFieldValueMap[Field];
      };
}[ConfigurationFieldId];

export interface EffectiveProductConfiguration {
  readonly schemaVersion: 1;
  readonly contractVersion: typeof configurationContractVersion;
  readonly route?: EffectiveField<'inference.route'>;
  readonly engineRoot: EffectiveField<'engine.root'>;
  readonly providers: {
    readonly ollama: {
      readonly baseUrl: EffectiveField<'provider.ollama.base_url'>;
      readonly contextWindowTokens: EffectiveField<'provider.ollama.context_window_tokens'>;
    };
    readonly openai: {
      readonly baseUrl: EffectiveField<'provider.openai.base_url'>;
      readonly credential: EffectiveField<'credential.openai_api_key'>;
    };
  };
  readonly approvalProfile: EffectiveField<'approval.profile'>;
  readonly execution: {
    readonly maxTurns: EffectiveField<'execution.max_turns'>;
    readonly maxCapabilityCalls: EffectiveField<'execution.max_capability_calls'>;
    readonly maxReportedInputTokens: EffectiveField<'execution.max_reported_input_tokens'>;
    readonly maxReportedOutputTokens: EffectiveField<'execution.max_reported_output_tokens'>;
    readonly timeoutMs: EffectiveField<'execution.timeout_ms'>;
  };
  readonly diagnostics: readonly EffectiveConfigurationDiagnostic[];
}

export const configurationIssueCodes = [
  'config_file_too_large',
  'config_file_not_regular',
  'config_file_outside_workspace',
  'config_file_unreadable',
  'config_json_invalid',
  'config_schema_unsupported',
  'config_unknown_field',
  'config_value_invalid',
  'config_source_forbidden',
  'config_route_incomplete',
  'config_secret_forbidden',
] as const;

export type ConfigurationIssueCode = typeof configurationIssueCodes[number];

/** A bounded, secret-safe problem that tells a person what happened and what to do next. */
export interface ConfigurationIssue {
  readonly code: ConfigurationIssueCode;
  readonly source: ConfigurationSource;
  readonly field?: ConfigurationFieldId;
  readonly location: string;
  readonly message: string;
  readonly hint: string;
}
