import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  extractInteractiveChangePlan,
  renderInteractiveChangePlan,
  validatePreparedChangePlan,
} from '../src/change-workflow.js';
import { developerChangePlanningTools, developerEvidenceTools } from '../src/inference/developer-tools.js';
import type { RunArtifact } from '../src/slice0/contracts.js';
import type { SovereignPreparedArtifact } from '../src/hybrid/rust-sovereign-change-runtime.js';

const before = 'export const value = 1;\n';
const after = 'export const value = 2;\n';
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

const artifact = (overrides: Partial<RunArtifact> = {}): RunArtifact => ({
  schemaVersion: 2,
  runId: 'run:plan',
  task: 'Change value to two.',
  snapshot: {
    id: 'workspace:test',
    rootLabel: 'fixture',
    files: [{ path: 'src/value.ts', bytes: Buffer.byteLength(before) }],
  },
  status: 'completed',
  contextPlan: { id: 'context:test', budgetBytes: 1024, selected: [], omitted: [] },
  capabilityResults: [{
    callId: 'call:read',
    success: true,
    content: JSON.stringify({
      snapshotId: 'workspace:test',
      path: 'src/value.ts',
      sha256: digest(before),
      startLine: 1,
      endLine: 2,
      totalLines: 2,
      text: before,
      lines: [{ line: 1, text: 'export const value = 1;' }, { line: 2, text: '' }],
      truncated: false,
    }),
  }, {
    callId: 'call:plan',
    success: true,
    content: JSON.stringify({
      schemaVersion: 1,
      proposalId: 'change:test',
      snapshotId: 'workspace:test',
      status: 'ready',
      mutatesWorkspace: false,
      approvalRequiredBeforeApply: true,
      changes: [{
        path: 'src/value.ts',
        beforeSha256: digest(before),
        afterSha256: digest(after),
        beforeBytes: Buffer.byteLength(before),
        afterBytes: Buffer.byteLength(after),
        diff: '--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1,1 +1,1 @@\n-export const value = 1;\n+export const value = 2;\n',
        diffBytes: 115,
        truncated: false,
      }],
      conflicts: [],
    }),
  }],
  inferenceEvidence: [],
  outcome: {
    schemaVersion: 1,
    status: 'not_evaluated',
    reason: 'No contract.',
    checks: [],
  },
  output: 'I prepared a review plan.',
  events: [
    {
      runId: 'run:plan',
      sequence: 1,
      type: 'run.started',
      task: 'Change value to two.',
      snapshotId: 'workspace:test',
    },
    {
      runId: 'run:plan',
      sequence: 2,
      type: 'capability.requested',
      call: {
        id: 'call:read',
        capabilityId: 'workspace.read',
        input: { path: 'src/value.ts', startLine: 1, maxLines: 200 },
      },
    },
    {
      runId: 'run:plan',
      sequence: 3,
      type: 'capability.completed',
      result: {
        callId: 'call:read',
        success: true,
        content: JSON.stringify({
          snapshotId: 'workspace:test',
          path: 'src/value.ts',
          sha256: digest(before),
          startLine: 1,
          endLine: 2,
          totalLines: 2,
          text: before,
          lines: [{ line: 1, text: 'export const value = 1;' }, { line: 2, text: '' }],
          truncated: false,
        }),
      },
    },
    {
      runId: 'run:plan',
      sequence: 4,
      type: 'capability.requested',
      call: {
        id: 'call:plan',
        capabilityId: 'workspace.change.plan',
        input: {
          changes: [{
            path: 'src/value.ts',
            expectedSha256: digest(before),
            replacementText: after,
          }],
        },
      },
    },
  ],
  ...overrides,
});

const prepared: SovereignPreparedArtifact = {
  schemaVersion: 2,
  changeSetId: 'changeset:sha256:test',
  snapshotId: 'snapshot:test',
  operations: [{
    kind: 'replace',
    path: 'src/value.ts',
    beforeSha256: digest(before),
    beforeMode: 'regular',
    after: {
      sha256: digest(after),
      bytes: Buffer.byteLength(after),
      contentKind: 'utf8_text',
    },
    afterMode: 'regular',
  }],
};

test('keeps the change-plan tool CLI-only and out of the seven-tool evidence surface', () => {
  assert.equal(developerEvidenceTools.length, 7);
  assert.equal(developerEvidenceTools.some((tool) => tool.capabilityId === 'workspace.change.plan'), false);
  assert.equal(developerChangePlanningTools.length, 8);
  const planningTool = developerChangePlanningTools.at(-1);
  assert.equal(planningTool?.name, 'forge_workspace_change_plan');
  assert.match(JSON.stringify(planningTool?.inputSchema), /"content"/u);
  assert.doesNotMatch(JSON.stringify(planningTool?.inputSchema), /expectedSha256|maxDiffBytes/u);
});

test('extracts one complete digest-bound plan and cross-checks the Rust-prepared operation', () => {
  const plan = extractInteractiveChangePlan(artifact());
  assert.ok(plan);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.sovereignProposal.operations[0]?.kind, 'replace');
  validatePreparedChangePlan(plan, prepared);
  const rendered = renderInteractiveChangePlan(plan, prepared, ['typecheck']);
  assert.ok(rendered.some((line) => line.includes('changeset:sha256:test')));
  assert.ok(rendered.some((line) => line.includes('+export const value = 2;')));
});

test('refuses incomplete, repeated, truncated, or identity-mismatched plans before approval', () => {
  assert.throws(() => extractInteractiveChangePlan(artifact({ status: 'failed' })), /incomplete planning run/u);
  const repeated = artifact();
  const planEvent = repeated.events.find((event) =>
    event.type === 'capability.requested' && event.call.capabilityId === 'workspace.change.plan');
  assert.ok(planEvent);
  assert.throws(() => extractInteractiveChangePlan({
    ...repeated,
    events: [...repeated.events, planEvent],
  }), /exactly one change plan/u);
  const truncatedEvidence = JSON.parse(artifact().capabilityResults[1]!.content) as Record<string, unknown>;
  const changes = truncatedEvidence.changes as Array<Record<string, unknown>>;
  changes[0] = { ...changes[0], truncated: true };
  assert.throws(() => extractInteractiveChangePlan(artifact({
    capabilityResults: [{
      ...artifact().capabilityResults[1]!,
      content: JSON.stringify(truncatedEvidence),
    }, artifact().capabilityResults[0]!],
  })), /review diff is truncated/u);
  const plan = extractInteractiveChangePlan(artifact());
  assert.ok(plan);
  assert.throws(() => validatePreparedChangePlan(plan, {
    ...prepared,
    operations: [{ ...prepared.operations[0], beforeSha256: '0'.repeat(64) }],
  }), /does not match the reviewed plan/u);
  assert.throws(() => extractInteractiveChangePlan(artifact({
    events: artifact().events.filter((event) => event.type !== 'capability.completed'),
  })), /does not cover the complete target/u);
  const invalidRange = artifact();
  assert.throws(() => extractInteractiveChangePlan({
    ...invalidRange,
    events: invalidRange.events.map((event) => event.type === 'capability.completed'
      ? {
          ...event,
          result: {
            ...event.result,
            content: JSON.stringify({ ...JSON.parse(event.result.content), totalLines: -1 }),
          },
        }
      : event),
  }), /does not cover the complete target/u);
  const mismatchedSnapshot = artifact();
  const planResult = JSON.parse(mismatchedSnapshot.capabilityResults[1]!.content) as Record<string, unknown>;
  assert.throws(() => extractInteractiveChangePlan({
    ...mismatchedSnapshot,
    capabilityResults: [mismatchedSnapshot.capabilityResults[0]!, {
      ...mismatchedSnapshot.capabilityResults[1]!,
      content: JSON.stringify({ ...planResult, snapshotId: 'workspace:other' }),
    }],
  }), /does not match the planning workspace snapshot/u);
});