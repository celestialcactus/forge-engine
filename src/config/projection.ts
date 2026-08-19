import { createHash } from 'node:crypto';
import {
  configurationFieldDefinitions,
  configurationFieldIds,
  configurationSources,
  inferenceEndpointLocalityContract,
  type ConfigurationDigestMaterial,
  type ConfigurationFieldId,
  type ConfigurationFieldValueMap,
  type ConfigurationSource,
  type EffectiveConfigurationDiagnostic,
  type EffectiveField,
  type OpenAiCredentialPresence,
} from './contracts.js';
import { openAiCredentialHandle } from './secrets.js';

type NonSecretConfigurationFieldId = Exclude<ConfigurationFieldId, 'credential.openai_api_key'>;

const canonicalJson = (value: unknown, ancestors: WeakSet<object>): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Configuration digest material must contain only finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new Error('Configuration digest material contains an unsupported value.');
  }
  if (ancestors.has(value)) {
    throw new Error('Configuration digest material must not contain a cycle.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Configuration digest material must contain only plain objects.');
    }
    const record = value as Readonly<Record<string, unknown>>;
    const properties = Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`);
    return `{${properties.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
};

/** Serialize frozen digest material with recursive lexicographic object keys and preserved array order. */
export function canonicalizeConfigurationDigestMaterial(
  material: ConfigurationDigestMaterial,
): string {
  return canonicalJson(material, new WeakSet<object>());
}

/** Hash only the bounded, secret-safe material admitted by the configuration contract. */
export function digestConfigurationMaterial(material: ConfigurationDigestMaterial): string {
  return createHash('sha256')
    .update(Buffer.from(canonicalizeConfigurationDigestMaterial(material), 'utf8'))
    .digest('hex');
}

/** Deduplicate and order provenance from strongest to weakest configuration source. */
export function orderConfigurationSources(
  sources: readonly ConfigurationSource[],
): readonly ConfigurationSource[] {
  if (sources.some((source) => !(configurationSources as readonly string[]).includes(source))) {
    throw new Error('An effective configuration field has an unknown source.');
  }
  const selected = new Set(sources);
  const ordered = configurationSources.filter((source) => selected.has(source));
  if (ordered.length === 0) {
    throw new Error('An effective configuration field must have at least one source.');
  }
  return ordered;
}

export function projectEffectiveField<Field extends NonSecretConfigurationFieldId>(
  field: Field,
  value: ConfigurationFieldValueMap[Field],
  sources: readonly ConfigurationSource[],
): EffectiveField<Field> {
  const orderedSources = orderConfigurationSources(sources);
  const material = {
    schemaVersion: 1,
    field,
    sources: orderedSources,
    present: true,
    value,
  } as ConfigurationDigestMaterial;
  return {
    field,
    value,
    sources: orderedSources,
    digest: digestConfigurationMaterial(material),
  } as EffectiveField<Field>;
}

const isFixedOpenAiHandle = (presence: OpenAiCredentialPresence): boolean =>
  presence.handle.kind === openAiCredentialHandle.kind
  && presence.handle.name === openAiCredentialHandle.name;

/** Project credential presence without admitting secret bytes into digest material or output. */
export function projectOpenAiCredentialField(
  presence: OpenAiCredentialPresence,
  sources: readonly ConfigurationSource[],
): EffectiveField<'credential.openai_api_key'> {
  if (!isFixedOpenAiHandle(presence)) {
    throw new Error('OpenAI credential presence must use the fixed OPENAI_API_KEY handle.');
  }
  const orderedSources = orderConfigurationSources(sources);
  const material: ConfigurationDigestMaterial = {
    schemaVersion: 1,
    field: 'credential.openai_api_key',
    sources: orderedSources,
    present: presence.present,
    secret: openAiCredentialHandle,
  };
  return {
    field: 'credential.openai_api_key',
    value: { handle: openAiCredentialHandle, present: presence.present },
    sources: orderedSources,
    digest: digestConfigurationMaterial(material),
  };
}

const diagnosticFor = (effective: EffectiveField): EffectiveConfigurationDiagnostic => {
  const definition = configurationFieldDefinitions.find(({ field }) => field === effective.field);
  if (definition === undefined) {
    throw new Error('An effective configuration field has an unknown field identifier.');
  }
  if (effective.field === 'credential.openai_api_key') {
    return {
      field: effective.field,
      label: definition.label,
      sources: effective.sources,
      digest: effective.digest,
      present: effective.value.present,
      redacted: true,
    };
  }
  return {
    field: effective.field,
    label: definition.label,
    sources: effective.sources,
    digest: effective.digest,
    present: true,
    redacted: false,
    value: effective.value,
  } as EffectiveConfigurationDiagnostic;
};

/** Project the one schema-v1 selection that is validly absent in a zero-config process. */
export function projectAbsentInferenceRouteDiagnostic(): EffectiveConfigurationDiagnostic {
  const definition = configurationFieldDefinitions.find(({ field }) => field === 'inference.route');
  if (definition === undefined) {
    throw new Error('The inference route configuration contract is unavailable.');
  }
  const material: ConfigurationDigestMaterial = {
    schemaVersion: 1,
    field: 'inference.route',
    sources: ['built_in'],
    present: false,
  };
  return {
    field: 'inference.route',
    label: definition.label,
    sources: material.sources,
    digest: digestConfigurationMaterial(material),
    present: false,
    redacted: false,
  };
}

/**
 * Produce the single redacted diagnostic truth used by human and JSON presenters.
 * A missing inference route is projected through its frozen built-in absence contract;
 * other missing fields remain missing because they are required in an effective product
 * configuration.
 */
export function projectEffectiveConfigurationDiagnostics(
  fields: readonly EffectiveField[],
): readonly EffectiveConfigurationDiagnostic[] {
  const byField = new Map<ConfigurationFieldId, EffectiveField>();
  for (const field of fields) {
    if (!(configurationFieldIds as readonly string[]).includes(field.field)) {
      throw new Error('An effective configuration field has an unknown field identifier.');
    }
    if (byField.has(field.field)) {
      throw new Error('Effective configuration diagnostics cannot contain duplicate fields.');
    }
    byField.set(field.field, field);
  }
  return configurationFieldIds.flatMap((field) => {
    const effective = byField.get(field);
    if (effective !== undefined) return [diagnosticFor(effective)];
    return field === 'inference.route' ? [projectAbsentInferenceRouteDiagnostic()] : [];
  });
}

const normalizedHostname = (baseUrl: string): string => {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    const unbracketed = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
    return unbracketed.endsWith('.') ? unbracketed.slice(0, -1) : unbracketed;
  } catch {
    throw new Error('Cannot classify an invalid provider endpoint.');
  }
};

const isIpv4Loopback = (hostname: string): boolean => {
  const octets = hostname.split('.');
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
    && Number(octets[0]) === 127;
};

const isIpv4MappedIpv6Loopback = (hostname: string): boolean => {
  if (!hostname.startsWith('::ffff:')) return false;
  const suffix = hostname.slice('::ffff:'.length);
  if (isIpv4Loopback(suffix)) return true;
  const words = suffix.split(':');
  if (words.length !== 2 || !words.every((word) => /^[0-9a-f]{1,4}$/u.test(word))) return false;
  return (Number.parseInt(words[0] ?? '', 16) >>> 8) === 127;
};

export interface InferenceEndpointLocalityProjection {
  readonly runtimeLocality: 'local' | 'cloud';
  readonly humanLocality: 'local loopback endpoint' | 'off-device or network endpoint';
}

/** Classify configured endpoint locality lexically, without probing the network. */
export function classifyInferenceEndpointLocality(
  baseUrl: string,
): InferenceEndpointLocalityProjection {
  const hostname = normalizedHostname(baseUrl);
  const local = hostname === 'localhost'
    || hostname === '::1'
    || isIpv4Loopback(hostname)
    || isIpv4MappedIpv6Loopback(hostname);
  return local
    ? { runtimeLocality: 'local', humanLocality: 'local loopback endpoint' }
    : {
        runtimeLocality: inferenceEndpointLocalityContract.nonLoopbackLocality,
        humanLocality: inferenceEndpointLocalityContract.nonLoopbackHumanLabel,
      };
}
