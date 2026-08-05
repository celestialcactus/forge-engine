import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { forgeMcpArtifactResult } from '../src/mcp/presentation.js';
import { forgeMcpReadCacheKey } from '../src/mcp/server.js';
import type { RunArtifact } from '../src/slice0/contracts.js';

const fixtureRoot = resolve('tests/fixtures/slice1-workspace');
type TextContent = Array<{ readonly type: string; readonly text?: string }>;
const contentText = (result: unknown): string => {
  const candidate = result as { readonly content?: unknown };
  const content = candidate.content as TextContent;
  return content[0]?.text ?? '';
};
const structuredPayload = <T>(result: unknown): T =>
  (result as { readonly structuredContent?: unknown }).structuredContent as T;

test('marks an unmet outcome as an MCP error even when the adapter call succeeded', () => {
  const outcome = {
    schemaVersion: 1 as const,
    status: 'unmet' as const,
    reason: 'One or more caller-authored outcome requirements were not satisfied.',
    checks: [{
      id: 'output',
      kind: 'output_non_empty' as const,
      satisfied: false,
      explanation: 'Observed outcome value contained 0 characters and did not include non-whitespace content.',
    }],
  };
  const artifact: RunArtifact = {
    schemaVersion: 4,
    runId: 'run:unmet-mcp',
    task: 'Return output.',
    snapshot: { id: 'workspace:unmet-mcp', rootLabel: 'fixture', files: [] },
    status: 'completed',
    executionBudget: { schemaVersion: 1, maxCapabilityCalls: 6, maxReportedInputTokens: 262_144, maxReportedOutputTokens: 32_768 },
    executionUsage: { schemaVersion: 1, capabilityCalls: 1, inferenceTurns: 0, reportedInputTokens: 0, reportedOutputTokens: 0 },
    capabilityResults: [{ callId: 'call-1', success: true, content: '' }],
    outcomeContract: { schemaVersion: 1, requirements: [{ id: 'output', kind: 'output_non_empty' }] },
    outcome,
    output: '',
    events: [
      { runId: 'run:unmet-mcp', sequence: 1, type: 'outcome.assessed', assessment: outcome },
      { runId: 'run:unmet-mcp', sequence: 2, type: 'run.completed', output: '' },
    ],
  };
  const result = forgeMcpArtifactResult(artifact, 'summary');
  assert.equal('isError' in result ? result.isError : undefined, true);
  assert.match(result.content[0]?.text ?? '', /Outcome status: unmet/u);
});

test('official MCP client discovers and invokes the compact Forge repository-intelligence tether', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tests/support/mcp-conformance-server.ts'), fixtureRoot],
  });
  const client = new Client({ name: 'forge-conformance-test', version: '0.1.0' });
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
    assert.ok(listed.tools.every((tool) => /run ID/u.test(tool.description ?? '')));
    assert.ok(listed.tools.every((tool) => /complete workspace-relative paths/u.test(tool.description ?? '')));
    assert.ok(listed.tools.every((tool) => /do not repeat/u.test(tool.description ?? '')));
    assert.ok(listed.tools.every((tool) => tool.outputSchema?.type === 'object'));
    assert.ok(listed.tools.every((tool) =>
      Array.isArray(tool.outputSchema?.required) && tool.outputSchema.required.includes('invocationId')));
    assert.ok(listed.tools.every((tool) =>
      Array.isArray(tool.outputSchema?.required) && tool.outputSchema.required.includes('runId')));
    assert.ok(listed.tools.every((tool) =>
      Array.isArray(tool.outputSchema?.required) && tool.outputSchema.required.includes('snapshotId')));

    const summaryTool = listed.tools.find((tool) => tool.name === 'forge_workspace_summary');
    const summaryProperties = summaryTool?.inputSchema.properties as Record<string, { maximum?: number }>;
    assert.equal(summaryProperties.maxFiles?.maximum, 100);
    const readTool = listed.tools.find((tool) => tool.name === 'forge_workspace_read');
    const readProperties = readTool?.inputSchema.properties as Record<string, { maximum?: number }>;
    assert.equal(readProperties.maxLines?.maximum, 200);

    const summaryResult = await client.callTool({ name: 'forge_workspace_summary', arguments: { maxFiles: 1 } });
    assert.equal(summaryResult.isError, undefined);
    const summary = structuredPayload<{
      invocationId: string;
      runId: string;
      snapshotId: string;
      runStatus: string;
      outcome: { status: string; checks: Array<{ satisfied: boolean }> };
      capability: { success: boolean };
      workspace: { rootLabel: string };
      evidence: { totalFiles: number; files: string[]; truncated: boolean };
      events: Array<{ sequence: number; type: string }>;
    }>(summaryResult);
    assert.match(summary.invocationId, /^mcp:/u);
    assert.match(summary.runId, /^run:/u);
    assert.match(summary.snapshotId, /^workspace:/u);
    assert.equal(summary.runStatus, 'completed');
    assert.equal(summary.outcome.status, 'verified');
    assert.equal(summary.outcome.checks.length, 2);
    assert.equal(summary.outcome.checks.every((check) => check.satisfied), true);
    assert.equal(summary.capability.success, true);
    assert.equal(summary.workspace.rootLabel, 'slice1-workspace');
    assert.equal(summary.evidence.totalFiles, 2);
    assert.deepEqual(summary.evidence.files, ['README.md']);
    assert.equal(summary.evidence.truncated, true);
    assert.deepEqual(summary.events, [
      { sequence: 1, type: 'run.started' },
      { sequence: 2, type: 'context.planned' },
      { sequence: 3, type: 'capability.requested' },
      { sequence: 4, type: 'approval.decided' },
      { sequence: 5, type: 'capability.completed' },
      { sequence: 6, type: 'outcome.assessed' },
      { sequence: 7, type: 'run.completed' },
    ]);
    assert.equal(JSON.stringify(summary).includes('"plan"'), false);
    assert.equal(JSON.stringify(summary).includes('"outcomeContract"'), false);
    assert.match(contentText(summaryResult), /^Forge run ID: run:/u);
    assert.match(contentText(summaryResult), /Snapshot ID: workspace:/u);
    assert.match(contentText(summaryResult), /Outcome status: verified/u);
    assert.match(contentText(summaryResult), /Mechanical run status: completed \(not the task outcome\)/u);
    assert.equal(JSON.stringify(summary).includes('"status":"completed"'), false);
    assert.match(contentText(summaryResult), /Paths:\nREADME\.md/u);
    assert.ok(Buffer.byteLength(JSON.stringify(summaryResult), 'utf8') < 5_000);

    const readResult = await client.callTool({ name: 'forge_workspace_read', arguments: { path: 'README.md', maxLines: 1 } });
    assert.equal(readResult.isError, undefined);
    const readInvocationId = structuredPayload<{ invocationId: string }>(readResult).invocationId;
    assert.match(readInvocationId, /^mcp:/u);
    const read = structuredPayload<{
      runId: string;
      evidence: {
        path: string;
        sha256: string;
        lines: Array<{ line: number; text: string }>;
        startLine: number;
        truncated: boolean;
        text?: string;
      };
    }>(readResult);
    assert.equal(read.evidence.path, 'README.md');
    assert.equal(read.evidence.sha256, 'a2d751c882ed205d16ac08dafedc5bea7ead89d1d24744eab4ed7c55b1b4d475');
    assert.equal(read.evidence.startLine, 1);
    assert.deepEqual(read.evidence.lines, [{ line: 1, text: '# Slice 1 fixture' }]);
    assert.equal(read.evidence.truncated, true);
    assert.equal(read.evidence.text, undefined);
    assert.match(contentText(readResult), /README\.md/u);
    assert.match(contentText(readResult), /1 \| # Slice 1 fixture/u);
    assert.ok(Buffer.byteLength(JSON.stringify(readResult), 'utf8') < 5_000);

    const replayResult = await client.callTool({ name: 'forge_workspace_read', arguments: { path: 'README.md', maxLines: 1 } });
    const replayInvocationId = structuredPayload<{ invocationId: string }>(replayResult).invocationId;
    assert.match(replayInvocationId, /^mcp:/u);
    const replay = structuredPayload<{ runId: string; evidence: {
      path: string; sha256: string; lines: Array<{ line: number; text: string }>; startLine: number;
      endLine: number; totalLines: number; truncated: boolean;
    }; cache: {
      hit: true; sourceRunId: string; path: string; requestedStartLine: number; requestedEndLine: number;
      coveredStartLine: number; coveredEndLine: number;
    } }>(replayResult);
    assert.notEqual(replayInvocationId, readInvocationId);
    assert.equal(replay.runId, read.runId);
    assert.deepEqual(replay.evidence.lines, [{ line: 1, text: '# Slice 1 fixture' }]);
    assert.equal(replay.evidence.path, 'README.md');
    assert.equal(replay.evidence.sha256, 'a2d751c882ed205d16ac08dafedc5bea7ead89d1d24744eab4ed7c55b1b4d475');
    assert.equal(replay.evidence.startLine, 1);
    assert.equal(replay.evidence.endLine, 1);
    assert.equal(replay.evidence.totalLines, 4);
    assert.equal(replay.evidence.truncated, true);
    assert.deepEqual(replay.cache, { hit: true, sourceRunId: read.runId, path: 'README.md', requestedStartLine: 1, requestedEndLine: 1, coveredStartLine: 1, coveredEndLine: 1 });
    assert.match(contentText(replayResult), /No filesystem read or new Forge run occurred/u);
    assert.match(contentText(replayResult), /1 \| # Slice 1 fixture/u);
    assert.ok(Buffer.byteLength(JSON.stringify(replayResult), 'utf8') < 5_000);

    const symbolResult = await client.callTool({ name: 'forge_workspace_symbols', arguments: { query: 'fixtureMessage' } });
    const symbols = structuredPayload<{ evidence: { symbols: Array<{ name: string }> } }>(symbolResult);
    assert.equal(symbols.evidence.symbols[0]?.name, 'fixtureMessage');

    const invalidSearch = await client.callTool({ name: 'forge_workspace_search', arguments: { query: '' } });
    assert.equal(invalidSearch.isError, true);
    assert.match(JSON.stringify(invalidSearch.content), /invalid|validation/iu);

    const excessiveSummary = await client.callTool({ name: 'forge_workspace_summary', arguments: { maxFiles: 500 } });
    assert.equal(excessiveSummary.isError, true);
    assert.match(JSON.stringify(excessiveSummary.content), /invalid|validation/iu);

    const excessiveRead = await client.callTool({ name: 'forge_workspace_read', arguments: { path: 'README.md', maxLines: 201 } });
    assert.equal(excessiveRead.isError, true);
    assert.match(JSON.stringify(excessiveRead.content), /invalid|validation/iu);
  } finally {
    await client.close();
  }
});

test('read replay cache preserves path case and invalidates stale file evidence', async (context) => {
  assert.notEqual(forgeMcpReadCacheKey('src/Foo.ts'), forgeMcpReadCacheKey('src/foo.ts'));

  const workspace = await mkdtemp(join(tmpdir(), 'forge-mcp-cache-'));
  const readme = join(workspace, 'README.md');
  await writeFile(readme, '# Cache A' + String.fromCharCode(10), 'utf8');
  context.after(async () => { await rm(workspace, { recursive: true, force: true }); });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tests/support/mcp-conformance-server.ts'), workspace],
  });
  const client = new Client({ name: 'forge-cache-conformance-test', version: '0.1.0' });
  await client.connect(transport);
  try {
    const firstResult = await client.callTool({ name: 'forge_workspace_read', arguments: { path: 'README.md', maxLines: 1 } });
    const first = structuredPayload<{ runId: string; evidence: { lines: Array<{ line: number; text: string }> } }>(firstResult);
    assert.deepEqual(first.evidence.lines, [{ line: 1, text: '# Cache A' }]);

    const replayResult = await client.callTool({ name: 'forge_workspace_read', arguments: { path: 'README.md', maxLines: 1 } });
    const replay = structuredPayload<{ runId: string; cache?: { hit: true } }>(replayResult);
    assert.equal(replay.runId, first.runId);
    assert.equal(replay.cache?.hit, true);

    await writeFile(readme, '# Cache B' + String.fromCharCode(10), 'utf8');
    const changedTime = new Date(Date.now() + 5_000);
    await utimes(readme, changedTime, changedTime);
    const refreshedResult = await client.callTool({ name: 'forge_workspace_read', arguments: { path: 'README.md', maxLines: 1 } });
    const refreshed = structuredPayload<{
      runId: string;
      evidence: { lines: Array<{ line: number; text: string }> };
      cache?: { hit: true };
    }>(refreshedResult);
    assert.notEqual(refreshed.runId, first.runId);
    assert.equal(refreshed.cache, undefined);
    assert.deepEqual(refreshed.evidence.lines, [{ line: 1, text: '# Cache B' }]);
  } finally {
    await client.close();
  }
});
