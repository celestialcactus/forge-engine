import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { governedChangeEvidenceKind } from '../src/governed-change.js';
import type {
  InferenceProvider,
  NormalizedInferenceEvent,
  ProviderInferenceRequest,
} from '../src/inference/contracts.js';
import { developerGovernedChangeTools } from '../src/inference/developer-tools.js';
import { ProviderTaskPlanner } from '../src/inference/planner.js';
import type { ApprovalFacts, CapabilityCall } from '../src/slice0/contracts.js';
import type {
  SovereignCoordinatorArtifact,
  SovereignPreparedArtifact,
  SovereignProposalArtifact,
} from '../src/hybrid/rust-sovereign-change-runtime.js';
import { ForgeWorkspaceService, typeScriptConformanceFixture } from '../src/v1/service.js';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

const coordinator = (
  state: SovereignCoordinatorArtifact['state'],
): SovereignCoordinatorArtifact => ({
  schemaVersion: 1,
  transactionId: 'transaction:test',
  changeSetId: 'changeset:test',
  baseRevision: 'base:test',
  state,
  operationCount: 1,
  candidatePath: 'candidate:test',
  candidateRetained: state !== 'promoted' && state !== 'discarded',
  verification: [{ checkId: 'typecheck', success: true }],
  transitions: [],
  recoveryPerformed: false,
});

test('runs a governed provider edit inside one open Forge lifecycle', async () => {
  const workspaceRoot = resolve('tests/fixtures/slice1-workspace');
  const target = resolve(workspaceRoot, 'README.md');
  const before = await readFile(target, 'utf8');
  const replacementText = before + '\nGoverned only.\n';
  const requests: ProviderInferenceRequest[] = [];
  let turn = 0;
  const provider: InferenceProvider = {
    id: 'ollama',
    locality: 'local',
    async *stream(request): AsyncGenerator<NormalizedInferenceEvent> {
      requests.push(request);
      turn++;
      if (turn === 1) {
        yield {
          type: 'tool_call.delta',
          index: 0,
          id: 'read-call',
          name: 'forge_workspace_read',
          argumentsDelta: JSON.stringify({ path: 'README.md', startLine: 1, maxLines: 200 }),
        };
        yield { type: 'response.completed', finishReason: 'tool_call' };
        return;
      }
      if (turn === 2) {
        yield {
          type: 'tool_call.delta',
          index: 0,
          id: 'change-call',
          name: 'forge_workspace_change',
          argumentsDelta: JSON.stringify({
            changes: [{ path: 'README.md', content: replacementText }],
          }),
        };
        yield { type: 'response.completed', finishReason: 'tool_call' };
        return;
      }
      yield { type: 'text.delta', text: 'Forge verified and promoted the reviewed README change.' };
      yield { type: 'response.completed', finishReason: 'stop' };
    },
  };
  const planner = new ProviderTaskPlanner({
    provider,
    route: { provider: 'ollama', model: 'fixture-model' },
    tools: developerGovernedChangeTools,
  });
  const prepared: SovereignPreparedArtifact = {
    schemaVersion: 2,
    changeSetId: 'changeset:test',
    snapshotId: 'candidate-snapshot:test',
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
  const proposalTransaction = coordinator('prepared');
  const runtime = {
    async prepare(): Promise<SovereignPreparedArtifact> {
      return prepared;
    },
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
        transaction: proposalTransaction,
      };
    },
    async accept(): Promise<SovereignCoordinatorArtifact> {
      return coordinator('promoted');
    },
    async discard(): Promise<SovereignCoordinatorArtifact> {
      throw new Error('Discard was not expected.');
    },
  };
  const answers = ['yes', 'accept'];
  const io = {
    async question(): Promise<string | undefined> { return answers.shift(); },
    write(): void {},
  };
  const service = new ForgeWorkspaceService(workspaceRoot, {
    runtime: typeScriptConformanceFixture,
    runIdFactory: () => 'run:governed-change-fixture',
  });
  try {
    const artifact = await service.executeGovernedChangeTask(
      'Add a governed-only line to the README.',
      planner,
      { checkIds: ['typecheck'], runtime, io },
      { maxTurns: 3 },
    );
    assert.equal(artifact.status, 'completed');
    assert.deepEqual(artifact.capabilityResults.map((result) => result.success), [true, true]);
    const execution = artifact.capabilityResults[1];
    assert.equal(execution?.evidence?.kind, governedChangeEvidenceKind);
    const evidence = execution?.evidence?.data as Record<string, unknown>;
    assert.equal(evidence.status, 'accepted');
    assert.equal(evidence.workspacePromoted, true);
    const basis = evidence.basis as Record<string, unknown>;
    assert.deepEqual(basis.priorCallIds, [artifact.capabilityResults[0]?.callId]);
    const executeRequest = artifact.events.find((event) =>
      event.type === 'capability.requested' && event.call.capabilityId === 'workspace.change.execute');
    const executeCompleted = artifact.events.find((event) =>
      event.type === 'capability.completed' && event.result.callId === execution?.callId);
    const runCompleted = artifact.events.find((event) => event.type === 'run.completed');
    assert.ok(executeRequest && executeCompleted && runCompleted);
    assert.ok(executeRequest.sequence < executeCompleted.sequence);
    assert.ok(executeCompleted.sequence < runCompleted.sequence);
    assert.equal(await readFile(target, 'utf8'), before);
    const system = requests[0]?.messages.find((message) => message.role === 'system');
    assert.match(system?.content ?? '', /Never claim the workspace changed unless the tool says Workspace promoted=true/u);
  } finally {
    service.close();
  }
});
