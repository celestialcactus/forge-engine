import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const fixtureRoot = resolve('tests/fixtures/slice1-workspace');
const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', 'debug', process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');

const structuredPayload = <T>(result: unknown): T =>
  (result as { readonly structuredContent?: unknown }).structuredContent as T;

test('official MCP client preserves the seven-tool compact contract over the Rust kernel', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli.ts'), 'mcp', '--workspace', fixtureRoot],
    env: { ...getDefaultEnvironment(), FORGE_KERNEL_BINARY: kernelBinary },
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
      readonly status: string;
      readonly evidence: { readonly files: readonly string[]; readonly totalFiles: number; readonly truncated: boolean };
      readonly events: ReadonlyArray<{ readonly sequence: number; readonly type: string }>;
    }>(summaryResult);
    assert.match(summary.runId, /^run:/u);
    assert.match(summary.snapshotId, /^workspace:/u);
    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.evidence, { files: ['README.md'], totalFiles: 2, truncated: true });
    assert.deepEqual(summary.events, [
      { sequence: 1, type: 'run.started' },
      { sequence: 2, type: 'context.planned' },
      { sequence: 3, type: 'capability.requested' },
      { sequence: 4, type: 'approval.decided' },
      { sequence: 5, type: 'capability.completed' },
      { sequence: 6, type: 'run.completed' },
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