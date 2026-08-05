import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { RustKernelRuntime } from '../../src/hybrid/rust-kernel-runtime.js';
import { RustRunStoreRuntime } from '../../src/hybrid/rust-run-store-runtime.js';
import type { Capability, PlannerCheckpoint, TaskPlanner } from '../../src/slice0/contracts.js';

const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', 'debug', process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');

const createPendingCapabilityRun = async (
  capabilityId: string,
  replaySafety: 'read_only_retryable' | 'non_idempotent',
): Promise<{
  readonly engineRoot: string;
  readonly runStoreRoot: string;
  readonly runId: string;
}> => {
  const engineRoot = await mkdtemp(join(tmpdir(), 'forge-pending-capability-'));
  const runStoreRoot = join(engineRoot, 'runs', 'v1');
  const runId = `run:pending-${replaySafety}-${process.pid}-${Date.now()}`;
  const requestId = `bridge:pending-${process.pid}-${Date.now()}`;
  const child = spawn(kernelBinary, [], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const exit = new Promise<void>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolveExit());
  });
  const timeout = setTimeout(() => child.kill(), 10_000);
  child.stdin.write(JSON.stringify({
    type: 'run.start',
    protocolVersion: 'forge.kernel.bridge.v9',
    requestId,
    request: {
      runId,
      task: 'reach one pending capability',
      snapshot: { id: 'workspace:pending', rootLabel: 'fixture', files: [] },
      contextBudgetBytes: 65_536,
      maxTurns: 2,
      executionBudget: {
        schemaVersion: 1,
        maxCapabilityCalls: 1,
        maxReportedInputTokens: 100,
        maxReportedOutputTokens: 100,
      },
    },
    capabilities: [{ id: capabilityId, replaySafety }],
    runStoreRoot,
  }) + '\n');
  try {
    for await (const line of lines) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame.type === 'planner.next') {
        child.stdin.write(JSON.stringify({
          type: 'planner.turn',
          protocolVersion: 'forge.kernel.bridge.v9',
          requestId,
          turn: {
            kind: 'call',
            call: { id: 'call:pending', capabilityId, input: { bounded: true } },
          },
          plannerCheckpoint: {
            schemaVersion: 1,
            plannerId: 'fixture:resume',
            state: { completedTurns: 1 },
          },
        }) + '\n');
      } else if (frame.type === 'approval.facts.request') {
        child.stdin.write(JSON.stringify({
          type: 'approval.facts',
          protocolVersion: 'forge.kernel.bridge.v9',
          requestId,
          facts: {
            schemaVersion: 1,
            callId: 'call:pending',
            capabilityId,
            hostPolicy: {
              posture: 'allow',
              source: 'fixture.host-policy',
              reason: 'The fixture permits the registered capability.',
            },
            userConsent: {
              status: 'notRequired',
              source: 'fixture.host-ui',
              reason: 'No interactive consent is required by this fixture.',
            },
          },
        }) + '\n');
      } else if (frame.type === 'capability.invoke') {
        child.kill();
        break;
      }
    }
    await exit;
    const inspection = await new RustRunStoreRuntime({ kernelPath: kernelBinary, runStoreRoot })
      .inspect(runId);
    assert.equal(inspection.continuation?.disposition,
      replaySafety === 'read_only_retryable' ? 'retryable_capability' : 'blocked_non_idempotent');
    return { engineRoot, runStoreRoot, runId };
  } catch (error) {
    await rm(engineRoot, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (child.exitCode === null) child.kill();
    await exit.catch(() => undefined);
  }
};

test('host notification follows durable append and interrupted work remains blocked', async () => {
  const engineRoot = await mkdtemp(join(tmpdir(), 'forge-run-ledger-hybrid-'));
  const runStoreRoot = join(engineRoot, 'runs', 'v1');
  const runId = `run:interrupted-${process.pid}-${Date.now()}`;
  const requestId = `bridge:interrupted-${process.pid}-${Date.now()}`;
  const child = spawn(kernelBinary, [], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const firstFrame = new Promise<Record<string, unknown>>((resolveFrame, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the first run event.')), 10_000);
    lines.once('line', (line) => {
      clearTimeout(timer);
      try {
        resolveFrame(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
  const exit = new Promise<void>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolveExit());
  });
  child.stdin.write(JSON.stringify({
    type: 'run.start',
    protocolVersion: 'forge.kernel.bridge.v9',
    requestId,
    request: {
      runId,
      task: 'wait for a planner turn',
      snapshot: { id: 'workspace:interrupted', rootLabel: 'fixture', files: [] },
      contextBudgetBytes: 65_536,
      maxTurns: 2,
      executionBudget: {
        schemaVersion: 1,
        maxCapabilityCalls: 1,
        maxReportedInputTokens: 100,
        maxReportedOutputTokens: 100,
      },
    },
    capabilities: [],
    runStoreRoot,
  }) + '\n');

  try {
    const frame = await firstFrame;
    assert.equal(frame.type, 'run.event');
    assert.equal(frame.protocolVersion, 'forge.kernel.bridge.v9');
    const event = frame.event as { readonly runId: string; readonly sequence: number; readonly type: string };
    assert.equal(event.runId, runId);
    assert.equal(event.sequence, 1);
    assert.equal(event.type, 'run.started');

    const inspector = new RustRunStoreRuntime({ kernelPath: kernelBinary, runStoreRoot });
    const visible = await inspector.inspect(runId);
    assert.equal(visible.state, 'open_or_interrupted');
    assert.equal(
      visible.resumeDisposition,
      visible.continuation?.disposition === 'safe_boundary'
        ? 'resume_available'
        : 'blocked_incomplete',
    );
    assert.ok(visible.eventCount >= event.sequence);
    assert.equal(visible.artifact, undefined);

    child.kill();
    await exit;
    const interrupted = await inspector.inspect(runId);
    assert.equal(interrupted.state, 'open_or_interrupted');
    assert.equal(interrupted.resumeDisposition, 'blocked_incomplete');
    assert.equal(interrupted.continuation?.disposition, 'blocked_ambiguous_planner');
    assert.equal(interrupted.artifact, undefined);
    assert.match(interrupted.reason, /ambiguous or unsafe/iu);
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill();
    await exit.catch(() => undefined);
    await rm(engineRoot, { recursive: true, force: true });
  }
  assert.equal(stderr, '');
});

test('resumes through recorded provider and approval completions and retries one authorized read', async () => {
  const pending = await createPendingCapabilityRun('workspace.read', 'read_only_retryable');
  let restoreCalls = 0;
  let plannerCalls = 0;
  let approvalCalls = 0;
  let capabilityCalls = 0;
  const planner: TaskPlanner = {
    id: 'fixture:resume',
    restore(checkpoint: PlannerCheckpoint) {
      restoreCalls++;
      assert.equal(checkpoint.schemaVersion, 1);
      assert.equal(checkpoint.plannerId, 'fixture:resume');
    },
    async next(request) {
      plannerCalls++;
      assert.equal(request.turn, 2);
      assert.equal(request.capabilityResults.length, 1);
      assert.equal(request.capabilityResults[0]?.callId, 'call:pending');
      return { kind: 'complete', output: 'Resumed without duplicate provider work.' };
    },
  };
  const capability: Capability = {
    id: 'workspace.read',
    replaySafety: 'read_only_retryable',
    async invoke(call) {
      capabilityCalls++;
      return { callId: call.id, success: true, content: 'bounded read evidence' };
    },
  };
  const newEvents: string[] = [];
  const runtime = new RustKernelRuntime({
    planner,
    capabilities: [capability],
    approvalFacts: {
      async collect() {
        approvalCalls++;
        throw new Error('Recorded approval must be replayed without a host prompt.');
      },
    },
    kernelPath: kernelBinary,
    runStoreRoot: pending.runStoreRoot,
    onEvent: (event) => newEvents.push(event.type),
  });

  try {
    const artifact = await runtime.resume(pending.runId, {
      allowRetryableCapabilityRetry: true,
    });
    assert.equal(artifact.status, 'completed');
    assert.equal(artifact.output, 'Resumed without duplicate provider work.');
    assert.equal(restoreCalls, 1);
    assert.equal(plannerCalls, 1, 'only the first new provider turn may execute');
    assert.equal(approvalCalls, 0, 'the completed approval must not be requested again');
    assert.equal(capabilityCalls, 1, 'the unresolved read may be retried exactly once');
    assert.deepEqual(newEvents, [
      'capability.completed',
      'outcome.assessed',
      'run.completed',
    ]);
    const inspection = await new RustRunStoreRuntime({
      kernelPath: kernelBinary,
      runStoreRoot: pending.runStoreRoot,
    }).inspect(pending.runId);
    assert.equal(inspection.state, 'terminal');
    assert.equal(inspection.continuation?.disposition, 'terminal');
    assert.equal(inspection.continuation?.interactionFrameCount, 9);
    assert.equal(inspection.continuation?.completedInteractionCount, 4);
  } finally {
    await rm(pending.engineRoot, { recursive: true, force: true });
  }
});

test('never resumes an unresolved non-idempotent capability', async () => {
  const pending = await createPendingCapabilityRun(
    'workspace.change.execute',
    'non_idempotent',
  );
  let restoreCalls = 0;
  let capabilityCalls = 0;
  const planner: TaskPlanner = {
    id: 'fixture:resume',
    restore() {
      restoreCalls++;
    },
    async next() {
      throw new Error('A blocked mutation must not reach the planner.');
    },
  };
  const capability: Capability = {
    id: 'workspace.change.execute',
    replaySafety: 'non_idempotent',
    async invoke(call) {
      capabilityCalls++;
      return { callId: call.id, success: true, content: 'must not execute' };
    },
  };
  const runtime = new RustKernelRuntime({
    planner,
    capabilities: [capability],
    approvalFacts: {
      async collect() {
        throw new Error('A blocked mutation must not request approval.');
      },
    },
    kernelPath: kernelBinary,
    runStoreRoot: pending.runStoreRoot,
  });

  try {
    await assert.rejects(
      runtime.resume(pending.runId, { allowRetryableCapabilityRetry: true }),
      /not proven retryable and will not be executed again/u,
    );
    assert.equal(restoreCalls, 0);
    assert.equal(capabilityCalls, 0);
    const inspection = await new RustRunStoreRuntime({
      kernelPath: kernelBinary,
      runStoreRoot: pending.runStoreRoot,
    }).inspect(pending.runId);
    assert.equal(inspection.continuation?.disposition, 'blocked_non_idempotent');
  } finally {
    await rm(pending.engineRoot, { recursive: true, force: true });
  }
});

test('classifies every live host boundary before accepting its response', async () => {
  const engineRoot = await mkdtemp(join(tmpdir(), 'forge-continuation-boundaries-'));
  const runStoreRoot = join(engineRoot, 'runs', 'v1');
  const runId = `run:boundaries-${process.pid}-${Date.now()}`;
  const requestId = `bridge:boundaries-${process.pid}-${Date.now()}`;
  const child = spawn(kernelBinary, [], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const inspector = new RustRunStoreRuntime({ kernelPath: kernelBinary, runStoreRoot });
  let stderr = '';
  let plannerRequests = 0;
  let approvalRequests = 0;
  let capabilityRequests = 0;
  let terminalSeen = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  const timeout = setTimeout(() => child.kill(), 15_000);
  child.stdin.write(JSON.stringify({
    type: 'run.start',
    protocolVersion: 'forge.kernel.bridge.v9',
    requestId,
    request: {
      runId,
      task: 'read one bounded file',
      snapshot: { id: 'workspace:boundaries', rootLabel: 'fixture', files: [] },
      contextBudgetBytes: 65_536,
      maxTurns: 2,
      executionBudget: {
        schemaVersion: 1,
        maxCapabilityCalls: 1,
        maxReportedInputTokens: 100,
        maxReportedOutputTokens: 100,
      },
    },
    capabilities: [{ id: 'workspace.read', replaySafety: 'read_only_retryable' }],
    runStoreRoot,
  }) + '\n');

  const assertPending = async (
    disposition: 'blocked_ambiguous_planner' | 'blocked_ambiguous_approval' | 'retryable_capability',
    kind: 'planner' | 'approval' | 'capability',
    frameCount: number,
  ): Promise<void> => {
    const inspection = await inspector.inspect(runId);
    assert.equal(inspection.state, 'open_or_interrupted');
    assert.equal(
      inspection.resumeDisposition,
      disposition === 'retryable_capability'
        ? 'retry_authorization_required'
        : 'blocked_incomplete',
    );
    assert.equal(inspection.continuation?.disposition, disposition);
    assert.equal(inspection.continuation?.pendingKind, kind);
    assert.equal(inspection.continuation?.interactionFrameCount, frameCount);
  };

  try {
    for await (const line of lines) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame.type === 'planner.next') {
        plannerRequests++;
        await assertPending('blocked_ambiguous_planner', 'planner', plannerRequests === 1 ? 1 : 7);
        child.stdin.write(JSON.stringify({
          type: 'planner.turn',
          protocolVersion: 'forge.kernel.bridge.v9',
          requestId,
          turn: plannerRequests === 1
            ? {
                kind: 'call',
                call: {
                  id: 'call:read-once',
                  capabilityId: 'workspace.read',
                  input: { path: 'README.md', startLine: 1, maxLines: 2 },
                },
              }
            : { kind: 'complete', output: 'Read completed once.' },
          plannerCheckpoint: {
            schemaVersion: 1,
            plannerId: 'fixture:recovery',
            state: { completedTurns: plannerRequests },
          },
        }) + '\n');
      } else if (frame.type === 'approval.facts.request') {
        approvalRequests++;
        await assertPending('blocked_ambiguous_approval', 'approval', 3);
        child.stdin.write(JSON.stringify({
          type: 'approval.facts',
          protocolVersion: 'forge.kernel.bridge.v9',
          requestId,
          facts: {
            schemaVersion: 1,
            callId: 'call:read-once',
            capabilityId: 'workspace.read',
            hostPolicy: {
              posture: 'allow',
              source: 'fixture.host-policy',
              reason: 'The bounded read is allowed.',
            },
            userConsent: {
              status: 'notRequired',
              source: 'fixture.host-ui',
              reason: 'The fixture does not require interactive consent.',
            },
          },
        }) + '\n');
      } else if (frame.type === 'capability.invoke') {
        capabilityRequests++;
        await assertPending('retryable_capability', 'capability', 5);
        child.stdin.write(JSON.stringify({
          type: 'capability.result',
          protocolVersion: 'forge.kernel.bridge.v9',
          requestId,
          result: {
            callId: 'call:read-once',
            success: true,
            content: 'path: README.md\n1: # Fixture',
          },
        }) + '\n');
      } else if (frame.type === 'run.result') {
        terminalSeen = true;
        const inspection = await inspector.inspect(runId);
        assert.equal(inspection.state, 'terminal');
        assert.equal(inspection.resumeDisposition, 'return_terminal_artifact');
        assert.equal(inspection.continuation?.disposition, 'terminal');
        assert.equal(inspection.continuation?.interactionFrameCount, 8);
        assert.equal(inspection.continuation?.completedInteractionCount, 4);
        assert.equal(inspection.continuation?.pendingInteractionId, undefined);
        break;
      }
    }
    child.stdin.end();
    assert.equal(await exit, 0);
    assert.equal(plannerRequests, 2);
    assert.equal(approvalRequests, 1);
    assert.equal(capabilityRequests, 1, 'the capability must execute exactly once');
    assert.equal(terminalSeen, true);
    assert.equal(stderr, '');
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (child.exitCode === null) child.kill();
    await exit.catch(() => undefined);
    await rm(engineRoot, { recursive: true, force: true });
  }
});

test('terminal host result follows a validated durable artifact seal', async () => {
  const engineRoot = await mkdtemp(join(tmpdir(), 'forge-run-seal-hybrid-'));
  const runStoreRoot = join(engineRoot, 'runs', 'v1');
  const runId = 'run:terminal-' + String(process.pid) + '-' + String(Date.now());
  const requestId = 'bridge:terminal-' + String(process.pid) + '-' + String(Date.now());
  const child = spawn(kernelBinary, [], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let stderr = '';
  let terminalFrame: Record<string, unknown> | undefined;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  const timeout = setTimeout(() => child.kill(), 10_000);
  const startFrame = {
    type: 'run.start',
    protocolVersion: 'forge.kernel.bridge.v9',
    requestId,
    request: {
      runId,
      task: 'complete after one planner response',
      snapshot: { id: 'workspace:terminal', rootLabel: 'fixture', files: [] },
      contextBudgetBytes: 65_536,
      maxTurns: 2,
      executionBudget: {
        schemaVersion: 1,
        maxCapabilityCalls: 0,
        maxReportedInputTokens: 0,
        maxReportedOutputTokens: 0,
      },
    },
    capabilities: [],
    runStoreRoot,
  } as const;
  child.stdin.write(JSON.stringify(startFrame) + '\n');

  try {
    for await (const line of lines) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame.type === 'planner.next') {
        child.stdin.write(JSON.stringify({
          type: 'planner.turn',
          protocolVersion: 'forge.kernel.bridge.v9',
          requestId,
          turn: { kind: 'complete', output: 'done' },
        }) + '\n');
      } else if (frame.type === 'run.result') {
        terminalFrame = frame;
        const inspection = await new RustRunStoreRuntime({
          kernelPath: kernelBinary,
          runStoreRoot,
        }).inspect(runId);
        assert.equal(inspection.state, 'terminal');
        assert.equal(inspection.resumeDisposition, 'return_terminal_artifact');
        assert.equal(inspection.eventCount, 4);
        assert.deepEqual(inspection.artifact, frame.artifact);
        break;
      }
    }
    child.stdin.end();
    assert.equal(await exit, 0);
    assert.ok(terminalFrame, 'kernel must return a terminal frame');
    assert.equal(stderr, '');

    let terminalPlannerCalls = 0;
    const terminalReplay = await new RustKernelRuntime({
      planner: {
        id: 'fixture:terminal-replay',
        async next() {
          terminalPlannerCalls++;
          throw new Error('A terminal run must not call its planner.');
        },
      },
      capabilities: [],
      approvalFacts: {
        async collect() {
          throw new Error('A terminal run must not collect approval facts.');
        },
      },
      kernelPath: kernelBinary,
      runStoreRoot,
    }).resume(runId);
    assert.deepEqual(terminalReplay, terminalFrame.artifact);
    assert.equal(terminalPlannerCalls, 0);

    const duplicate = spawnSync(kernelBinary, [], {
      cwd: process.cwd(),
      env: process.env,
      input: JSON.stringify(startFrame) + '\n',
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(duplicate.status, 3);
    assert.equal(duplicate.stdout, '');
    assert.match(duplicate.stderr, /already has a durable ledger and cannot be executed again/u);
    assert.doesNotMatch(duplicate.stdout, /planner\.next|run\.event|run\.result/u);
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (child.exitCode === null) child.kill();
    await exit.catch(() => undefined);
    await rm(engineRoot, { recursive: true, force: true });
  }
});