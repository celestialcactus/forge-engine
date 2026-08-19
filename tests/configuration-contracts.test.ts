import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  configurationDigestContract,
  configurationFieldDefinitions,
  configurationFieldIds,
  configurationFileRelativePath,
  configurationIssueCodes,
  configurationNormalizationRules,
  configurationSources,
  inferenceEndpointLocalityContract,
  maximumConfigurationFileBytes,
  type ConfigurationFieldId,
  type ConfigurationIssue,
  type UserConfigurationFileV1,
  type WorkspaceConfigurationFileV1,
} from '../src/config/contracts.js';
import {
  configurationGoldenCases,
  type ConfigurationGoldenCase,
} from './fixtures/configuration/golden-cases.js';

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Canonical configuration JSON cannot contain undefined.');
  return encoded;
};

const sha256 = (value: string): string =>
  createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');

const issuesFrom = (fixture: ConfigurationGoldenCase): readonly ConfigurationIssue[] => {
  if (fixture.kind === 'source_document_matrix') {
    return fixture.documents.map(({ expectedIssue }) => ({
      ...expectedIssue,
      source: fixture.source,
    }));
  }
  if (fixture.kind === 'source_file_matrix') {
    return fixture.files.flatMap(({ expected }) => expected === 'absent'
      ? []
      : [{ ...expected, source: fixture.source }]);
  }
  return [];
};

test('freezes one ordered, complete effective-configuration field vocabulary', () => {
  assert.equal(configurationFileRelativePath, '.forge/config.json');
  assert.equal(maximumConfigurationFileBytes, 65_536);
  assert.deepEqual(configurationSources, [
    'managed',
    'command_line',
    'environment',
    'workspace',
    'user',
    'built_in',
  ]);
  assert.deepEqual(
    configurationFieldDefinitions.map(({ field }) => field),
    configurationFieldIds,
  );
  assert.equal(new Set(configurationFieldIds).size, configurationFieldIds.length);
  for (const definition of configurationFieldDefinitions) {
    assert.ok(definition.label.length > 0, `${definition.field} needs a human label`);
    assert.ok(definition.description.length > 0, `${definition.field} needs a human description`);
    assert.ok(definition.eligibleSources.length > 0, `${definition.field} needs an eligible source`);
    assert.equal(new Set(definition.eligibleSources).size, definition.eligibleSources.length);
    assert.ok(definition.normalization in configurationNormalizationRules);
  }
});

test('freezes source eligibility at the host/workspace trust boundary', () => {
  const sources = new Map<ConfigurationFieldId, readonly string[]>(
    configurationFieldDefinitions.map((definition) => [definition.field, definition.eligibleSources]),
  );

  assert.deepEqual(sources.get('inference.route'), configurationSources);
  assert.deepEqual(sources.get('engine.root'), ['managed', 'command_line', 'environment', 'user', 'built_in']);
  assert.deepEqual(sources.get('provider.ollama.base_url'), ['managed', 'environment', 'user', 'built_in']);
  assert.deepEqual(sources.get('provider.ollama.context_window_tokens'), ['managed', 'environment', 'user', 'built_in']);
  assert.deepEqual(sources.get('provider.openai.base_url'), ['managed', 'environment', 'user', 'built_in']);
  assert.deepEqual(sources.get('credential.openai_api_key'), ['managed', 'environment', 'built_in']);

  const workspaceFields = configurationFieldDefinitions
    .filter(({ eligibleSources }) =>
      (eligibleSources as readonly string[]).includes('workspace'))
    .map(({ field }) => field);
  assert.deepEqual(workspaceFields, [
    'inference.route',
    'approval.profile',
    'execution.max_turns',
    'execution.max_capability_calls',
    'execution.max_reported_input_tokens',
    'execution.max_reported_output_tokens',
    'execution.timeout_ms',
  ]);

  const credential = configurationFieldDefinitions.find(({ field }) =>
    field === 'credential.openai_api_key');
  assert.equal(credential?.sensitive, true);
  assert.equal(credential !== undefined && 'configPath' in credential ? credential.configPath : undefined, undefined);
  assert.deepEqual(credential?.commandLineOptions, []);
  assert.deepEqual(credential?.environmentVariables, ['OPENAI_API_KEY']);
});

test('keeps the file shape small, data-only, and aligned with CLI concepts', () => {
  const workspace: WorkspaceConfigurationFileV1 = {
    schemaVersion: 1,
    inference: { provider: 'ollama', model: 'qwen-fixture' },
    approvalProfile: 'review',
    execution: {
      maxTurns: 4,
      maxCapabilityCalls: 2,
      maxReportedInputTokens: 100_000,
      maxReportedOutputTokens: 10_000,
      timeoutMs: 60_000,
    },
  };
  const user: UserConfigurationFileV1 = {
    ...workspace,
    engineRoot: 'C:/Users/fixture/.forge-state',
    providers: {
      ollama: { baseUrl: 'http://127.0.0.1:11434', contextWindowTokens: 16_384 },
      openai: { baseUrl: 'https://api.openai.com' },
    },
  };

  assert.equal(workspace.inference?.provider, 'ollama');
  assert.equal(user.providers?.ollama?.contextWindowTokens, 16_384);
  assert.doesNotMatch(JSON.stringify(user), /apiKey|credential|secret/iu);
});

test('locks current runtime bounds and secret-safe digest semantics', () => {
  assert.deepEqual(configurationNormalizationRules.max_turns_v1, {
    kind: 'integer', minimum: 1, maximum: 32, textSyntax: 'base10',
  });
  assert.deepEqual(configurationNormalizationRules.max_capability_calls_v1, {
    kind: 'integer', minimum: 0, maximum: 64, textSyntax: 'base10',
  });
  assert.equal(configurationNormalizationRules.max_reported_tokens_v1.maximum, 1_000_000_000_000);
  assert.deepEqual(configurationNormalizationRules.timeout_ms_v1, {
    kind: 'integer', minimum: 1, maximum: 900_000, textSyntax: 'base10',
  });
  assert.deepEqual(configurationNormalizationRules.http_provider_origin_v1, {
    kind: 'url_origin',
    trimOuterWhitespace: true,
    allowedProtocols: ['http:', 'https:'],
    serialization: 'whatwg_url',
    requireRootPath: true,
    allowUsername: false,
    allowPassword: false,
    allowQuery: false,
    allowFragment: false,
  });
  assert.equal(inferenceEndpointLocalityContract.loopbackLocality, 'local');
  assert.equal(inferenceEndpointLocalityContract.nonLoopbackLocality, 'cloud');
  assert.equal(inferenceEndpointLocalityContract.adapterIdentityIsLocalityEvidence, false);
  assert.equal(inferenceEndpointLocalityContract.networkProbeAllowedForClassification, false);
  assert.deepEqual(configurationDigestContract, {
    algorithm: 'sha256',
    encoding: 'lowercase_hex',
    inputEncoding: 'utf8',
    canonicalization: 'recursive_lexicographic_object_keys_compact_json',
    arrayOrder: 'preserved',
    sourcesOrder: 'configuration_precedence',
    excludes: ['secret_bytes', 'secret_length', 'secret_prefix', 'secret_hash'],
  });
});

test('golden manifest covers every accepted adversarial requirement exactly and actionably', () => {
  assert.equal(new Set(configurationGoldenCases.map(({ id }) => id)).size, configurationGoldenCases.length);
  const covered = new Set(configurationGoldenCases.flatMap(({ requirements }) => requirements));
  assert.deepEqual([...covered].sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  const issues = configurationGoldenCases.flatMap(issuesFrom);
  assert.ok(issues.length > 0);
  for (const candidate of issues) {
    assert.ok(configurationIssueCodes.includes(candidate.code));
    assert.ok(candidate.location.length > 0);
    assert.ok(candidate.message.length > 0);
    assert.ok(candidate.hint.length > 0);
    assert.doesNotMatch(`${candidate.message}\n${candidate.hint}`, /do-not-accept/u);
  }
});

test('selection golden matrix contains every eligible source in precedence order', () => {
  const fixture = configurationGoldenCases.find(({ kind }) => kind === 'selection_precedence_matrix');
  assert.ok(fixture !== undefined && fixture.kind === 'selection_precedence_matrix');
  for (const sample of fixture.samples) {
    const definition = configurationFieldDefinitions.find(({ field }) => field === sample.field);
    assert.ok(definition !== undefined);
    assert.deepEqual(
      sample.candidates.map(({ source }) => source),
      definition.eligibleSources,
      `${sample.field} fixture must exercise each eligible source`,
    );
  }
});

test('secret golden digests exclude bytes and use the frozen canonical material', () => {
  const fixture = configurationGoldenCases.find(({ kind }) => kind === 'secret_invariance');
  assert.ok(fixture !== undefined && fixture.kind === 'secret_invariance');

  const presentMaterial = {
    schemaVersion: 1,
    field: 'credential.openai_api_key',
    sources: ['environment'],
    present: true,
    secret: { kind: 'environment_variable', name: 'OPENAI_API_KEY' },
  };
  const absentMaterial = {
    schemaVersion: 1,
    field: 'credential.openai_api_key',
    sources: ['built_in'],
    present: false,
    secret: { kind: 'environment_variable', name: 'OPENAI_API_KEY' },
  };

  assert.equal(canonicalJson(presentMaterial), fixture.canonicalDigestInput);
  assert.equal(sha256(fixture.canonicalDigestInput), fixture.expectedDigest);
  assert.equal(canonicalJson(absentMaterial), fixture.absentCanonicalDigestInput);
  assert.equal(sha256(fixture.absentCanonicalDigestInput), fixture.expectedAbsentDigest);

  for (const input of fixture.inputs) {
    const rendered: string = JSON.stringify({
      ...fixture.expectedPresence,
      digest: fixture.expectedDigest,
    });
    assert.equal(rendered.includes(input.OPENAI_API_KEY ?? ''), false);
  }
});

test('zero-config doctor has a frozen absent-route digest', () => {
  const fixture = configurationGoldenCases.find(({ kind }) => kind === 'doctor_parity');
  assert.ok(fixture !== undefined && fixture.kind === 'doctor_parity');
  const absentRoute = {
    schemaVersion: 1,
    field: 'inference.route',
    sources: ['built_in'],
    present: false,
  };
  assert.equal(canonicalJson(absentRoute), fixture.absentRouteCanonicalDigestInput);
  assert.equal(sha256(fixture.absentRouteCanonicalDigestInput), fixture.expectedAbsentRouteDigest);
});
