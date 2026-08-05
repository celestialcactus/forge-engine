import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { RustRunStoreRuntime } from '../../src/hybrid/rust-run-store-runtime.js';

const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', 'debug', process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');

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
    protocolVersion: 'forge.kernel.bridge.v7',
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
    capabilityIds: [],
    runStoreRoot,
  }) + '\n');

  try {
    const frame = await firstFrame;
    assert.equal(frame.type, 'run.event');
    assert.equal(frame.protocolVersion, 'forge.kernel.bridge.v7');
    const event = frame.event as { readonly runId: string; readonly sequence: number; readonly type: string };
    assert.equal(event.runId, runId);
    assert.equal(event.sequence, 1);
    assert.equal(event.type, 'run.started');

    const inspector = new RustRunStoreRuntime({ kernelPath: kernelBinary, runStoreRoot });
    const visible = await inspector.inspect(runId);
    assert.equal(visible.state, 'open_or_interrupted');
    assert.equal(visible.resumeDisposition, 'blocked_incomplete');
    assert.ok(visible.eventCount >= event.sequence);
    assert.equal(visible.artifact, undefined);

    child.kill();
    await exit;
    const interrupted = await inspector.inspect(runId);
    assert.equal(interrupted.state, 'open_or_interrupted');
    assert.equal(interrupted.resumeDisposition, 'blocked_incomplete');
    assert.equal(interrupted.artifact, undefined);
    assert.match(interrupted.reason, /Automatic continuation is blocked/u);
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill();
    await exit.catch(() => undefined);
    await rm(engineRoot, { recursive: true, force: true });
  }
  assert.equal(stderr, '');
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
  child.stdin.write(JSON.stringify({
    type: 'run.start',
    protocolVersion: 'forge.kernel.bridge.v7',
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
    capabilityIds: [],
    runStoreRoot,
  }) + '\n');

  try {
    for await (const line of lines) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame.type === 'planner.next') {
        child.stdin.write(JSON.stringify({
          type: 'planner.turn',
          protocolVersion: 'forge.kernel.bridge.v7',
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
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (child.exitCode === null) child.kill();
    await exit.catch(() => undefined);
    await rm(engineRoot, { recursive: true, force: true });
  }
});