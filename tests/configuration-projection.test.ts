import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configurationFieldIds,
  type ConfigurationDigestMaterial,
  type EffectiveField,
} from '../src/config/contracts.js';
import {
  canonicalizeConfigurationDigestMaterial,
  classifyInferenceEndpointLocality,
  digestConfigurationMaterial,
  orderConfigurationSources,
  projectAbsentInferenceRouteDiagnostic,
  projectEffectiveConfigurationDiagnostics,
  projectEffectiveField,
  projectOpenAiCredentialField,
} from '../src/config/projection.js';
import {
  extractOpenAiCredentialFact,
  extractOpenAiCredentialPresence,
  openAiCredentialHandle,
} from '../src/config/secrets.js';
import { configurationGoldenCases } from './fixtures/configuration/golden-cases.js';

const secretFixture = configurationGoldenCases.find(({ kind }) => kind === 'secret_invariance');
assert.ok(secretFixture !== undefined && secretFixture.kind === 'secret_invariance');

test('extracts only the fixed OpenAI credential handle and presence', () => {
  const outputs = secretFixture.inputs.map(extractOpenAiCredentialPresence);
  assert.deepEqual(outputs, [
    { handle: openAiCredentialHandle, present: true },
    { handle: openAiCredentialHandle, present: true },
  ]);
  assert.deepEqual(extractOpenAiCredentialPresence({}), {
    handle: openAiCredentialHandle,
    present: false,
  });
  assert.equal(extractOpenAiCredentialPresence({ OPENAI_API_KEY: '   \t' }).present, false);
  for (const fragment of secretFixture.forbiddenOutputFragments) {
    assert.doesNotMatch(JSON.stringify(outputs), new RegExp(fragment, 'u'));
  }
});

test('compiles secret-safe environment and built-in facts without retaining bytes', () => {
  const present = extractOpenAiCredentialFact(secretFixture.inputs[0] ?? {});
  const absent = extractOpenAiCredentialFact({});
  assert.deepEqual(present, {
    field: 'credential.openai_api_key',
    source: 'environment',
    value: { handle: openAiCredentialHandle, present: true },
    evidence: { variables: ['OPENAI_API_KEY'] },
  });
  assert.deepEqual(absent, {
    field: 'credential.openai_api_key',
    source: 'built_in',
    value: { handle: openAiCredentialHandle, present: false },
    evidence: { name: 'openai_credential_absent' },
  });
  assert.doesNotMatch(JSON.stringify([present, absent]), /fixture-secret/u);
});

test('canonicalizes recursive object keys while preserving array order', () => {
  const material = {
    value: { provider: 'ollama', model: 'fixture-model' },
    present: true,
    sources: ['workspace', 'user'],
    field: 'inference.route',
    schemaVersion: 1,
  } as const satisfies ConfigurationDigestMaterial;
  assert.equal(
    canonicalizeConfigurationDigestMaterial(material),
    '{"field":"inference.route","present":true,"schemaVersion":1,"sources":["workspace","user"],"value":{"model":"fixture-model","provider":"ollama"}}',
  );
  assert.throws(
    () => canonicalizeConfigurationDigestMaterial({ ...material, value: Number.NaN } as unknown as ConfigurationDigestMaterial),
    /only finite numbers/u,
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(
    () => canonicalizeConfigurationDigestMaterial({ ...material, value: cyclic } as unknown as ConfigurationDigestMaterial),
    /must not contain a cycle/u,
  );
});

test('matches the frozen secret digests and is invariant to secret bytes', () => {
  const fields = secretFixture.inputs.map((environment) =>
    projectOpenAiCredentialField(extractOpenAiCredentialPresence(environment), ['environment']));
  assert.equal(fields[0]?.digest, secretFixture.expectedDigest);
  assert.equal(fields[1]?.digest, secretFixture.expectedDigest);
  assert.deepEqual(fields[0], fields[1]);

  const absent = projectOpenAiCredentialField(extractOpenAiCredentialPresence({}), ['built_in']);
  assert.equal(absent.digest, secretFixture.expectedAbsentDigest);
  assert.equal(
    canonicalizeConfigurationDigestMaterial({
      schemaVersion: 1,
      field: 'credential.openai_api_key',
      sources: ['environment'],
      present: true,
      secret: openAiCredentialHandle,
    }),
    secretFixture.canonicalDigestInput,
  );
  assert.equal(
    digestConfigurationMaterial({
      schemaVersion: 1,
      field: 'credential.openai_api_key',
      sources: ['built_in'],
      present: false,
      secret: openAiCredentialHandle,
    }),
    secretFixture.expectedAbsentDigest,
  );
});

test('normalizes provenance before producing stable non-secret field digests', () => {
  assert.deepEqual(
    orderConfigurationSources(['user', 'managed', 'workspace', 'user']),
    ['managed', 'workspace', 'user'],
  );
  assert.throws(
    () => orderConfigurationSources(['fixture-secret-source' as never]),
    (error: unknown) => error instanceof Error && !error.message.includes('fixture-secret-source'),
  );
  const first = projectEffectiveField(
    'inference.route',
    { provider: 'ollama', model: 'fixture-model' },
    ['user', 'managed', 'workspace'],
  );
  const second = projectEffectiveField(
    'inference.route',
    { model: 'fixture-model', provider: 'ollama' },
    ['workspace', 'managed', 'user'],
  );
  assert.deepEqual(first, second);
  assert.match(first.digest, /^[0-9a-f]{64}$/u);
});

test('projects the frozen absent route for zero-config diagnostics', () => {
  const fixture = configurationGoldenCases.find(({ kind }) => kind === 'doctor_parity');
  assert.ok(fixture !== undefined && fixture.kind === 'doctor_parity');
  const diagnostic = projectAbsentInferenceRouteDiagnostic();
  assert.deepEqual(diagnostic, {
    field: 'inference.route',
    label: 'Inference route',
    sources: ['built_in'],
    digest: fixture.expectedAbsentRouteDigest,
    present: false,
    redacted: false,
  });
  assert.deepEqual(projectEffectiveConfigurationDiagnostics([]), [diagnostic]);
});

test('projects one stable ordered diagnostic truth and always redacts credentials', () => {
  const fields: readonly EffectiveField[] = [
    projectEffectiveField('execution.timeout_ms', 60_000, ['built_in', 'workspace']),
    projectEffectiveField('provider.openai.base_url', 'https://api.openai.com/', ['built_in']),
    projectOpenAiCredentialField(
      extractOpenAiCredentialPresence(secretFixture.inputs[0] ?? {}),
      ['environment'],
    ),
    projectEffectiveField('inference.route', { provider: 'openai', model: 'fixture-model' }, ['workspace']),
    projectEffectiveField('engine.root', 'C:/Users/fixture/.forge', ['built_in']),
    projectEffectiveField('provider.ollama.base_url', 'http://127.0.0.1:11434/', ['built_in']),
    projectEffectiveField('provider.ollama.context_window_tokens', 8_192, ['built_in']),
    projectEffectiveField('approval.profile', 'review', ['workspace', 'built_in']),
    projectEffectiveField('execution.max_turns', 4, ['workspace', 'built_in']),
    projectEffectiveField('execution.max_capability_calls', 2, ['workspace', 'built_in']),
    projectEffectiveField('execution.max_reported_input_tokens', 100_000, ['workspace', 'built_in']),
    projectEffectiveField('execution.max_reported_output_tokens', 10_000, ['workspace', 'built_in']),
  ];
  const diagnostics = projectEffectiveConfigurationDiagnostics(fields);
  assert.deepEqual(diagnostics.map(({ field }) => field), configurationFieldIds);

  const credential = diagnostics.at(-1);
  assert.deepEqual(credential, {
    field: 'credential.openai_api_key',
    label: 'OpenAI credential',
    sources: ['environment'],
    digest: secretFixture.expectedDigest,
    present: true,
    redacted: true,
  });
  assert.equal(credential !== undefined && 'value' in credential, false);
  const rendered = JSON.stringify(diagnostics);
  for (const fragment of secretFixture.forbiddenOutputFragments) {
    assert.equal(rendered.includes(fragment), false);
  }
  assert.throws(
    () => projectEffectiveConfigurationDiagnostics([
      { ...fields[0], field: 'fixture-secret-field' } as unknown as EffectiveField,
    ]),
    (error: unknown) => error instanceof Error && !error.message.includes('fixture-secret-field'),
  );
});

test('classifies endpoint locality lexically without treating adapter identity as evidence', () => {
  const fixture = configurationGoldenCases.find(({ kind }) => kind === 'endpoint_claim');
  assert.ok(fixture !== undefined && fixture.kind === 'endpoint_claim');
  assert.deepEqual(classifyInferenceEndpointLocality(fixture.baseUrl), {
    runtimeLocality: fixture.expected.runtimeLocality,
    humanLocality: fixture.expected.humanLocality,
  });
  for (const endpoint of [
    'http://localhost:11434/',
    'http://LOCALHOST.:11434/',
    'http://127.99.4.3:11434/',
    'http://[::1]:11434/',
    'http://[::ffff:127.0.0.1]:11434/',
  ]) {
    assert.equal(classifyInferenceEndpointLocality(endpoint).runtimeLocality, 'local');
  }
  const sensitiveInvalidEndpoint = 'not a url fixture-secret-alpha';
  assert.throws(
    () => classifyInferenceEndpointLocality(sensitiveInvalidEndpoint),
    (error: unknown) => error instanceof Error && !error.message.includes(sensitiveInvalidEndpoint),
  );
});
