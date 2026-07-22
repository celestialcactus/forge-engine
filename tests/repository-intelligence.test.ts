import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { artifactPayload, ForgeWorkspaceService } from '../src/v1/service.js';
import { createWorkspaceSearchCapability } from '../src/v1/workspace.js';

const slice1Fixture = resolve('tests/fixtures/slice1-workspace');
const diagnosticsFixture = resolve('tests/fixtures/diagnostics-workspace');

test('reads only a bounded line range from a snapshotted workspace file', async () => {
  const artifact = await new ForgeWorkspaceService(slice1Fixture).read('README.md', { startLine: 2, maxLines: 1 });
  const evidence = artifactPayload(artifact).evidence;
  assert.equal(artifact.capabilityResults.at(-1)?.success, true);
  assert.deepEqual(evidence, {
    snapshotId: artifact.snapshot.id,
    path: 'README.md',
    sha256: 'a2d751c882ed205d16ac08dafedc5bea7ead89d1d24744eab4ed7c55b1b4d475',
    startLine: 2,
    endLine: 2,
    totalLines: 4,
    text: '',
    lines: [{ line: 2, text: '' }],
    truncated: true,
  });
});

test('records path traversal as a failed capability without reading outside the snapshot', async () => {
  const artifact = await new ForgeWorkspaceService(slice1Fixture).read('../package.json');
  assert.equal(artifact.capabilityResults.at(-1)?.success, false);
  assert.match(String(artifactPayload(artifact).evidence), /traversal/iu);
});

test('revalidates canonical paths before search reads snapshot evidence', async () => {
  const capability = createWorkspaceSearchCapability(slice1Fixture);
  await assert.rejects(capability.invoke(
    {
      id: 'search-boundary',
      capabilityId: 'workspace.search',
      input: { query: 'forge' },
    },
    {
      id: 'forged-snapshot',
      rootLabel: 'slice1-workspace',
      files: [{ path: '../../../package.json', bytes: 1 }],
    },
    new AbortController().signal,
  ), /escapes the workspace boundary/u);
});

test('skips non-UTF-8 content instead of decoding corrupt evidence', async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), 'forge-invalid-utf8-'));
  context.after(async () => { await rm(workspace, { recursive: true, force: true }); });
  await writeFile(join(workspace, 'binary.dat'), Buffer.from([0xc3, 0x28]));
  const service = new ForgeWorkspaceService(workspace, {
    snapshotObserver: () => ({ close() {} }),
  });
  try {
    const artifact = await service.search('text');
    const evidence = artifactPayload(artifact).evidence as {
      matches: unknown[];
      skippedLargeOrBinary: number;
    };
    assert.deepEqual(evidence.matches, []);
    assert.equal(evidence.skippedLargeOrBinary, 1);
  } finally {
    service.close();
  }
});

test('extracts bounded declarations from TypeScript syntax trees', async () => {
  const artifact = await new ForgeWorkspaceService(slice1Fixture).symbols({ query: 'fixtureMessage', maxSymbols: 10 });
  const evidence = artifactPayload(artifact).evidence as {
    symbols: Array<{ name: string; kind: string; path: string; line: number; column: number }>;
  };
  assert.deepEqual(evidence.symbols, [{
    name: 'fixtureMessage', kind: 'variable', path: 'src/example.ts', line: 1, column: 14,
  }]);
});

test('collects no-emit TypeScript configuration diagnostics as structured evidence', async () => {
  const artifact = await new ForgeWorkspaceService(diagnosticsFixture).diagnostics({ maxDiagnostics: 10 });
  const evidence = artifactPayload(artifact).evidence as {
    diagnosticCount: number;
    diagnostics: Array<{ code: number; message: string }>;
    emitted: boolean;
  };
  assert.equal(artifact.capabilityResults.at(-1)?.success, true);
  assert.equal(evidence.emitted, false);
  assert.ok(evidence.diagnosticCount >= 1);
  assert.ok(evidence.diagnostics.some((diagnostic) => diagnostic.code === 5023 && /forgeIntentionalInvalidOption/u.test(diagnostic.message)));
});

test('collects read-only Git status and bounded diff evidence for the opened repository', async () => {
  const service = new ForgeWorkspaceService(process.cwd());
  try {
    const statusArtifact = await service.gitStatus();
    const status = artifactPayload(statusArtifact).evidence as { branch: string | null; changeCount: number; changes: string[] };
    assert.equal(statusArtifact.capabilityResults.at(-1)?.success, true);
    assert.equal(typeof status.changeCount, 'number');
    assert.ok(Array.isArray(status.changes));

    const diffArtifact = await service.gitDiff({ maxBytes: 2_000 });
    const diff = artifactPayload(diffArtifact).evidence as { bytes: number; diff: string; truncated: boolean };
    assert.equal(diffArtifact.capabilityResults.at(-1)?.success, true);
    assert.equal(typeof diff.diff, 'string');
    assert.ok(Buffer.byteLength(diff.diff, 'utf8') <= 2_000);
  } finally {
    service.close();
  }
});
