import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);
const fixtureRoot = resolve('tests/fixtures/slice1-workspace');
const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', 'debug', process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');
const hybridEngineRoot = resolve('target', 'hybrid-test-engines', 'mcp-rust-kernel-' + String(process.pid));
const mcpEngineRoot = resolve(hybridEngineRoot, 'mcp');
const cliEngineRoot = resolve(hybridEngineRoot, 'cli');

const structuredPayload = <T>(result: unknown): T =>
  (result as { readonly structuredContent?: unknown }).structuredContent as T;

test('official MCP client preserves the seven-tool compact contract over the Rust kernel', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli.ts'), 'mcp', '--workspace', fixtureRoot],
    env: {
      ...getDefaultEnvironment(),
      FORGE_KERNEL_BINARY: kernelBinary,
      FORGE_ENGINE_ROOT: mcpEngineRoot,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-hybrid-conformance', version: '0.1.0' });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      'forge_git_diff',
      'forge_git_status',
      'forge_typescript_diagnostics',
      'forge_workspace_read',
      'forge_workspace_search',
      'forge_workspace_summary',
      'forge_workspace_symbols',
    ]);

    const summaryResult = await client.callTool({
      name: 'forge_workspace_summary',
      arguments: { maxFiles: 1 },
    });
    assert.equal(summaryResult.isError, undefined);
    const summary = structuredPayload<{
      readonly runId: string;
      readonly snapshotId: string;
      readonly runStatus: string;
      readonly outcome: { readonly status: string };
      readonly evidence: { readonly files: readonly string[]; readonly totalFiles: number; readonly truncated: boolean };
      readonly events: ReadonlyArray<{ readonly sequence: number; readonly type: string }>;
    }>(summaryResult);
    assert.match(summary.runId, /^run:/u);
    assert.match(summary.snapshotId, /^workspace:/u);
    assert.equal(summary.runStatus, 'completed');
    assert.equal(summary.outcome.status, 'verified');
    assert.deepEqual(summary.evidence, { files: ['README.md'], totalFiles: 2, truncated: true });
    assert.deepEqual(summary.events, [
      { sequence: 1, type: 'run.started' },
      { sequence: 2, type: 'context.planned' },
      { sequence: 3, type: 'capability.requested' },
      { sequence: 4, type: 'approval.decided' },
      { sequence: 5, type: 'capability.completed' },
      { sequence: 6, type: 'outcome.assessed' },
      { sequence: 7, type: 'run.completed' },
    ]);
    assert.ok(Buffer.byteLength(JSON.stringify(summaryResult), 'utf8') < 5_000);

    const readResult = await client.callTool({
      name: 'forge_workspace_read',
      arguments: { path: 'README.md', startLine: 1, maxLines: 1 },
    });
    assert.equal(readResult.isError, undefined);
    const read = structuredPayload<{
      readonly runId: string;
      readonly evidence: {
        readonly path: string;
        readonly lines: ReadonlyArray<{ readonly line: number; readonly text: string }>;
        readonly truncated: boolean;
      };
    }>(readResult);
    assert.match(read.runId, /^run:/u);
    assert.equal(read.evidence.path, 'README.md');
    assert.deepEqual(read.evidence.lines, [{ line: 1, text: '# Slice 1 fixture' }]);
    assert.equal(read.evidence.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(readResult), 'utf8') < 5_000);
  } finally {
    await client.close();
  }
});
test('product CLI auto-discovers the Rust kernel for a real inspection', async () => {
  const environment: NodeJS.ProcessEnv = { ...process.env, FORGE_ENGINE_ROOT: cliEngineRoot };
  delete environment.FORGE_KERNEL_BINARY;
  const { stdout } = await execFileAsync(process.execPath, [
    resolve('node_modules/tsx/dist/cli.mjs'),
    resolve('src/cli.ts'),
    'inspect',
    '--workspace',
    fixtureRoot,
    '--max-files',
    '1',
    '--json',
  ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
  const payload = JSON.parse(stdout) as {
    readonly runId: string;
    readonly status: string;
    readonly outcome: { readonly status: string };
    readonly task: string;
    readonly evidence: {
      readonly snapshotId: string;
      readonly rootLabel: string;
      readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number }>;
      readonly totalFiles: number;
      readonly truncated: boolean;
    };
  };
  assert.equal(payload.status, 'completed');
  assert.equal(payload.outcome.status, 'verified');
  assert.equal(payload.task, 'Inspect the opened workspace.');
  assert.match(payload.evidence.snapshotId, /^workspace:/u);
  assert.equal(payload.evidence.rootLabel, 'slice1-workspace');
  assert.equal(payload.evidence.totalFiles, 2);
  assert.equal(payload.evidence.truncated, true);
  assert.equal(payload.evidence.files.length, 1);
  assert.equal(payload.evidence.files[0]?.path, 'README.md');
  assert.ok((payload.evidence.files[0]?.bytes ?? 0) > 0);

  const stored = await execFileAsync(process.execPath, [
    resolve('node_modules/tsx/dist/cli.mjs'),
    resolve('src/cli.ts'),
    'runs',
    'inspect',
    payload.runId,
    '--engine-root',
    cliEngineRoot,
    '--json',
  ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
  const inspection = JSON.parse(stored.stdout) as {
    readonly runId: string;
    readonly state: string;
    readonly resumeDisposition: string;
    readonly eventCount: number;
    readonly artifact: { readonly runId: string; readonly status: string };
  };
  assert.equal(inspection.runId, payload.runId);
  assert.equal(inspection.state, 'terminal');
  assert.equal(inspection.resumeDisposition, 'return_terminal_artifact');
  assert.equal(inspection.eventCount, 7);
  assert.equal(inspection.artifact.runId, payload.runId);
  assert.equal(inspection.artifact.status, 'completed');

  const doctor = await execFileAsync(process.execPath, [
    resolve('node_modules/tsx/dist/cli.mjs'),
    resolve('src/cli.ts'),
    'doctor',
    '--workspace',
    fixtureRoot,
    '--json',
  ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
  const report = JSON.parse(doctor.stdout) as {
    readonly ok: boolean;
    readonly runtime: string;
    readonly approval: { readonly profile: string; readonly source: string; readonly decisionAuthority: string };
    readonly kernel: {
      readonly ready: boolean;
      readonly source: string;
      readonly path: string;
      readonly version: string;
      readonly protocols: { readonly run: string; readonly runStore: string; readonly sovereignChange: string };
    };
    readonly runStore: { readonly root: string; readonly durability: string; readonly recovery: string };
  };
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'rust-kernel-typescript-adapter');
  assert.equal(report.kernel.ready, true);
  assert.match(report.kernel.source, /^source-(debug|release)$/u);
  assert.match(report.kernel.path, /forge-kernel(?:\.exe)?$/u);
  assert.equal(report.kernel.version, '0.1.0');
  assert.equal(report.kernel.protocols.run, 'forge.kernel.bridge.v10');
  assert.equal(report.kernel.protocols.runStore, 'forge.kernel.run-store.v1');
  assert.equal(report.kernel.protocols.sovereignChange, 'forge.kernel.changeset.v3');
  assert.equal(report.runStore.root, resolve(cliEngineRoot, 'runs', 'v1'));
  assert.equal(report.runStore.durability, 'append-before-notify; terminal-before-result');
  assert.match(report.runStore.recovery, /validated same-runtime continuation/u);
  assert.deepEqual(report.approval, {
    profile: 'developer',
    source: 'default',
    decisionAuthority: 'rust-kernel',
    scope: 'registered capabilities; governed mutations retain exact-change approval',
  });

  await assert.rejects(
    execFileAsync(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'),
      resolve('src/cli.ts'),
      'inspect',
      '--workspace',
      fixtureRoot,
      '--approval-profile',
      'locked',
      '--json',
    ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment }),
    (error: unknown) => {
      const failure = error as { readonly code: number; readonly stdout: string };
      assert.equal(failure.code, 1);
      const denied = JSON.parse(failure.stdout) as {
        readonly status: string;
        readonly outcome: { readonly status: string };
        readonly capability: { readonly success: boolean };
        readonly events: ReadonlyArray<Record<string, unknown>>;
      };
      assert.equal(denied.status, 'completed');
      assert.equal(denied.outcome.status, 'unmet');
      assert.equal(denied.capability.success, false);
      const approval = denied.events.find((event) => event.type === 'approval.decided');
      assert.equal(approval?.outcome, 'deny');
      const facts = approval?.facts as { readonly hostPolicy: { readonly source: string } };
      assert.equal(facts.hostPolicy.source, 'forge.product.approval-profile.locked');
      return true;
    },
  );
});
