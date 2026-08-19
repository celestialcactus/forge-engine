import {
  configurationContractVersion,
  configurationFieldDefinitions,
  configurationNormalizationRules,
  configurationSources,
  type ConfigurationFact,
  type ConfigurationFieldDefinition,
  type ConfigurationFieldId,
  type ConfigurationFieldValueMap,
  type ConfigurationIssue,
  type ConfigurationSource,
} from './contracts.js';

export type ResolvedConfigurationField<
  Field extends ConfigurationFieldId = ConfigurationFieldId,
> = {
  readonly field: Field;
  readonly value: ConfigurationFieldValueMap[Field];
  readonly sources: readonly ConfigurationSource[];
};

export type ResolvedConfigurationFields = {
  readonly [Field in ConfigurationFieldId]?: ResolvedConfigurationField<Field>;
};

/** The normalized, policy-combined facts consumed by the redacted projection layer. */
export interface ResolvedProductConfigurationFacts {
  readonly schemaVersion: 1;
  readonly contractVersion: typeof configurationContractVersion;
  readonly fields: ResolvedConfigurationFields;
}

export class ConfigurationResolutionError extends Error {
  readonly issue: ConfigurationIssue;

  constructor(issue: ConfigurationIssue) {
    super(issue.message);
    this.name = 'ConfigurationResolutionError';
    this.issue = issue;
  }
}

const sourceRank = new Map<ConfigurationSource, number>(
  configurationSources.map((source, index) => [source, index]),
);

const definitionsByField = new Map<ConfigurationFieldId, ConfigurationFieldDefinition>(
  configurationFieldDefinitions.map((definition) => [definition.field, definition]),
);

const evidenceLocation = (fact: ConfigurationFact): string => {
  switch (fact.source) {
    case 'managed':
      return fact.evidence.authority;
    case 'command_line':
      return fact.evidence.options.join(' ') || '<command line>';
    case 'environment':
      return fact.evidence.variables.join(', ') || '<environment>';
    case 'workspace':
    case 'user':
      return `${fact.evidence.path}#${fact.evidence.configPath}`;
    case 'built_in':
      return fact.evidence.name;
  }
};

const throwIssue = (issue: ConfigurationIssue): never => {
  const bounded = (value: string, maximumLength = 512): string => {
    const escaped = value.replace(
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    return escaped.length <= maximumLength
      ? escaped
      : `${escaped.slice(0, maximumLength - 1)}…`;
  };
  throw new ConfigurationResolutionError({
    ...issue,
    location: bounded(issue.location),
    message: bounded(issue.message),
    hint: bounded(issue.hint),
  });
};

type NumericCeilingField =
  | 'execution.max_turns'
  | 'execution.max_capability_calls'
  | 'execution.max_reported_input_tokens'
  | 'execution.max_reported_output_tokens'
  | 'execution.timeout_ms';

const numericCeilingBounds = {
  'execution.max_turns': configurationNormalizationRules.max_turns_v1,
  'execution.max_capability_calls': configurationNormalizationRules.max_capability_calls_v1,
  'execution.max_reported_input_tokens': configurationNormalizationRules.max_reported_tokens_v1,
  'execution.max_reported_output_tokens': configurationNormalizationRules.max_reported_tokens_v1,
  'execution.timeout_ms': configurationNormalizationRules.timeout_ms_v1,
} as const satisfies Readonly<Record<NumericCeilingField, {
  readonly minimum: number;
  readonly maximum: number;
}>>;

const isNumericCeilingField = (field: ConfigurationFieldId): field is NumericCeilingField =>
  field in numericCeilingBounds;

const assertAtomicRoute = (fact: ConfigurationFact<'inference.route'>): void => {
  const value: unknown = fact.value;
  if (typeof value !== 'object' || value === null) {
    throwIssue({
      code: 'config_route_incomplete',
      source: fact.source,
      field: fact.field,
      location: evidenceLocation(fact),
      message: 'Inference settings must include both a provider and a model.',
      hint: 'Set provider and model together in one source, or remove that route setting.',
    });
  }
  const route = value as Readonly<Record<string, unknown>>;
  const providerIsValid = route.provider === 'ollama' || route.provider === 'openai';
  const modelIsValid = typeof route.model === 'string'
    && route.model.length > 0
    && route.model.length <= 200
    && route.model === route.model.trim();
  if (!providerIsValid || !modelIsValid) {
    throwIssue({
      code: 'config_route_incomplete',
      source: fact.source,
      field: fact.field,
      location: evidenceLocation(fact),
      message: 'Inference settings must include one valid provider and one non-empty model.',
      hint: 'Set provider to "ollama" or "openai" and set model in the same configuration source.',
    });
  }
};

const assertCeilingValue = (fact: ConfigurationFact): void => {
  if (fact.field === 'approval.profile') {
    if (fact.value === 'developer' || fact.value === 'review' || fact.value === 'locked') return;
  } else if (isNumericCeilingField(fact.field) && typeof fact.value === 'number') {
    const bounds = numericCeilingBounds[fact.field];
    if (Number.isSafeInteger(fact.value)
      && fact.value >= bounds.minimum
      && fact.value <= bounds.maximum) {
      return;
    }
  }
  throwIssue({
    code: 'config_value_invalid',
    source: fact.source,
    field: fact.field,
    location: evidenceLocation(fact),
    message: `Forge received an invalid normalized value for "${fact.field}".`,
    hint: 'Correct this setting at its reported source, then run the command again.',
  });
};

const assertBuiltInValue = (
  fact: ConfigurationFact<ConfigurationFieldId, 'built_in'>,
  definition: ConfigurationFieldDefinition,
): void => {
  if (definition.builtIn.kind === 'host_derived') return;
  if (definition.builtIn.kind === 'value' && Object.is(fact.value, definition.builtIn.value)) return;
  if (fact.field === 'credential.openai_api_key'
    && fact.value.handle.kind === 'environment_variable'
    && fact.value.handle.name === 'OPENAI_API_KEY'
    && fact.value.present === false) {
    return;
  }
  throwIssue({
    code: 'config_value_invalid',
    source: fact.source,
    field: fact.field,
    location: evidenceLocation(fact),
    message: `Forge received an invalid built-in value for "${fact.field}".`,
    hint: 'Use the frozen product default, or supply an eligible explicit configuration source.',
  });
};

const assertEligibleFact = (fact: ConfigurationFact): ConfigurationFieldDefinition => {
  const definition = definitionsByField.get(fact.field);
  if (definition === undefined) {
    throw new TypeError(`Unknown effective-configuration field: ${String(fact.field)}`);
  }
  if (!(configurationSources as readonly string[]).includes(fact.source)) {
    throw new TypeError(`Unknown effective-configuration source: ${String(fact.source)}`);
  }
  if (!(definition.eligibleSources as readonly ConfigurationSource[]).includes(fact.source)) {
    throwIssue({
      code: 'config_source_forbidden',
      source: fact.source,
      field: fact.field,
      location: evidenceLocation(fact),
      message: `${definition.label} cannot be set from ${fact.source.replaceAll('_', ' ')} configuration.`,
      hint: `Use an eligible source: ${definition.eligibleSources.join(', ')}.`,
    });
  }
  if (fact.field === 'inference.route') {
    assertAtomicRoute(fact as ConfigurationFact<'inference.route'>);
  }
  if (fact.source === 'built_in') {
    assertBuiltInValue(
      fact as ConfigurationFact<ConfigurationFieldId, 'built_in'>,
      definition,
    );
  }
  if (definition.resolution === 'ceiling') assertCeilingValue(fact);
  return definition;
};

const builtInFact = <Field extends ConfigurationFieldId>(
  field: Field,
  definition: ConfigurationFieldDefinition,
): ConfigurationFact<Field, 'built_in'> | undefined => {
  if (definition.builtIn.kind !== 'value') return undefined;
  return {
    field,
    source: 'built_in',
    value: definition.builtIn.value as ConfigurationFieldValueMap[Field],
    evidence: { name: 'forge.configuration.defaults.v1' },
  } as unknown as ConfigurationFact<Field, 'built_in'>;
};

const sortedFacts = <Field extends ConfigurationFieldId>(
  facts: readonly ConfigurationFact<Field>[],
): readonly ConfigurationFact<Field>[] => [...facts].sort((left, right) =>
  (sourceRank.get(left.source) ?? Number.MAX_SAFE_INTEGER)
  - (sourceRank.get(right.source) ?? Number.MAX_SAFE_INTEGER));

const strictestApproval = (
  facts: readonly ConfigurationFact<'approval.profile'>[],
): ConfigurationFieldValueMap['approval.profile'] => {
  const rank = { developer: 0, review: 1, locked: 2 } as const;
  let selected: ConfigurationFieldValueMap['approval.profile'] = 'developer';
  for (const fact of facts) {
    if (rank[fact.value] > rank[selected]) selected = fact.value;
  }
  return selected;
};

/**
 * Resolves one typed field. Selection and secret-presence facts use exact source
 * precedence; approval and execution ceilings combine monotonically.
 */
export function resolveConfigurationField<Field extends ConfigurationFieldId>(
  field: Field,
  inputFacts: readonly ConfigurationFact<Field>[],
): ResolvedConfigurationField<Field> | undefined {
  const definition = definitionsByField.get(field);
  if (definition === undefined) throw new TypeError(`Unknown effective-configuration field: ${field}`);

  const facts: ConfigurationFact<Field>[] = [];
  const seenSources = new Set<ConfigurationSource>();
  for (const fact of inputFacts) {
    if (fact.field !== field) {
      throw new TypeError(`Expected configuration field "${field}" but received "${fact.field}".`);
    }
    assertEligibleFact(fact);
    if (seenSources.has(fact.source)) {
      throwIssue({
        code: 'config_value_invalid',
        source: fact.source,
        field,
        location: evidenceLocation(fact),
        message: `Forge received more than one ${definition.label.toLowerCase()} value from the same source.`,
        hint: 'Keep exactly one value for this setting in each configuration source.',
      });
    }
    seenSources.add(fact.source);
    facts.push(fact);
  }

  if (!seenSources.has('built_in')) {
    const fallback = builtInFact(field, definition);
    if (fallback !== undefined) facts.push(fallback);
  }
  if (facts.length === 0) return undefined;

  const ordered = sortedFacts(facts);
  if (definition.resolution === 'selection' || definition.resolution === 'secret_presence') {
    const selected = ordered[0];
    if (selected === undefined) return undefined;
    return {
      field,
      value: selected.value,
      sources: [selected.source],
    } as unknown as ResolvedConfigurationField<Field>;
  }

  const value = field === 'approval.profile'
    ? strictestApproval(ordered as readonly ConfigurationFact<'approval.profile'>[])
    : Math.min(...ordered.map((fact) => fact.value as number));
  return {
    field,
    value,
    sources: ordered.map(({ source }) => source),
  } as unknown as ResolvedConfigurationField<Field>;
}

/** Resolve every field in stable contract order, adding frozen value defaults. */
export function resolveConfigurationFacts(
  facts: readonly ConfigurationFact[],
): ResolvedProductConfigurationFacts {
  const factsByField = new Map<ConfigurationFieldId, ConfigurationFact[]>();
  for (const fact of facts) {
    assertEligibleFact(fact);
    const current = factsByField.get(fact.field);
    if (current === undefined) factsByField.set(fact.field, [fact]);
    else current.push(fact);
  }

  const fields: Partial<Record<ConfigurationFieldId, ResolvedConfigurationField>> = {};
  for (const definition of configurationFieldDefinitions) {
    const resolved = resolveConfigurationField(
      definition.field,
      (factsByField.get(definition.field) ?? []) as readonly ConfigurationFact<typeof definition.field>[],
    );
    if (resolved !== undefined) fields[definition.field] = resolved;
  }
  return {
    schemaVersion: 1,
    contractVersion: configurationContractVersion,
    fields: fields as ResolvedConfigurationFields,
  };
}
