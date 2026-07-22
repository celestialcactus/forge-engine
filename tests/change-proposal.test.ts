import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { ChangeProposalArtifact } from '../src/v1/change-proposal.js';
import { artifactPayload, ForgeWorkspaceService } from '../src/v1/service.js';

const fixtureRoot = resolve('tests/fixtures/slice1-workspace');
const readmePath = resolve(fixtureRoot, 'README.md');
const sha256 = (content: Uint8Array): string => createHash('sha256').update(content).digest('hex');
const createObservedService = (): ForgeWorkspaceService => new ForgeWorkspaceService(fixtureRoot, {
  snapshotObserver: () => ({ close() {} }),
});

test('proposes a deterministic reviewable diff without mutating the workspace', async () => {
  const original = await readFile(readmePath);
  const originalText = original.toString('utf8');
  const replacementText = originalText.replace('forge needle', 'forge proposal needle');
  const service = createObservedService();

  try {
    const request = [{
      path: 'README.md',
      expectedSha256: sha256(original),
      replacementText,
    }];
    const first = await service.proposeChanges(request);
    const second = await service.proposeChanges(request);
    const firstProposal = artifactPayload(first).evidence as ChangeProposalArtifact;
    const secondProposal = artifactPayload(second).evidence as ChangeProposalArtifact;

    assert.equal(first.capabilityResults.at(-1)?.success, true);
    assert.equal(firstProposal.status, 'ready');
    assert.equal(firstProposal.mutatesWorkspace, false);
    assert.equal(firstProposal.approvalRequiredBeforeApply, true);
    assert.equal(firstProposal.proposalId, secondProposal.proposalId);
    assert.equal(firstProposal.changes.length, 1);
    assert.equal(firstProposal.changes[0]?.path, 'README.md');
    assert.equal(firstProposal.changes[0]?.beforeSha256, sha256(original));
    assert.match(firstProposal.changes[0]?.diff ?? '', /^--- a\/README\.md\n\+\+\+ b\/README\.md\n@@/u);
    assert.match(firstProposal.changes[0]?.diff ?? '', /\+This workspace contains a searchable forge proposal needle\./u);
    assert.deepEqual(service.snapshotMetrics(), {
      scans: 1,
      reuses: 1,
      invalidations: 0,
      freshnessMode: 'observed-with-rescan',
    });
    assert.deepEqual(await readFile(readmePath), original);
  } finally {
    service.close();
  }
});

test('keeps proposal identity stable when only diff representation bounds change', async () => {
  const original = await readFile(readmePath);
  const replacementText = Array.from({ length: 400 }, (_value, index) => 'line-' + index).join('\n');
  const service = createObservedService();
  try {
    const request = [{
      path: 'README.md',
      expectedSha256: sha256(original),
      replacementText,
    }];
    const compact = artifactPayload(await service.proposeChanges(request, { maxDiffBytes: 1_000 })).evidence as ChangeProposalArtifact;
    const complete = artifactPayload(await service.proposeChanges(request, { maxDiffBytes: 100_000 })).evidence as ChangeProposalArtifact;

    assert.equal(compact.proposalId, complete.proposalId);
    assert.equal(compact.changes[0]?.truncated, true);
    assert.equal(complete.changes[0]?.truncated, false);
    assert.ok(Buffer.byteLength(compact.changes[0]?.diff ?? '', 'utf8') <= 1_000);
  } finally {
    service.close();
  }
});

test('rejects duplicate targets after workspace path canonicalization', async () => {
  const original = await readFile(readmePath);
  const service = createObservedService();
  try {
    const artifact = await service.proposeChanges([
      { path: 'README.md', expectedSha256: sha256(original), replacementText: 'first' },
      { path: './README.md', expectedSha256: sha256(original), replacementText: 'second' },
    ]);
    assert.equal(artifact.capabilityResults.at(-1)?.success, false);
    assert.match(String(artifactPayload(artifact).evidence), /Duplicate canonical change target: README.md/u);
    assert.deepEqual(await readFile(readmePath), original);
  } finally {
    service.close();
  }
});
test('bounds aggregate diff evidence across a multi-file proposal', async () => {
  const readme = await readFile(readmePath);
  const examplePath = resolve(fixtureRoot, 'src/example.ts');
  const example = await readFile(examplePath);
  const service = createObservedService();
  try {
    const artifact = await service.proposeChanges([
      {
        path: 'README.md',
        expectedSha256: sha256(readme),
        replacementText: Array.from({ length: 400 }, (_value, index) => 'readme-' + index).join('\n'),
      },
      {
        path: 'src/example.ts',
        expectedSha256: sha256(example),
        replacementText: Array.from({ length: 400 }, (_value, index) => 'example-' + index).join('\n'),
      },
    ], { maxDiffBytes: 1_000 });
    const result = artifactPayload(artifact).evidence as ChangeProposalArtifact;

    assert.equal(result.status, 'ready');
    assert.equal(result.changes.length, 2);
    assert.ok(result.changes.reduce((bytes, change) => bytes + Buffer.byteLength(change.diff, 'utf8'), 0) <= 1_000);
    assert.equal(result.changes.some((change) => change.truncated), true);
  } finally {
    service.close();
  }
});

test('rejects a stale base digest as a visible conflict without producing a partial proposal', async () => {
  const original = await readFile(readmePath, 'utf8');
  const service = createObservedService();
  try {
    const artifact = await service.proposeChanges([{
      path: 'README.md',
      expectedSha256: '0'.repeat(64),
      replacementText: original.replace('forge needle', 'stale replacement'),
    }]);
    const proposal = artifactPayload(artifact).evidence as ChangeProposalArtifact;

    assert.equal(artifact.capabilityResults.at(-1)?.success, false);
    assert.equal(proposal.status, 'conflicted');
    assert.deepEqual(proposal.changes, []);
    assert.deepEqual(proposal.conflicts, [{
      path: 'README.md',
      expectedSha256: '0'.repeat(64),
      actualSha256: sha256(Buffer.from(original, 'utf8')),
      reason: 'base_digest_mismatch',
    }]);
    assert.equal(await readFile(readmePath, 'utf8'), original);
  } finally {
    service.close();
  }
});

test('reports an exact no-op proposal without inventing a diff', async () => {
  const original = await readFile(readmePath);
  const service = createObservedService();
  try {
    const artifact = await service.proposeChanges([{
      path: 'README.md',
      expectedSha256: sha256(original),
      replacementText: original.toString('utf8'),
    }]);
    const proposal = artifactPayload(artifact).evidence as ChangeProposalArtifact;
    assert.equal(artifact.capabilityResults.at(-1)?.success, true);
    assert.equal(proposal.status, 'no_changes');
    assert.deepEqual(proposal.changes, []);
  } finally {
    service.close();
  }
});
