import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapabilityCall } from '../src/slice0/contracts.js';
import type { InteractiveChangePlan } from '../src/change-workflow.js';
import {
  executeInteractiveChangePlan,
  type InteractiveChangeExecutionOptions,
  type InteractiveChangeIo,
} from '../src/interactive-change.js';
import type {
  SovereignCoordinatorArtifact,
  SovereignPreparedArtifact,
  SovereignProposalArtifact,
} from '../src/hybrid/rust-sovereign-change-runtime.js';

const beforeSha256 = '1'.repeat(64);
const afterSha256 = '2'.repeat(64);
const plan: InteractiveChangePlan = {
  planningRunId: 'run:plan',
  proposalId: 'change:plan',
  snapshotId: 'workspace:plan',
  changes: [{
    path: 'src/value.ts',
    expectedSha256: beforeSha256,
    replacementText: 'export const value = 2;\n',
    beforeSha256,
    afterSha256,
    beforeBytes: 24,
    afterBytes: 24,
    diff: '-export const value = 1;\n+export const value = 2;\n',
  }],
  sovereignProposal: {
    schemaVersion: 1,
    operations: [{
      kind: 'replace',
      path: 'src/value.ts',
      after: { encoding: 'utf8', value: 'export const value = 2;\n' },
    }],
  },
};

const prepared: SovereignPreparedArtifact = {
  schemaVersion: 2,
  changeSetId: 'changeset:sha256:prepared',
  snapshotId: 'snapshot:prepared',
  operations: [{
    kind: 'replace',
    path: 'src/value.ts',
    beforeSha256,
    beforeMode: 'regular',
    after: { sha256: afterSha256, bytes: 24, contentKind: 'utf8_text' },
    afterMode: 'regular',
  }],
};

const facts = (call: CapabilityCall) => ({
  schemaVersion: 1 as const,
  callId: call.id,
  capabilityId: call.capabilityId,
  hostPolicy: { posture: 'ask' as const, source: 'test', reason: 'test' },
  userConsent: { status: 'granted' as const, source: 'test', reason: 'test' },
});

const transaction = (state: SovereignCoordinatorArtifact['state']): SovereignCoordinatorArtifact => ({
  schemaVersion: 1,
  transactionId: 'transaction:test',
  changeSetId: prepared.changeSetId,
  baseRevision: 'base',
  state,
  operationCount: 1,
  candidatePath: 'candidate',
  candidateRetained: state === 'prepared',
  verification: [],
  transitions: [],
  recoveryPerformed: false,
});

const proposal = (status: SovereignProposalArtifact['status']): SovereignProposalArtifact => {
  const call: CapabilityCall = {
    id: 'approved',
    capabilityId: 'workspace.change.propose',
    input: { changeSetId: prepared.changeSetId, selectedCheckIds: ['typecheck'] },
  };
  const verified = status === 'verified_candidate';
  return {
    schemaVersion: 2,
    status,
    changeSet: prepared as unknown as Record<string, unknown>,
    verification: [{ checkId: 'typecheck', success: verified, exitCode: verified ? 0 : 1 }],
    approvedCall: call,
    approval: { outcome: 'allow', reason: 'test', facts: facts(call) },
    outcomeContract: {
      schemaVersion: 1,
      requirements: [{ id: 'identity', kind: 'output_equals', expected: prepared.changeSetId }],
    },
    outcome: {
      schemaVersion: 1,
      status: verified ? 'verified' : 'unmet',
      reason: 'test',
      checks: [],
    },
    ...(verified ? { transaction: transaction('prepared') } : { failure: 'verification failed' }),
  };
};

class FixtureIo implements InteractiveChangeIo {
  readonly output: string[] = [];
  constructor(private readonly answers: Array<string | undefined>) {}
  async question(): Promise<string | undefined> { return this.answers.shift(); }
  write(line: string): void { this.output.push(line); }
}

const runtimeFixture = (
  candidate: SovereignProposalArtifact,
  acceptedState: SovereignCoordinatorArtifact['state'] = 'promoted',
  discardedState: SovereignCoordinatorArtifact['state'] = 'discarded',
) => {
  const calls: Array<{ readonly kind: string; readonly call?: CapabilityCall }> = [];
  const runtime: InteractiveChangeExecutionOptions['runtime'] = {
    async prepare() {
      calls.push({ kind: 'prepare' });
      return prepared;
    },
    async propose(_proposal, expectedChangeSetId, checkIds, call, approvalFacts) {
      calls.push({ kind: 'propose', call });
      assert.equal(expectedChangeSetId, prepared.changeSetId);
      assert.deepEqual(checkIds, ['typecheck']);
      assert.deepEqual(call.input, { changeSetId: prepared.changeSetId, selectedCheckIds: ['typecheck'] });
      assert.equal(approvalFacts.userConsent.status, 'granted');
      return candidate;
    },
    async accept(_transactionId, call) {
      calls.push({ kind: 'accept', call });
      return transaction(acceptedState);
    },
    async discard(_transactionId, call) {
      calls.push({ kind: 'discard', call });
      return transaction(discardedState);
    },
  };
  return { runtime, calls };
};

test('developer decline stops after review without requesting candidate mutation', async () => {
  const fixture = runtimeFixture(proposal('verified_candidate'));
  const io = new FixtureIo(['no']);
  const result = await executeInteractiveChangePlan({
    plan,
    checkIds: ['typecheck'],
    runtime: fixture.runtime,
    io,
    callIdFactory: () => 'call:decline',
  });
  assert.equal(result.status, 'declined');
  assert.deepEqual(fixture.calls.map((call) => call.kind), ['prepare']);
  assert.ok(io.output.some((line) => line.includes('no candidate or workspace mutation')));
});

test('approved verified candidate requires a second explicit promotion decision', async () => {
  const fixture = runtimeFixture(proposal('verified_candidate'));
  const io = new FixtureIo(['yes', 'accept']);
  let nextId = 0;
  const result = await executeInteractiveChangePlan({
    plan,
    checkIds: ['typecheck'],
    runtime: fixture.runtime,
    io,
    callIdFactory: () => `call:${++nextId}`,
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.transaction?.state, 'promoted');
  assert.deepEqual(fixture.calls.map((call) => call.kind), ['prepare', 'propose', 'accept']);
  assert.equal(fixture.calls[2]?.call?.capabilityId, 'workspace.change.accept');
});

test('failed verification cannot reach promotion and explicit discard uses the durable transaction', async () => {
  const failedFixture = runtimeFixture(proposal('verification_failed'));
  const failed = await executeInteractiveChangePlan({
    plan,
    checkIds: ['typecheck'],
    runtime: failedFixture.runtime,
    io: new FixtureIo(['yes']),
  });
  assert.equal(failed.status, 'verification_failed');
  assert.deepEqual(failedFixture.calls.map((call) => call.kind), ['prepare', 'propose']);

  const discardFixture = runtimeFixture(proposal('verified_candidate'));
  const discarded = await executeInteractiveChangePlan({
    plan,
    checkIds: ['typecheck'],
    runtime: discardFixture.runtime,
    io: new FixtureIo(['yes', 'discard']),
  });
  assert.equal(discarded.status, 'discarded');
  assert.equal(discarded.transaction?.state, 'discarded');
  assert.equal(discardFixture.calls[2]?.call?.capabilityId, 'workspace.change.discard');
});

test('does not label accept or discard successful without the matching Rust terminal state', async () => {
  await assert.rejects(
    executeInteractiveChangePlan({
      plan,
      checkIds: ['typecheck'],
      runtime: runtimeFixture(proposal('verified_candidate'), 'repair_required').runtime,
      io: new FixtureIo(['yes', 'accept']),
    }),
    /did not confirm promotion/u,
  );
  await assert.rejects(
    executeInteractiveChangePlan({
      plan,
      checkIds: ['typecheck'],
      runtime: runtimeFixture(proposal('verified_candidate'), 'promoted', 'repair_required').runtime,
      io: new FixtureIo(['yes', 'discard']),
    }),
    /did not confirm discard/u,
  );
});