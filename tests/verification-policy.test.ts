import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseTrustedVerificationPolicy,
  selectVerificationCheckIds,
} from '../src/verification-policy.js';

const policy = {
  schemaVersion: 1,
  checks: [{
    checkId: 'typecheck',
    executable: 'node',
    arguments: ['node_modules/typescript/bin/tsc', '--noEmit'],
    timeoutMs: 120_000,
    maxOutputBytes: 65_536,
  }],
};

test('normalizes a bounded trusted verification policy and explicit selection', () => {
  const checks = parseTrustedVerificationPolicy(policy);
  assert.deepEqual(checks, [{
    ...policy.checks[0],
    environment: [],
    inheritEnvironment: [],
  }]);
  assert.deepEqual(selectVerificationCheckIds(checks), ['typecheck']);
  assert.deepEqual(selectVerificationCheckIds(checks, 'typecheck'), ['typecheck']);
});

test('rejects unsupported isolation claims and invalid selections before approval', () => {
  assert.throws(() => parseTrustedVerificationPolicy({
    ...policy,
    checks: [{ ...policy.checks[0], isolationPolicy: { profile: 'restricted' } }],
  }), /trusted-only/u);
  const checks = parseTrustedVerificationPolicy(policy);
  assert.throws(() => selectVerificationCheckIds(checks, 'missing'), /Unknown verification check/u);
  assert.throws(() => selectVerificationCheckIds(checks, 'typecheck,typecheck'), /unique check IDs/u);
});
