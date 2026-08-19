import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configurationFieldDefinitions,
  configurationSources,
  type ConfigurationEvidenceBySource,
  type ConfigurationFact,
  type ConfigurationFieldId,
  type ConfigurationFieldValueMap,
  type ConfigurationSource,
} from '../src/config/contracts.js';
import {
  ConfigurationResolutionError,
  resolveConfigurationFacts,
  resolveConfigurationField,
  type ResolvedConfigurationField,
} from '../src/config/resolve.js';
import { configurationGoldenCases } from './fixtures/configuration/golden-cases.js';

const evidence = <Source extends ConfigurationSource>(
  source: Source,
): ConfigurationEvidenceBySource[Source] => {
  const evidenceBySource: ConfigurationEvidenceBySource = {
    managed: { authority: 'fixture-managed-host' },
    command_line: { options: ['--fixture'] },
    environment: { variables: ['FORGE_FIXTURE'] },
    workspace: { path: '<workspace>/.forge/config.json', configPath: 'fixture' },
    user: { path: '~/.forge/config.json', configPath: 'fixture' },
    built_in: { name: 'fixture-built-in' },
  };
  return evidenceBySource[source];
};

const fact = <Field extends ConfigurationFieldId, Source extends ConfigurationSource>(
  field: Field,
  source: Source,
  value: ConfigurationFieldValueMap[Field],
): ConfigurationFact<Field, Source> => ({
  field,
  source,
  value,
  evidence: evidence(source),
} as unknown as ConfigurationFact<Field, Source>);

const valueForField = {
  'inference.route': { provider: 'ollama', model: 'fixture-model' },
  'engine.root': 'C:/forge/fixture',
  'provider.ollama.base_url': 'https://ollama.example/',
  'provider.ollama.context_window_tokens': 16_384,
  'provider.openai.base_url': 'https://openai.example/',
  'approval.profile': 'review',
  'execution.max_turns': 4,
  'execution.max_capability_calls': 2,
  'execution.max_reported_input_tokens': 100_000,
  'execution.max_reported_output_tokens': 10_000,
  'execution.timeout_ms': 60_000,
  'credential.openai_api_key': {
    handle: { kind: 'environment_variable', name: 'OPENAI_API_KEY' },
    present: true,
  },
} as const satisfies ConfigurationFieldValueMap;

test('proves every golden selection precedence pair without unrelated field drift', () => {
  const fixture = configurationGoldenCases.find(({ kind }) => kind === 'selection_precedence_matrix');
  assert.ok(fixture !== undefined && fixture.kind === 'selection_precedence_matrix');

  for (const sample of fixture.samples) {
    const candidates = sample.candidates.filter((candidate) => candidate.present);
    for (let higherIndex = 0; higherIndex < candidates.length; higherIndex += 1) {
      const higher = candidates[higherIndex];
      assert.ok(higher !== undefined && higher.present);
      for (let lowerIndex = higherIndex + 1; lowerIndex < candidates.length; lowerIndex += 1) {
        const lower = candidates[lowerIndex];
        assert.ok(lower !== undefined && lower.present);
        const resolved: ResolvedConfigurationField | undefined = resolveConfigurationField(sample.field, [
          fact(sample.field, lower.source, lower.value),
          fact(sample.field, higher.source, higher.value),
        ] as readonly ConfigurationFact<typeof sample.field>[]);
        assert.deepEqual(resolved, {
          field: sample.field,
          value: higher.value,
          sources: [higher.source],
        }, `${sample.field}: ${higher.source} must defeat ${lower.source}`);
      }
    }
  }
});

test('treats each route fact as atomic and never splices route members', () => {
  const selected = resolveConfigurationField('inference.route', [
    fact('inference.route', 'user', { provider: 'openai', model: 'user-model' }),
    fact('inference.route', 'workspace', { provider: 'ollama', model: 'workspace-model' }),
  ]);
  assert.deepEqual(selected, {
    field: 'inference.route',
    value: { provider: 'ollama', model: 'workspace-model' },
    sources: ['workspace'],
  });

  for (const incomplete of [
    { provider: 'ollama' },
    { model: 'fixture-model' },
    { provider: 'ollama', model: '   ' },
  ]) {
    assert.throws(
      () => resolveConfigurationField('inference.route', [
        fact('inference.route', 'workspace', incomplete as ConfigurationFieldValueMap['inference.route']),
      ]),
      (error: unknown) => error instanceof ConfigurationResolutionError
        && error.issue.code === 'config_route_incomplete'
        && error.issue.source === 'workspace',
    );
  }
});

test('resolves the golden approval lattice and numeric minima independently of input order', () => {
  const fixture = configurationGoldenCases.find(({ kind }) => kind === 'ceiling_matrix');
  assert.ok(fixture !== undefined && fixture.kind === 'ceiling_matrix');

  for (const scenario of fixture.scenarios) {
    const candidates = scenario.candidates.map((candidate) =>
      fact(scenario.field, candidate.source, candidate.value));
    for (const ordered of [candidates, [...candidates].reverse()]) {
      const resolved = resolveConfigurationField(
        scenario.field,
        ordered as readonly ConfigurationFact<typeof scenario.field>[],
      );
      assert.equal(resolved?.value, scenario.expectedValue, scenario.field);
      const expectedSources = configurationSources.filter((source) =>
        source === 'built_in' || scenario.candidates.some((candidate) => candidate.source === source));
      assert.deepEqual(resolved?.sources, expectedSources, `${scenario.field} source order`);
    }
  }
});

test('accepts exact numeric boundaries for every execution ceiling', () => {
  const boundaries = [
    ['execution.max_turns', 1, 32],
    ['execution.max_capability_calls', 0, 64],
    ['execution.max_reported_input_tokens', 0, 1_000_000_000_000],
    ['execution.max_reported_output_tokens', 0, 1_000_000_000_000],
    ['execution.timeout_ms', 1, 900_000],
  ] as const;

  for (const [field, minimum, maximum] of boundaries) {
    assert.doesNotThrow(() => resolveConfigurationField(field, [
      fact(field, 'managed', minimum),
    ]));
    assert.doesNotThrow(() => resolveConfigurationField(field, [
      fact(field, 'managed', maximum),
    ]));
  }
});

test('rejects out-of-range and non-integer execution ceilings from trusted host facts', () => {
  const invalidValues = [
    ['execution.max_turns', 0],
    ['execution.max_turns', 33],
    ['execution.max_capability_calls', -1],
    ['execution.max_capability_calls', 65],
    ['execution.max_reported_input_tokens', -1],
    ['execution.max_reported_input_tokens', 1_000_000_000_001],
    ['execution.max_reported_output_tokens', -1],
    ['execution.max_reported_output_tokens', 1_000_000_000_001],
    ['execution.timeout_ms', 0],
    ['execution.timeout_ms', 900_001],
    ['execution.max_turns', 1.5],
    ['execution.timeout_ms', Number.POSITIVE_INFINITY],
  ] as const;

  for (const [field, value] of invalidValues) {
    assert.throws(
      () => resolveConfigurationField(field, [fact(field, 'managed', value)]),
      (error: unknown) => error instanceof ConfigurationResolutionError
        && error.issue.code === 'config_value_invalid'
        && error.issue.field === field
        && error.issue.source === 'managed'
        && error.issue.location === 'fixture-managed-host',
      `${field} must reject ${String(value)}`,
    );
  }
});

test('policy ceilings cannot be relaxed by any more-preferred source', () => {
  const profiles = ['developer', 'review', 'locked'] as const;
  const configurableSources = configurationSources.filter((source) => source !== 'built_in');
  for (const lowerPriority of configurableSources) {
    for (const higherPriority of configurableSources) {
      if (configurationSources.indexOf(higherPriority) >= configurationSources.indexOf(lowerPriority)) continue;
      for (const strict of profiles) {
        const relaxed = profiles[Math.max(0, profiles.indexOf(strict) - 1)];
        assert.ok(relaxed !== undefined);
        const resolved = resolveConfigurationField('approval.profile', [
          fact('approval.profile', lowerPriority, strict),
          fact('approval.profile', higherPriority, relaxed),
        ]);
        assert.equal(resolved?.value, strict);
      }
    }
  }

  const numeric = resolveConfigurationField('execution.max_turns', [
    fact('execution.max_turns', 'managed', 30),
    fact('execution.max_turns', 'command_line', 20),
    fact('execution.max_turns', 'environment', 10),
    fact('execution.max_turns', 'workspace', 2),
    fact('execution.max_turns', 'user', 5),
  ]);
  assert.equal(numeric?.value, 2);
  assert.deepEqual(numeric?.sources, configurationSources);
});

test('rejects every field/source combination outside the frozen eligibility matrix', () => {
  for (const definition of configurationFieldDefinitions) {
    for (const source of configurationSources) {
      if ((definition.eligibleSources as readonly ConfigurationSource[]).includes(source)) continue;
      assert.throws(
        () => resolveConfigurationFacts([
          fact(definition.field, source, valueForField[definition.field]),
        ]),
        (error: unknown) => error instanceof ConfigurationResolutionError
          && error.issue.code === 'config_source_forbidden'
          && error.issue.field === definition.field
          && error.issue.source === source
          && error.issue.message.length > 0
          && error.issue.hint.length > 0,
        `${definition.field} from ${source}`,
      );
    }
  }
});

test('rejects duplicate facts from one source instead of using input order', () => {
  assert.throws(
    () => resolveConfigurationFacts([
      fact('engine.root', 'user', 'C:/forge/first'),
      fact('engine.root', 'user', 'C:/forge/second'),
    ]),
    (error: unknown) => error instanceof ConfigurationResolutionError
      && error.issue.code === 'config_value_invalid'
      && error.issue.source === 'user',
  );
});

test('adds frozen value defaults but leaves absent and host-derived fields unresolved', () => {
  const resolved = resolveConfigurationFacts([]);
  assert.equal(resolved.schemaVersion, 1);
  assert.equal(resolved.contractVersion, 'forge.effective-configuration.v1');
  assert.deepEqual(Object.keys(resolved.fields), [
    'provider.ollama.base_url',
    'provider.ollama.context_window_tokens',
    'provider.openai.base_url',
    'approval.profile',
    'execution.max_turns',
    'execution.max_capability_calls',
    'execution.max_reported_input_tokens',
    'execution.max_reported_output_tokens',
    'execution.timeout_ms',
  ]);
  assert.equal(resolved.fields['inference.route'], undefined);
  assert.equal(resolved.fields['engine.root'], undefined);
  assert.equal(resolved.fields['credential.openai_api_key'], undefined);
  assert.deepEqual(resolved.fields['provider.ollama.base_url'], {
    field: 'provider.ollama.base_url',
    value: 'http://127.0.0.1:11434/',
    sources: ['built_in'],
  });

  const withHostDefaults = resolveConfigurationFacts([
    fact('engine.root', 'built_in', 'C:/Users/fixture/.forge'),
    fact('credential.openai_api_key', 'built_in', {
      handle: { kind: 'environment_variable', name: 'OPENAI_API_KEY' },
      present: false,
    }),
  ]);
  assert.equal(withHostDefaults.fields['engine.root']?.value, 'C:/Users/fixture/.forge');
  assert.equal(withHostDefaults.fields['credential.openai_api_key']?.value.present, false);
});

test('built-in facts cannot replace frozen defaults or invent a default route', () => {
  assert.throws(
    () => resolveConfigurationFacts([
      fact('execution.max_turns', 'built_in', 30),
    ]),
    (error: unknown) => error instanceof ConfigurationResolutionError
      && error.issue.code === 'config_value_invalid'
      && error.issue.source === 'built_in',
  );
  assert.throws(
    () => resolveConfigurationFacts([
      fact('inference.route', 'built_in', { provider: 'ollama', model: 'invented-default' }),
    ]),
    (error: unknown) => error instanceof ConfigurationResolutionError
      && error.issue.code === 'config_value_invalid'
      && error.issue.field === 'inference.route',
  );
});

test('secret-presence resolution follows precedence without handling secret bytes', () => {
  const absent = fact('credential.openai_api_key', 'built_in', {
    handle: { kind: 'environment_variable', name: 'OPENAI_API_KEY' },
    present: false,
  });
  const present = fact('credential.openai_api_key', 'environment', {
    handle: { kind: 'environment_variable', name: 'OPENAI_API_KEY' },
    present: true,
  });
  const resolved = resolveConfigurationField('credential.openai_api_key', [absent, present]);
  assert.deepEqual(resolved, {
    field: 'credential.openai_api_key',
    value: present.value,
    sources: ['environment'],
  });
  assert.doesNotMatch(JSON.stringify(resolved), /fixture-secret/u);
});
