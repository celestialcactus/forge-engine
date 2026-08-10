import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RustSovereignChangeRuntime } from '../src/hybrid/rust-sovereign-change-runtime.js';

test('rejects internally inconsistent transaction audit evidence from the kernel transport', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-change-audit-transport-'));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const fixture = join(root, 'fixture.cjs');
  await writeFile(fixture, `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const start = JSON.parse(input.trim());
  process.stdout.write(JSON.stringify({
    type: 'change.result',
    protocolVersion: start.protocolVersion,
    requestId: start.requestId,
    operation: 'audit',
    artifact: {
      schemaVersion: 1,
      generatedAtUnixMs: 100,
      preparedReviewAfterMs: 1000,
      transactions: [{
        transactionId: 'transaction:sha256:${'a'.repeat(64)}',
        changeSetId: 'changeset:sha256:${'b'.repeat(64)}',
        state: 'prepared',
        createdAtUnixMs: 90,
        ageMs: 10,
        candidateRetained: true,
        reviewDue: false,
        recommendation: 'none'
      }],
      truncated: false,
      orphanStagingRemoved: 0
    }
  }) + '\\n');
});
`, 'utf8');
  const runtime = new RustSovereignChangeRuntime({
    kernelPath: process.execPath,
    kernelArguments: [fixture],
    repositoryRoot: root,
    engineRoot: join(root, 'engine'),
  });
  await assert.rejects(
    runtime.audit(),
    /internally inconsistent sovereign change audit evidence/u,
  );
});
