import type {
  ConfigurationFieldId,
  ConfigurationFieldValueMap,
  ConfigurationIssueCode,
  ConfigurationSource,
} from '../../../src/config/contracts.js';

type RequirementNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type GoldenOwner = 'source_loader' | 'resolver' | 'projection' | 'integration' | 'release';

interface GoldenCaseBase {
  readonly id: string;
  readonly requirements: readonly RequirementNumber[];
  readonly owner: GoldenOwner;
  readonly summary: string;
}

type SelectionCandidate<Field extends ConfigurationFieldId> =
  | {
      readonly source: ConfigurationSource;
      readonly present: true;
      readonly value: ConfigurationFieldValueMap[Field];
    }
  | { readonly source: 'built_in'; readonly present: false };

type SelectionSample = {
  [Field in ConfigurationFieldId]: {
    readonly field: Field;
    readonly candidates: readonly SelectionCandidate<Field>[];
  };
}[ConfigurationFieldId];

type CeilingScenario = {
  [Field in ConfigurationFieldId]: {
    readonly field: Field;
    readonly candidates: readonly {
      readonly source: ConfigurationSource;
      readonly value: ConfigurationFieldValueMap[Field];
    }[];
    readonly expectedValue: ConfigurationFieldValueMap[Field];
  };
}[ConfigurationFieldId];

interface ExpectedIssue {
  readonly code: ConfigurationIssueCode;
  readonly location: string;
  readonly message: string;
  readonly hint: string;
}

export type ConfigurationGoldenCase = GoldenCaseBase & (
  | {
      readonly kind: 'selection_precedence_matrix';
      readonly samples: readonly SelectionSample[];
      readonly expected: 'highest_priority_present_candidate';
    }
  | {
      readonly kind: 'source_document_matrix';
      readonly source: 'workspace' | 'user';
      readonly documents: readonly {
        readonly name: string;
        readonly document: Readonly<Record<string, unknown>>;
        readonly expectedIssue: ExpectedIssue;
      }[];
    }
  | {
      readonly kind: 'ceiling_matrix';
      readonly scenarios: readonly CeilingScenario[];
    }
  | {
      readonly kind: 'source_file_matrix';
      readonly source: 'workspace' | 'user';
      readonly files: readonly {
        readonly condition: string;
        readonly expected: 'absent' | ExpectedIssue;
      }[];
    }
  | {
      readonly kind: 'secret_invariance';
      readonly inputs: readonly Readonly<Record<string, string>>[];
      readonly expectedPresence: Readonly<Record<string, unknown>>;
      readonly canonicalDigestInput: string;
      readonly expectedDigest: string;
      readonly absentCanonicalDigestInput: string;
      readonly expectedAbsentDigest: string;
      readonly forbiddenOutputFragments: readonly string[];
    }
  | {
      readonly kind: 'doctor_parity';
      readonly expectedFieldOrder: readonly ConfigurationFieldId[];
      readonly requiredAttributes: readonly string[];
    }
  | {
      readonly kind: 'consumer_equivalence';
      readonly input: Readonly<Record<string, unknown>>;
      readonly consumers: readonly string[];
      readonly expected: string;
    }
  | {
      readonly kind: 'platform_defaults';
      readonly platforms: readonly string[];
      readonly expected: readonly string[];
    }
  | {
      readonly kind: 'provider_failure';
      readonly route: ConfigurationFieldValueMap['inference.route'];
      readonly failure: string;
      readonly expected: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'endpoint_claim';
      readonly provider: 'ollama';
      readonly baseUrl: string;
      readonly expected: Readonly<Record<string, unknown>>;
    }
);

const issue = (
  code: ConfigurationIssueCode,
  location: string,
  message: string,
  hint: string,
): ExpectedIssue => ({ code, location, message, hint });

export const configurationGoldenCases = [
  {
    id: 'selection-precedence-all-eligible-pairs',
    requirements: [1],
    owner: 'resolver',
    summary: 'Each higher-priority present selection defeats each lower-priority eligible selection.',
    kind: 'selection_precedence_matrix',
    samples: [
      {
        field: 'inference.route',
        candidates: [
          { source: 'managed', present: true, value: { provider: 'openai', model: 'managed-model' } },
          { source: 'command_line', present: true, value: { provider: 'openai', model: 'cli-model' } },
          { source: 'environment', present: true, value: { provider: 'ollama', model: 'environment-model' } },
          { source: 'workspace', present: true, value: { provider: 'ollama', model: 'workspace-model' } },
          { source: 'user', present: true, value: { provider: 'openai', model: 'user-model' } },
          { source: 'built_in', present: false },
        ],
      },
      {
        field: 'engine.root',
        candidates: [
          { source: 'managed', present: true, value: 'C:/forge/managed' },
          { source: 'command_line', present: true, value: 'C:/forge/cli' },
          { source: 'environment', present: true, value: 'C:/forge/environment' },
          { source: 'user', present: true, value: 'C:/forge/user' },
          { source: 'built_in', present: true, value: 'C:/Users/fixture/.forge' },
        ],
      },
      {
        field: 'provider.ollama.base_url',
        candidates: [
          { source: 'managed', present: true, value: 'https://managed-ollama.example/' },
          { source: 'environment', present: true, value: 'https://environment-ollama.example/' },
          { source: 'user', present: true, value: 'https://user-ollama.example/' },
          { source: 'built_in', present: true, value: 'http://127.0.0.1:11434/' },
        ],
      },
      {
        field: 'provider.ollama.context_window_tokens',
        candidates: [
          { source: 'managed', present: true, value: 65_536 },
          { source: 'environment', present: true, value: 32_768 },
          { source: 'user', present: true, value: 16_384 },
          { source: 'built_in', present: true, value: 8_192 },
        ],
      },
      {
        field: 'provider.openai.base_url',
        candidates: [
          { source: 'managed', present: true, value: 'https://managed-openai.example/' },
          { source: 'environment', present: true, value: 'https://environment-openai.example/' },
          { source: 'user', present: true, value: 'https://user-openai.example/' },
          { source: 'built_in', present: true, value: 'https://api.openai.com/' },
        ],
      },
    ],
    expected: 'highest_priority_present_candidate',
  },
  {
    id: 'route-is-atomic-with-actionable-errors',
    requirements: [2],
    owner: 'source_loader',
    summary: 'A provider or model alone never combines with another source.',
    kind: 'source_document_matrix',
    source: 'workspace',
    documents: [
      {
        name: 'provider-only',
        document: { schemaVersion: 1, inference: { provider: 'ollama' } },
        expectedIssue: issue(
          'config_route_incomplete',
          '<workspace>/.forge/config.json#inference',
          'Inference settings must include both "provider" and "model".',
          'Set both values under "inference", or remove the "inference" object.',
        ),
      },
      {
        name: 'model-only',
        document: { schemaVersion: 1, inference: { model: 'fixture-model' } },
        expectedIssue: issue(
          'config_route_incomplete',
          '<workspace>/.forge/config.json#inference',
          'Inference settings must include both "provider" and "model".',
          'Set both values under "inference", or remove the "inference" object.',
        ),
      },
    ],
  },
  {
    id: 'approval-profile-strictest-ceiling-wins',
    requirements: [3],
    owner: 'resolver',
    summary: 'Approval inputs can tighten but never relax another applicable ceiling.',
    kind: 'ceiling_matrix',
    scenarios: [
      {
        field: 'approval.profile',
        candidates: [
          { source: 'user', value: 'locked' },
          { source: 'command_line', value: 'developer' },
          { source: 'built_in', value: 'developer' },
        ],
        expectedValue: 'locked',
      },
      {
        field: 'approval.profile',
        candidates: [
          { source: 'workspace', value: 'review' },
          { source: 'user', value: 'developer' },
          { source: 'built_in', value: 'developer' },
        ],
        expectedValue: 'review',
      },
      {
        field: 'approval.profile',
        candidates: [
          { source: 'managed', value: 'review' },
          { source: 'workspace', value: 'locked' },
          { source: 'command_line', value: 'developer' },
        ],
        expectedValue: 'locked',
      },
    ],
  },
  {
    id: 'numeric-limits-use-source-independent-minimum',
    requirements: [4],
    owner: 'resolver',
    summary: 'Every numeric policy field resolves to the minimum valid candidate.',
    kind: 'ceiling_matrix',
    scenarios: [
      {
        field: 'execution.max_turns',
        candidates: [
          { source: 'workspace', value: 4 },
          { source: 'managed', value: 12 },
          { source: 'user', value: 6 },
          { source: 'built_in', value: 8 },
        ],
        expectedValue: 4,
      },
      {
        field: 'execution.max_capability_calls',
        candidates: [
          { source: 'command_line', value: 3 },
          { source: 'workspace', value: 0 },
          { source: 'built_in', value: 6 },
        ],
        expectedValue: 0,
      },
      {
        field: 'execution.max_reported_input_tokens',
        candidates: [
          { source: 'environment', value: 100_000 },
          { source: 'managed', value: 200_000 },
          { source: 'built_in', value: 262_144 },
        ],
        expectedValue: 100_000,
      },
      {
        field: 'execution.max_reported_output_tokens',
        candidates: [
          { source: 'user', value: 20_000 },
          { source: 'workspace', value: 10_000 },
          { source: 'built_in', value: 32_768 },
        ],
        expectedValue: 10_000,
      },
      {
        field: 'execution.timeout_ms',
        candidates: [
          { source: 'built_in', value: 120_000 },
          { source: 'command_line', value: 60_000 },
          { source: 'user', value: 90_000 },
        ],
        expectedValue: 60_000,
      },
    ],
  },
  {
    id: 'workspace-cannot-establish-host-trust-anchors',
    requirements: [5],
    owner: 'source_loader',
    summary: 'Workspace-owned state, endpoint, provider tuning, secret, and unknown fields fail early.',
    kind: 'source_document_matrix',
    source: 'workspace',
    documents: [
      {
        name: 'engine-root',
        document: { schemaVersion: 1, engineRoot: 'C:/untrusted-state' },
        expectedIssue: issue(
          'config_source_forbidden',
          '<workspace>/.forge/config.json#engineRoot',
          'A workspace cannot choose the Forge data location.',
          'Move "engineRoot" to ~/.forge/config.json, FORGE_ENGINE_ROOT, or --engine-root.',
        ),
      },
      {
        name: 'ollama-endpoint',
        document: { schemaVersion: 1, providers: { ollama: { baseUrl: 'https://untrusted.example' } } },
        expectedIssue: issue(
          'config_source_forbidden',
          '<workspace>/.forge/config.json#providers.ollama.baseUrl',
          'A workspace cannot choose the Ollama endpoint.',
          'Move this setting to ~/.forge/config.json or FORGE_OLLAMA_URL.',
        ),
      },
      {
        name: 'ollama-context-window',
        document: { schemaVersion: 1, providers: { ollama: { contextWindowTokens: 16_384 } } },
        expectedIssue: issue(
          'config_source_forbidden',
          '<workspace>/.forge/config.json#providers.ollama.contextWindowTokens',
          'A workspace cannot tune the Ollama provider.',
          'Move this setting to ~/.forge/config.json or FORGE_OLLAMA_CONTEXT_TOKENS.',
        ),
      },
      {
        name: 'openai-endpoint',
        document: { schemaVersion: 1, providers: { openai: { baseUrl: 'https://untrusted.example' } } },
        expectedIssue: issue(
          'config_source_forbidden',
          '<workspace>/.forge/config.json#providers.openai.baseUrl',
          'A workspace cannot choose the OpenAI endpoint.',
          'Move this setting to ~/.forge/config.json or FORGE_OPENAI_BASE_URL.',
        ),
      },
      {
        name: 'credential',
        document: { schemaVersion: 1, credentials: { openaiApiKey: 'do-not-accept' } },
        expectedIssue: issue(
          'config_secret_forbidden',
          '<workspace>/.forge/config.json#credentials',
          'Forge configuration files cannot contain credentials.',
          'Set OPENAI_API_KEY in the host environment; do not put the key in this file.',
        ),
      },
      {
        name: 'unknown-key',
        document: { schemaVersion: 1, approvalProfiles: 'review' },
        expectedIssue: issue(
          'config_unknown_field',
          '<workspace>/.forge/config.json#approvalProfiles',
          'Forge does not recognize "approvalProfiles".',
          'Use "approvalProfile", or remove the unknown setting.',
        ),
      },
    ],
  },
  {
    id: 'present-files-are-bounded-and-never-ignored',
    requirements: [6],
    owner: 'source_loader',
    summary: 'Only a missing optional file is absence; every invalid present file is actionable failure.',
    kind: 'source_file_matrix',
    source: 'workspace',
    files: [
      { condition: 'missing', expected: 'absent' },
      {
        condition: 'malformed_json',
        expected: issue(
          'config_json_invalid',
          '<workspace>/.forge/config.json',
          'Forge could not read this configuration because it is not valid JSON.',
          'Fix the JSON syntax in <workspace>/.forge/config.json and run the command again.',
        ),
      },
      {
        condition: '65537_bytes',
        expected: issue(
          'config_file_too_large',
          '<workspace>/.forge/config.json',
          'Forge configuration must be 65536 bytes or smaller.',
          'Remove unrelated content from <workspace>/.forge/config.json.',
        ),
      },
      {
        condition: 'directory',
        expected: issue(
          'config_file_not_regular',
          '<workspace>/.forge/config.json',
          'Forge expected a regular configuration file at <workspace>/.forge/config.json.',
          'Replace that directory or special file with a regular JSON file.',
        ),
      },
      {
        condition: 'symlink_escaping_workspace',
        expected: issue(
          'config_file_outside_workspace',
          '<workspace>/.forge/config.json',
          'The workspace configuration resolves outside the opened workspace.',
          'Replace it with a regular file inside <workspace>/.forge/.',
        ),
      },
      {
        condition: 'unreadable',
        expected: issue(
          'config_file_unreadable',
          '<workspace>/.forge/config.json',
          'Forge cannot read <workspace>/.forge/config.json.',
          'Check the file permissions, then run the command again.',
        ),
      },
    ],
  },
  {
    id: 'secret-bytes-never-affect-effective-output',
    requirements: [7],
    owner: 'projection',
    summary: 'Only the fixed OpenAI handle, source, and presence enter effective configuration.',
    kind: 'secret_invariance',
    inputs: [
      { OPENAI_API_KEY: 'fixture-secret-alpha' },
      { OPENAI_API_KEY: 'a-completely-different-fixture-secret' },
    ],
    expectedPresence: {
      handle: { kind: 'environment_variable', name: 'OPENAI_API_KEY' },
      present: true,
      source: 'environment',
      redacted: true,
    },
    canonicalDigestInput: '{"field":"credential.openai_api_key","present":true,"schemaVersion":1,"secret":{"kind":"environment_variable","name":"OPENAI_API_KEY"},"sources":["environment"]}',
    expectedDigest: '6ecd79b0d70dcbb94d7264e6ca50ff079ac17e4015ca66125599e49de7d1e17c',
    absentCanonicalDigestInput: '{"field":"credential.openai_api_key","present":false,"schemaVersion":1,"secret":{"kind":"environment_variable","name":"OPENAI_API_KEY"},"sources":["built_in"]}',
    expectedAbsentDigest: '6a63e31a11ad351abdc051a0355e9d9896d2f4b961c47752c82452b320eb5bed',
    forbiddenOutputFragments: ['fixture-secret-alpha', 'a-completely-different-fixture-secret'],
  },
  {
    id: 'provider-endpoints-are-origin-only-and-secret-free',
    requirements: [5, 7],
    owner: 'source_loader',
    summary: 'Provider URLs cannot smuggle credentials or unsupported path/query routing into configuration.',
    kind: 'source_document_matrix',
    source: 'user',
    documents: [
      {
        name: 'embedded-credentials',
        document: {
          schemaVersion: 1,
          providers: { openai: { baseUrl: 'https://fixture-user:fixture-password@example.test/' } },
        },
        expectedIssue: issue(
          'config_value_invalid',
          '~/.forge/config.json#providers.openai.baseUrl',
          'Provider endpoints must be origin-only HTTP(S) URLs without credentials, queries, or fragments.',
          'Use an endpoint such as "https://example.test/" and supply credentials through the supported host environment.',
        ),
      },
      {
        name: 'query-token',
        document: {
          schemaVersion: 1,
          providers: { ollama: { baseUrl: 'https://example.test/?token=fixture-query-secret' } },
        },
        expectedIssue: issue(
          'config_value_invalid',
          '~/.forge/config.json#providers.ollama.baseUrl',
          'Provider endpoints must be origin-only HTTP(S) URLs without credentials, queries, or fragments.',
          'Use an endpoint such as "https://example.test/" without query parameters.',
        ),
      },
      {
        name: 'fragment',
        document: {
          schemaVersion: 1,
          providers: { ollama: { baseUrl: 'https://example.test/#fixture-fragment' } },
        },
        expectedIssue: issue(
          'config_value_invalid',
          '~/.forge/config.json#providers.ollama.baseUrl',
          'Provider endpoints must be origin-only HTTP(S) URLs without credentials, queries, or fragments.',
          'Use an endpoint such as "https://example.test/" without a fragment.',
        ),
      },
      {
        name: 'unsupported-base-path',
        document: {
          schemaVersion: 1,
          providers: { openai: { baseUrl: 'https://example.test/gateway/' } },
        },
        expectedIssue: issue(
          'config_value_invalid',
          '~/.forge/config.json#providers.openai.baseUrl',
          'Provider endpoints must use the URL origin without an additional path.',
          'Use "https://example.test/"; path-prefixed provider gateways are not supported in schema v1.',
        ),
      },
    ],
  },
  {
    id: 'doctor-human-and-json-project-one-truth',
    requirements: [8],
    owner: 'projection',
    summary: 'Both presentations derive from the same ordered, redacted diagnostic facts.',
    kind: 'doctor_parity',
    expectedFieldOrder: [
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
    ],
    requiredAttributes: ['field', 'label', 'sources', 'digest', 'present', 'redacted'],
  },
  {
    id: 'all-product-consumers-receive-one-compiled-configuration',
    requirements: [9],
    owner: 'integration',
    summary: 'CLI, service, and MCP do not reread covered environment or file inputs.',
    kind: 'consumer_equivalence',
    input: {
      route: { provider: 'ollama', model: 'fixture-model' },
      approvalProfile: 'review',
      maxTurns: 4,
      maxCapabilityCalls: 2,
    },
    consumers: ['standalone_cli', 'embedded_service', 'mcp_server'],
    expected: 'same_effective_field_values_sources_and_digests',
  },
  {
    id: 'supported-platforms-share-schema-and-semantic-defaults',
    requirements: [10],
    owner: 'release',
    summary: 'Host path spelling may differ, but schema and fallback semantics do not.',
    kind: 'platform_defaults',
    platforms: ['windows_x64', 'macos_arm64', 'macos_x64', 'ubuntu_x64_compatibility'],
    expected: ['same_schema_version', 'same_field_ids', 'same_non_path_defaults', 'home_relative_user_file'],
  },
  {
    id: 'provider-failure-never-reroutes',
    requirements: [11],
    owner: 'integration',
    summary: 'Initialization and transport failure name the attempted route and stop.',
    kind: 'provider_failure',
    route: { provider: 'openai', model: 'fixture-openai-model' },
    failure: 'simulated_transport_failure',
    expected: {
      attemptedProvider: 'openai',
      attemptedModel: 'fixture-openai-model',
      fallbackAttempts: 0,
      secretBytesInError: false,
    },
  },
  {
    id: 'remote-ollama-endpoint-is-not-a-locality-claim',
    requirements: [12],
    owner: 'projection',
    summary: 'Adapter identity is not evidence that a custom endpoint is local.',
    kind: 'endpoint_claim',
    provider: 'ollama',
    baseUrl: 'https://ollama.example.test/',
    expected: {
      endpointSourceReported: true,
      runtimeLocality: 'cloud',
      humanLocality: 'off-device or network endpoint',
      describedAsProofOfLocalInference: false,
      containmentClaimChanged: false,
    },
  },
] as const satisfies readonly ConfigurationGoldenCase[];
