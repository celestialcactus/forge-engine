import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { governedChangeEvidenceKind } from '../../src/governed-change.js';
import type { ApprovalFacts, CapabilityCall } from '../../src/slice0/contracts.js';
import { ScriptedPlanner } from '../../src/slice0/fixtures.js';
import type {
  SovereignCoordinatorArtifact,
  SovereignPreparedArtifact,
  SovereignProposalArtifact,
} from '../../src/hybrid/rust-sovereign-change-runtime.js';
import { ForgeWorkspaceService } from '../../src/v1/service.js';

const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', 'debug', process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const changeSetId = `changeset:sha256:${digest('hybrid-governed-change-set')}`;
const transactionId = `transaction:sha256:${digest('hybrid-governed-transaction')}`;

const coordinator = (
  state: SovereignCoordinatorArtifact['state'],
): SovereignCoordinatorArtifact => ({
  schemaVersion: 1,
  transactionId,
  changeSetId,
  baseRevision: 'base:hybrid-governed',
  state,
  operationCount: 1,
  candidatePath: 'candidate:hybrid-governed',
  candidateRetained: state !== 'promoted' && state !== 'discarded',
  verification: [{ checkId: 'typecheck', success: true }],
  transitions: [],
  recoveryPerformed: false,
});

test('Rust lifecycle retains governed edit approval and promotion evidence before completion', async () => {
  const workspaceRoot = resolve('tests/fixtures/slice1-workspace');
  const target = resolve(workspaceRoot, 'README.md');
  const before = await readFile(target, 'utf8');
  const replacementText = before + '\nHybrid governed only.\n';
  const readCall = {
    id: 'call:hybrid-read',
    capabilityId: 'workspace.read',
    input: { path: 'README.md', startLine: 1, maxLines: 200 },
  };
  const changeCall = {
    id: 'call:hybrid-change',
    capabilityId: 'workspace.change.execute',
    input: { changes: [{ path: 'README.md', content: replacementText }] },
  };
  const planner = new ScriptedPlanner([
    { kind: 'call', call: readCall },
    { kind: 'call', call: changeCall },
    { kind: 'complete', output: 'Forge promoted the governed fixture change.' },
  ]);
  const prepared: SovereignPreparedArtifact = {
    schemaVersion: 2,
    changeSetId,
    snapshotId: 'candidate-snapshot:hybrid-governed',
    operations: [{
      kind: 'replace',
      path: 'README.md',
      beforeSha256: digest(before),
      beforeMode: 'regular',
      after: {
        sha256: digest(replacementText),
        bytes: Buffer.byteLength(replacementText),
        contentKind: 'utf8_text',
      },
      afterMode: 'regular',
    }],
  };
  const runtime = {
    async prepare(): Promise<SovereignPreparedArtifact> { return prepared; },
    async propose(
      _proposal: unknown,
      _expectedChangeSetId: string,
      _selectedCheckIds: readonly string[],
      call: CapabilityCall,
      facts: ApprovalFacts,
    ): Promise<SovereignProposalArtifact> {
      return {
        schemaVersion: 2,
        status: 'verified_candidate',
        verification: [{ checkId: 'typecheck', success: true }],
        approvedCall: call,
        approval: { outcome: 'allow', reason: facts.userConsent.reason, facts },
        outcomeContract: { schemaVersion: 1, requirements: [] },
        outcome: { schemaVersion: 1, status: 'verified', reason: 'Fixture verified.', checks: [] },
        transaction: coordinator('prepared'),
      };
    },
    async accept(): Promise<SovereignCoordinatorArtifact> { return coordinator('promoted'); },
    async discard(): Promise<SovereignCoordinatorArtifact> { throw new Error('Discard was not expected.'); },
  };
  const answers = ['yes', 'accept'];
  const service = new ForgeWorkspaceService(workspaceRoot, {
    runtime: {
      kind: 'rust_kernel',
      kernel: {
        binaryPath: kernelBinary,
        runStoreRoot: resolve(
          'target',
          'hybrid-test-engines',
          'rust-governed-' + String(process.pid) + '-' + String(Date.now()),
        ),
      },
    },
    runIdFactory: () => 'run:hybrid-governed-change',
  });
  try {
    const artifact = await service.executeGovernedChangeTask(
      'Add a hybrid governed-only line.',
      planner,
      {
        checkIds: ['typecheck'],
        runtime,
        io: {
          async question(): Promise<string | undefined> { return answers.shift(); },
          write(): void {},
        },
      },
      { maxTurns: 3 },
    );
    assert.equal(artifact.status, 'completed');
    assert.deepEqual(artifact.capabilityResults.map((result) => result.success), [true, true]);
    const evidence = artifact.capabilityResults[1]?.evidence;
    assert.equal(evidence?.kind, governedChangeEvidenceKind);
    const data = evidence?.data as Record<string, unknown>;
    assert.equal(data.status, 'accepted');
    assert.equal(data.workspacePromoted, true);
    const basis = data.basis as Record<string, unknown>;
    assert.deepEqual(basis.priorCallIds, [readCall.id]);
    const approval = artifact.events.find((event) =>
      event.type === 'approval.decided' && event.callId === changeCall.id);
    assert.equal(approval?.type, 'approval.decided');
    if (approval?.type !== 'approval.decided') throw new Error('Expected governed approval event.');
    assert.deepEqual(approval.basis, basis);
    const completed = artifact.events.find((event) =>
      event.type === 'capability.completed' && event.result.callId === changeCall.id);
    const terminal = artifact.events.find((event) => event.type === 'run.completed');
    assert.ok(completed && terminal && completed.sequence < terminal.sequence);
    assert.equal(await readFile(target, 'utf8'), before);
  } finally {
    service.close();
  }
});
