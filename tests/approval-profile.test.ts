import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createProductApprovalFactsProvider,
  parseProductApprovalProfile,
} from '../src/approval-profile.js';
import type { CapabilityCall, CapabilityContext } from '../src/slice0/contracts.js';

const call: CapabilityCall = {
  id: 'call:approval-profile',
  capabilityId: 'workspace.read',
  input: { path: 'README.md' },
};

const context: CapabilityContext = {
  schemaVersion: 1,
  task: 'Read the workspace evidence.',
  basis: {
    schemaVersion: 1,
    runId: 'run:approval-profile',
    snapshotId: 'workspace:approval-profile',
    contextPlanId: 'context:approval-profile',
    priorCallIds: [],
    priorObservationsSha256: '0'.repeat(64),
  },
  priorObservations: [],
};

const collect = (
  configuration: Parameters<typeof createProductApprovalFactsProvider>[0],
  signal = new AbortController().signal,
) => createProductApprovalFactsProvider(configuration).collect(call, signal, context);

test('parses only the three explicit product approval profiles', () => {
  assert.equal(parseProductApprovalProfile(undefined), 'developer');
  assert.equal(parseProductApprovalProfile(' REVIEW '), 'review');
  assert.equal(parseProductApprovalProfile('locked'), 'locked');
  assert.throws(() => parseProductApprovalProfile('yolo'), /developer, review, or locked/u);
});

test('projects developer, unresolved review, and locked profiles into attributable facts', async () => {
  const developer = await collect({ profile: 'developer' });
  assert.equal(developer.hostPolicy.posture, 'allow');
  assert.equal(developer.userConsent.status, 'notRequired');
  assert.equal(developer.hostPolicy.source, 'forge.product.approval-profile.developer');

  const review = await collect({ profile: 'review' });
  assert.equal(review.hostPolicy.posture, 'ask');
  assert.equal(review.userConsent.status, 'unavailable');
  assert.match(review.userConsent.reason, /did not provide a consent callback/u);

  const locked = await collect({ profile: 'locked' });
  assert.equal(locked.hostPolicy.posture, 'deny');
  assert.equal(locked.userConsent.status, 'notRequired');
  assert.equal(locked.hostPolicy.source, 'forge.product.approval-profile.locked');
});

test('binds review callback consent to the exact capability context', async () => {
  let observed: unknown;
  const granted = await collect({
    profile: 'review',
    async requestConsent(request, signal) {
      signal.throwIfAborted();
      observed = request;
      return {
        status: 'granted',
        source: 'fixture.host.prompt',
        reason: 'Developer granted this exact read.',
      };
    },
  });
  assert.deepEqual(observed, { schemaVersion: 1, profile: 'review', call, context });
  assert.equal(granted.hostPolicy.posture, 'ask');
  assert.equal(granted.userConsent.status, 'granted');
  assert.equal(granted.userConsent.source, 'fixture.host.prompt');

  const declined = await collect({
    profile: 'review',
    async requestConsent() {
      return {
        status: 'declined',
        source: 'fixture.host.prompt',
        reason: 'Developer declined this exact read.',
      };
    },
  });
  assert.equal(declined.userConsent.status, 'declined');
  assert.equal(declined.userConsent.reason, 'Developer declined this exact read.');
});

test('fails closed on malformed or unattributed callback results', async () => {
  await assert.rejects(
    collect({
      profile: 'review',
      async requestConsent() {
        return { status: 'granted', source: ' ', reason: 'Missing source.' };
      },
    }),
    /source must not be empty/u,
  );
  await assert.rejects(
    collect({
      profile: 'review',
      async requestConsent() {
        return { status: 'maybe', source: 'fixture.host', reason: 'Invalid state.' } as never;
      },
    }),
    /status must be granted or declined/u,
  );
  await assert.rejects(
    collect({
      profile: 'review',
      async requestConsent() {
        return null as never;
      },
    }),
    /must return an object/u,
  );
});

test('cancellation and timeout settle a non-cooperative host callback', async () => {
  const controller = new AbortController();
  let started = (): void => {};
  const callbackStarted = new Promise<void>((resolveStarted) => { started = resolveStarted; });
  const pending = collect({
    profile: 'review',
    requestConsent() {
      started();
      return new Promise<never>(() => {
        // The product adapter must stop waiting even if the embedded host does not cooperate.
      });
    },
  }, controller.signal);
  await callbackStarted;
  controller.abort(new Error('Fixture host approval cancelled.'));
  await assert.rejects(pending, /Fixture host approval cancelled/u);

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(new Error('Fixture approval timed out.')), 20);
  try {
    await assert.rejects(
      collect({
        profile: 'review',
        requestConsent() {
          return new Promise<never>(() => {
            // Deliberately non-cooperative timeout fixture.
          });
        },
      }, timeoutController.signal),
      /timed out/u,
    );
  } finally {
    clearTimeout(timer);
  }
});
