import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { RustKernelRuntime, type ApprovalFactsProvider } from '../../src/hybrid/rust-kernel-runtime.js';
import type { ApprovalFacts, CapabilityCall, RunRequest, TaskPlanner } from '../../src/slice0/contracts.js';
import {
  allowAll,
  denyAll,
  explodingCapability,
  ScriptedPlanner,
  slice0Workspace,
  workspaceInventory,
} from '../../src/slice0/fixtures.js';
import { Slice0Runtime, type Slice0RuntimeOptions } from '../../src/slice0/runtime.js';

const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', 'debug', process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');

const inspectCall = { id: 'call-1', capabilityId: 'workspace.inventory', input: {} };
const baseRequest = (runId: string): RunRequest => ({
  runId,
  task: 'Inspect the workspace.',
  snapshot: slice0Workspace,
  contextBudgetBytes: 200,
  maxTurns: 2,
});

const successfulOptions = (): Slice0RuntimeOptions => ({
  planner: new ScriptedPlanner([
    { kind: 'call', call: inspectCall },
    { kind: 'complete', output: 'Workspace inspected.' },
  ]),
  approvalPolicy: allowAll,
  capabilities: [workspaceInventory],
});

const approvalFactsForDecision = (
  call: CapabilityCall,
  decision: Awaited<ReturnType<Slice0RuntimeOptions['approvalPolicy']['decide']>>,
): ApprovalFacts => decision.facts ?? ({
  schemaVersion: 1,
  callId: call.id,
  capabilityId: call.capabilityId,
  hostPolicy: {
    posture: decision.outcome,
    source: 'fixture.host-policy',
    reason: decision.reason,
  },
  userConsent: {
    status: 'notRequired',
    source: 'fixture.host-ui',
    reason: 'The fixture did not require interactive consent.',
  },
});

const approvalFactsFromPolicy = (policy: Slice0RuntimeOptions['approvalPolicy']): ApprovalFactsProvider => ({
  async collect(call, signal) {
    signal.throwIfAborted();
    const decision = await policy.decide(call);
    return approvalFactsForDecision(call, decision);
  },
});

const toRustOptions = (options: Slice0RuntimeOptions) => {
  const { approvalPolicy, ...integrations } = options;
  return { ...integrations, approvalFacts: approvalFactsFromPolicy(approvalPolicy) };
};

const assertParity = async (
  optionsFactory: () => Slice0RuntimeOptions,
  requestFactory: () => RunRequest,
): Promise<void> => {
  const typescriptEvents: string[] = [];
  const rustEvents: string[] = [];
  const typescriptOptions = optionsFactory();
  const rustOptions = optionsFactory();
  const typescriptArtifact = await new Slice0Runtime({
    ...typescriptOptions,
    approvalPolicy: {
      async decide(call) {
        const decision = await typescriptOptions.approvalPolicy.decide(call);
        return { ...decision, facts: approvalFactsForDecision(call, decision) };
      },
    },
    onEvent: (event) => typescriptEvents.push(event.type),
  }).run(requestFactory());
  const rustArtifact = await new RustKernelRuntime({
    ...toRustOptions(rustOptions),
    kernelPath: kernelBinary,
    requestIdFactory: () => 'bridge:parity',
    onEvent: (event) => rustEvents.push(event.type),
  }).run(requestFactory());

  assert.deepEqual(rustArtifact, typescriptArtifact);
  assert.deepEqual(rustEvents, typescriptEvents);
};

const withTimeout = async <T>(operation: Promise<T>, milliseconds = 2_000): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Hybrid operation exceeded its timeout.')), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

test('Rust kernel binary exists for the explicit hybrid test gate', () => {
  assert.equal(existsSync(kernelBinary), true, 'Build forge-kernel or set FORGE_KERNEL_BINARY before test:hybrid.');
});

test('Rust and TypeScript runtimes produce contract-equivalent Slice 0 artifacts', async (t) => {
  await t.test('successful read-only run', async () => {
    await assertParity(successfulOptions, () => baseRequest('hybrid-success'));
  });

  await t.test('denied capability', async () => {
    await assertParity(() => ({
      ...successfulOptions(),
      approvalPolicy: denyAll,
    }), () => baseRequest('hybrid-denied'));
  });

  await t.test('capability failure', async () => {
    await assertParity(() => ({
      planner: new ScriptedPlanner([
        { kind: 'call', call: { id: 'call-explodes', capabilityId: 'fixture.explodes', input: {} } },
        { kind: 'complete', output: 'Failure was reported.' },
      ]),
      approvalPolicy: allowAll,
      capabilities: [explodingCapability],
    }), () => baseRequest('hybrid-capability-failure'));
  });

  await t.test('budget exhaustion', async () => {
    await assertParity(successfulOptions, () => ({
      ...baseRequest('hybrid-budget'),
      contextBudgetBytes: 1,
    }));
  });

  await t.test('turn exhaustion', async () => {
    await assertParity(() => ({
      planner: new ScriptedPlanner([{ kind: 'call', call: inspectCall }]),
      approvalPolicy: allowAll,
      capabilities: [workspaceInventory],
    }), () => ({
      ...baseRequest('hybrid-turn-limit'),
      maxTurns: 1,
    }));
  });

  await t.test('unknown capability', async () => {
    await assertParity(() => ({
      planner: new ScriptedPlanner([
        { kind: 'call', call: { id: 'call-missing', capabilityId: 'fixture.missing', input: {} } },
        { kind: 'complete', output: 'Unknown capability reported.' },
      ]),
      approvalPolicy: allowAll,
      capabilities: [],
    }), () => baseRequest('hybrid-unknown-capability'));
  });

  await t.test('planner failure', async () => {
    await assertParity(() => ({
      planner: new ScriptedPlanner([]),
      approvalPolicy: allowAll,
      capabilities: [workspaceInventory],
    }), () => baseRequest('hybrid-planner-failure'));
  });

  await t.test('cancellation before work', async () => {
    const requestFactory = (): RunRequest => {
      const controller = new AbortController();
      controller.abort(new Error('Fixture cancelled before start.'));
      return { ...baseRequest('hybrid-pre-cancelled'), signal: controller.signal };
    };
    await assertParity(successfulOptions, requestFactory);
  });
});

test('Rust resolves host and user facts and fails closed at the bridge boundary', async (t) => {
  const baseFacts: ApprovalFacts = {
    schemaVersion: 1,
    callId: inspectCall.id,
    capabilityId: inspectCall.capabilityId,
    hostPolicy: {
      posture: 'ask',
      source: 'fixture.host-policy',
      reason: 'Host requires interactive consent.',
    },
    userConsent: {
      status: 'granted',
      source: 'fixture.host-ui',
      reason: 'Developer granted this exact capability call.',
    },
  };
  const runWithProvider = async (runId: string, approvalFacts: ApprovalFactsProvider) => new RustKernelRuntime({
    ...toRustOptions(successfulOptions()),
    approvalFacts,
    kernelPath: kernelBinary,
  }).run(baseRequest(runId));

  await t.test('granted consent resolves host ask to allow inside Rust', async () => {
    const artifact = await runWithProvider('hybrid-facts-granted', {
      async collect(_call, signal) {
        signal.throwIfAborted();
        return baseFacts;
      },
    });
    const approval = artifact.events.find((event) => event.type === 'approval.decided');
    assert.equal(approval?.type, 'approval.decided');
    if (approval?.type !== 'approval.decided') throw new Error('Expected approval evidence.');
    assert.equal(approval.outcome, 'allow');
    assert.equal(approval.reason, 'Developer granted this exact capability call.');
    assert.deepEqual(approval.facts, baseFacts);
  });

  await t.test('explicit user decline overrides host allow inside Rust', async () => {
    const artifact = await runWithProvider('hybrid-facts-declined', {
      async collect(_call, signal) {
        signal.throwIfAborted();
        return {
          ...baseFacts,
          hostPolicy: { ...baseFacts.hostPolicy, posture: 'allow' },
          userConsent: {
            ...baseFacts.userConsent,
            status: 'declined',
            reason: 'Developer declined this exact capability call.',
          },
        };
      },
    });
    const approval = artifact.events.find((event) => event.type === 'approval.decided');
    assert.equal(approval?.type, 'approval.decided');
    if (approval?.type !== 'approval.decided') throw new Error('Expected approval evidence.');
    assert.equal(approval.outcome, 'deny');
    assert.equal(approval.reason, 'Developer declined this exact capability call.');
    assert.equal(artifact.capabilityResults[0]?.success, false);
  });

  await t.test('malformed facts produce a terminal failed artifact without capability execution', async () => {
    const artifact = await runWithProvider('hybrid-facts-malformed', {
      async collect() {
        return { schemaVersion: 1 } as ApprovalFacts;
      },
    });
    assert.equal(artifact.status, 'failed');
    assert.equal(artifact.capabilityResults.length, 0);
    const terminal = artifact.events.at(-1);
    assert.equal(terminal?.type, 'run.failed');
    if (terminal?.type !== 'run.failed') throw new Error('Expected a failed run.');
    assert.match(terminal.message, /missing field/u);
  });

  await t.test('facts for a different capability call fail closed before execution', async () => {
    const artifact = await runWithProvider('hybrid-facts-mismatched-call', {
      async collect(_call, signal) {
        signal.throwIfAborted();
        return { ...baseFacts, callId: 'call-other' };
      },
    });
    assert.equal(artifact.status, 'failed');
    assert.equal(artifact.capabilityResults.length, 0);
    const terminal = artifact.events.at(-1);
    assert.equal(terminal?.type, 'run.failed');
    if (terminal?.type !== 'run.failed') throw new Error('Expected a failed run.');
    assert.match(terminal.message, /does not match capability call/u);
  });

  await t.test('facts-provider failure remains explicit and terminal', async () => {
    const artifact = await runWithProvider('hybrid-facts-provider-failure', {
      async collect() {
        throw new Error('Host facts provider unavailable.');
      },
    });
    assert.equal(artifact.status, 'failed');
    const terminal = artifact.events.at(-1);
    assert.equal(terminal?.type, 'run.failed');
    if (terminal?.type !== 'run.failed') throw new Error('Expected a failed run.');
    assert.equal(terminal.message, 'Host facts provider unavailable.');
  });
});

test('Rust bridge cancellation interrupts approval-facts collection without hanging', async () => {
  const controller = new AbortController();
  const run = new RustKernelRuntime({
    ...toRustOptions(successfulOptions()),
    approvalFacts: {
      collect() {
        return new Promise<never>(() => {
          // Deliberately non-cooperative: the bridge cancellation race must still terminate the run.
        });
      },
    },
    kernelPath: kernelBinary,
  }).run({ ...baseRequest('hybrid-facts-cancelled'), signal: controller.signal });

  setTimeout(() => controller.abort(new Error('Approval facts collection cancelled.')), 25);
  const artifact = await withTimeout(run);
  assert.equal(artifact.status, 'cancelled');
  const finalEvent = artifact.events.at(-1);
  assert.equal(finalEvent?.type, 'run.cancelled');
  if (finalEvent?.type !== 'run.cancelled') throw new Error('Expected a terminal cancellation event.');
  assert.equal(finalEvent.reason, 'Approval facts collection cancelled.');
});


test('Rust bridge cancellation interrupts an in-flight TypeScript integration callback without hanging', async () => {
  const blockingPlanner: TaskPlanner = {
    id: 'blocking-planner',
    async next(_request, signal) {
      await new Promise<void>((resolveAbort) => signal.addEventListener('abort', () => resolveAbort(), { once: true }));
      signal.throwIfAborted();
      throw new Error('Blocking planner resumed without cancellation.');
    },
  };
  const controller = new AbortController();
  const run = new RustKernelRuntime({
    ...toRustOptions(successfulOptions()),
    planner: blockingPlanner,
    kernelPath: kernelBinary,
  }).run({ ...baseRequest('hybrid-mid-cancelled'), signal: controller.signal });

  setTimeout(() => controller.abort(new Error('Hybrid cancellation requested.')), 25);
  const artifact = await withTimeout(run);
  assert.equal(artifact.status, 'cancelled');
  const finalEvent = artifact.events.at(-1);
  assert.equal(finalEvent?.type, 'run.cancelled');
  if (finalEvent?.type !== 'run.cancelled') throw new Error('Expected a terminal cancellation event.');
  assert.equal(finalEvent.reason, 'Hybrid cancellation requested.');
});

test('Rust bridge rejects missing and malformed kernels promptly', async (t) => {
  await t.test('missing binary', async () => {
    const runtime = new RustKernelRuntime({
      ...toRustOptions(successfulOptions()),
      kernelPath: join(tmpdir(), 'forge-kernel-does-not-exist'),
    });
    await assert.rejects(
      withTimeout(runtime.run(baseRequest('hybrid-missing-binary'))),
      /failed to start/u,
    );
  });

  await t.test('malformed protocol output', async () => {
    const runtime = new RustKernelRuntime({
      ...toRustOptions(successfulOptions()),
      kernelPath: process.execPath,
      kernelArguments: ['-e', "process.stdin.resume(); console.log('not-json');"],
    });
    await assert.rejects(
      withTimeout(runtime.run(baseRequest('hybrid-malformed-output'))),
      /invalid NDJSON/u,
    );
  });
});