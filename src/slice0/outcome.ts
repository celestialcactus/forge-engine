import type {
  OutcomeAssessment,
  OutcomeContract,
  OutcomeRequirement,
} from './contracts.js';

export interface OutcomeCapabilityAttempt {
  readonly capabilityId: string;
  readonly success: boolean;
}

const isUnicodeWhitespace = (character: string): boolean => {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && (
    (codePoint >= 0x0009 && codePoint <= 0x000d)
    || codePoint === 0x0020
    || codePoint === 0x0085
    || codePoint === 0x00a0
    || codePoint === 0x1680
    || (codePoint >= 0x2000 && codePoint <= 0x200a)
    || codePoint === 0x2028
    || codePoint === 0x2029
    || codePoint === 0x202f
    || codePoint === 0x205f
    || codePoint === 0x3000
  );
};

const isBlank = (value: string): boolean =>
  value.length === 0 || Array.from(value).every(isUnicodeWhitespace);

export const notEvaluatedOutcome = (reason: string): OutcomeAssessment => ({
  schemaVersion: 1,
  status: 'not_evaluated',
  reason,
  checks: [],
});

export const outcomeContractError = (contract: OutcomeContract): string | undefined => {
  if (contract.schemaVersion !== 1) return 'Outcome contract schemaVersion must be 1.';
  if (contract.requirements.length < 1 || contract.requirements.length > 32) {
    return 'Outcome contract must contain between 1 and 32 requirements.';
  }
  const ids = new Set<string>();
  for (const requirement of contract.requirements) {
    if (isBlank(requirement.id) || Array.from(requirement.id).length > 100) {
      return 'Outcome requirement id has an invalid length.';
    }
    if (ids.has(requirement.id)) return 'Outcome requirement id is duplicated: ' + requirement.id + '.';
    ids.add(requirement.id);
    if (requirement.kind === 'output_equals' && Array.from(requirement.expected).length > 65_536) {
      return 'Outcome expected output exceeds 65536 characters.';
    }
    if (requirement.kind === 'capability_succeeded') {
      if (isBlank(requirement.capabilityId) || Array.from(requirement.capabilityId).length > 200) {
        return 'Outcome capabilityId has an invalid length.';
      }
      if (!Number.isSafeInteger(requirement.minimumInvocations)
        || requirement.minimumInvocations < 1
        || requirement.minimumInvocations > 64
      ) return 'Outcome minimumInvocations must be between 1 and 64.';
    }
  }
  return undefined;
};

const assessRequirement = (
  requirement: OutcomeRequirement,
  output: string,
  attempts: readonly OutcomeCapabilityAttempt[],
): OutcomeAssessment['checks'][number] => {
  if (requirement.kind === 'output_non_empty') {
    const characters = Array.from(output).length;
    const satisfied = !isBlank(output);
    return {
      id: requirement.id,
      kind: requirement.kind,
      satisfied,
      explanation: 'Observed outcome value contained ' + characters + ' characters and '
        + (satisfied ? 'included' : 'did not include') + ' non-whitespace content.',
    };
  }
  if (requirement.kind === 'output_equals') {
    const satisfied = output === requirement.expected;
    return {
      id: requirement.id,
      kind: requirement.kind,
      satisfied,
      explanation: satisfied
        ? 'Observed outcome value matched the caller-authored expected value.'
        : 'Observed outcome value did not match the caller-authored expected value.',
    };
  }
  const successful = attempts.filter((attempt) =>
    attempt.capabilityId === requirement.capabilityId && attempt.success).length;
  return {
    id: requirement.id,
    kind: requirement.kind,
    satisfied: successful >= requirement.minimumInvocations,
    explanation: 'Observed ' + successful + ' successful ' + requirement.capabilityId
      + ' invocation(s); required at least ' + requirement.minimumInvocations + '.',
  };
};

export const assessOutcome = (
  contract: OutcomeContract | undefined,
  output: string,
  attempts: readonly OutcomeCapabilityAttempt[],
): OutcomeAssessment => {
  if (contract === undefined) {
    return notEvaluatedOutcome(
      'No caller-authored outcome contract was supplied; completed denotes only a valid terminal planner turn.',
    );
  }
  const checks = contract.requirements.map((requirement) =>
    assessRequirement(requirement, output, attempts));
  const verified = checks.every((check) => check.satisfied);
  return {
    schemaVersion: 1,
    status: verified ? 'verified' : 'unmet',
    reason: verified
      ? 'All caller-authored outcome requirements were satisfied.'
      : 'One or more caller-authored outcome requirements were not satisfied.',
    checks,
  };
};