import type { TrustedVerificationCheckConfiguration } from './hybrid/verification-configuration.js';

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;

const cleanStringArray = (
  value: unknown,
  label: string,
  maximumEntries: number,
  maximumCharacters: number,
): readonly string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumEntries) {
    throw new Error(`${label} must be an array with at most ${maximumEntries} entries.`);
  }
  return value.map((candidate, index) => {
    if (typeof candidate !== 'string'
      || candidate.length > maximumCharacters
      || candidate.includes('\0')) {
      throw new Error(`${label}[${index}] is invalid.`);
    }
    return candidate;
  });
};

const cleanEnvironment = (
  value: unknown,
  label: string,
): readonly { readonly name: string; readonly value: string }[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error(`${label} must be an array with at most 128 entries.`);
  }
  return value.map((candidate, index) => {
    const entry = asRecord(candidate);
    if (entry === undefined
      || Object.keys(entry).some((key) => key !== 'name' && key !== 'value')
      || typeof entry.name !== 'string'
      || entry.name.length === 0
      || entry.name.length > 256
      || entry.name.includes('=')
      || /[\0-\x1f\x7f]/u.test(entry.name)
      || typeof entry.value !== 'string'
      || entry.value.length > 32_768
      || entry.value.includes('\0')) {
      throw new Error(`${label}[${index}] is invalid.`);
    }
    return { name: entry.name, value: entry.value };
  });
};

export const parseTrustedVerificationPolicy = (
  value: unknown,
): readonly TrustedVerificationCheckConfiguration[] => {
  const policy = asRecord(value);
  if (policy?.schemaVersion !== 1
    || !Array.isArray(policy.checks)
    || policy.checks.length === 0
    || policy.checks.length > 32
    || Object.keys(policy).some((key) => key !== 'schemaVersion' && key !== 'checks')) {
    throw new Error('Verification policy requires schemaVersion 1 and 1 to 32 checks.');
  }
  const seen = new Set<string>();
  return policy.checks.map((candidate, index): TrustedVerificationCheckConfiguration => {
    const check = asRecord(candidate);
    const allowed = new Set([
      'checkId',
      'executable',
      'arguments',
      'environment',
      'inheritEnvironment',
      'timeoutMs',
      'maxOutputBytes',
    ]);
    if (check === undefined || Object.keys(check).some((key) => !allowed.has(key))) {
      throw new Error(`Verification check ${index + 1} contains unsupported fields. This CLI path is trusted-only.`);
    }
    if (typeof check.checkId !== 'string'
      || check.checkId.trim().length === 0
      || check.checkId.length > 160
      || /[\0-\x1f\x7f]/u.test(check.checkId)
      || seen.has(check.checkId)) {
      throw new Error(`Verification check ${index + 1} has an invalid or duplicate checkId.`);
    }
    seen.add(check.checkId);
    if (typeof check.executable !== 'string'
      || check.executable.length === 0
      || check.executable.includes('\0')) {
      throw new Error(`Verification check ${check.checkId} has an invalid executable.`);
    }
    if (!Number.isSafeInteger(check.timeoutMs)
      || Number(check.timeoutMs) < 1
      || Number(check.timeoutMs) > 600_000) {
      throw new Error(`Verification check ${check.checkId} timeoutMs must be from 1 to 600000.`);
    }
    if (!Number.isSafeInteger(check.maxOutputBytes)
      || Number(check.maxOutputBytes) < 1_024
      || Number(check.maxOutputBytes) > 1_048_576) {
      throw new Error(`Verification check ${check.checkId} maxOutputBytes must be from 1024 to 1048576.`);
    }
    const arguments_ = cleanStringArray(check.arguments, `Verification check ${check.checkId} arguments`, 64, 8_192);
    const environment = cleanEnvironment(check.environment, `Verification check ${check.checkId} environment`);
    const inheritEnvironment = cleanStringArray(
      check.inheritEnvironment,
      `Verification check ${check.checkId} inheritEnvironment`,
      128,
      256,
    );
    if (environment.length + inheritEnvironment.length > 128) {
      throw new Error(`Verification check ${check.checkId} environment contains more than 128 entries.`);
    }
    return {
      checkId: check.checkId,
      executable: check.executable,
      arguments: arguments_,
      environment,
      inheritEnvironment,
      timeoutMs: Number(check.timeoutMs),
      maxOutputBytes: Number(check.maxOutputBytes),
    };
  });
};

export const selectVerificationCheckIds = (
  checks: readonly TrustedVerificationCheckConfiguration[],
  selection?: string,
): readonly string[] => {
  const selected = selection?.split(',').map((value) => value.trim()).filter(Boolean)
    ?? checks.map((check) => check.checkId);
  if (selected.length === 0 || selected.length > 8 || new Set(selected).size !== selected.length) {
    throw new Error('Verification selection must contain 1 to 8 unique check IDs.');
  }
  const available = new Set(checks.map((check) => check.checkId));
  const missing = selected.filter((checkId) => !available.has(checkId));
  if (missing.length > 0) {
    throw new Error(`Unknown verification check ID: ${missing.join(', ')}`);
  }
  return selected;
};
