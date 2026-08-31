import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyMemoryCaptureCandidate,
  MemoryAutoSaveController,
} from '../src/memory/autosave.js';
import type {
  MemoryCaptureMode,
  MemoryCaptureRuntime,
  MemoryCorrectionDisposition,
  MemoryGrantScope,
  MemoryInspection,
  MemoryObservation,
  MemoryOperationResult,
  MemoryStandingGrant,
} from '../src/memory/contracts.js';

const actorId = 'developer:fixture';
const developerScope = { kind: 'developer', actorId } as const;
const repositoryScope = {
  kind: 'repository',
  workspaceId: `workspace:v1:sha256:${'a'.repeat(64)}`,
  repositoryId: `repository:v1:sha256:${'a'.repeat(64)}`,
} as const;
const grantId = `memory_grant:v1:sha256:${'b'.repeat(64)}`;

const preference = (statement: string): MemoryObservation => ({
  schemaVersion: 1,
  normalizationId: 'memory_text_v1',
  claimId: `memory_claim:v1:sha256:${'c'.repeat(64)}`,
  observationId: `memory_observation:v1:sha256:${'d'.repeat(64)}`,
  subjectKind: 'developer_preference',
  statementKind: 'developer_preference',
  subject: 'developer preference',
  statement,
  scope: developerScope,
  provenance: {
    kind: 'developer_statement',
    actorId,
    admission: { standing_grant: { grantId } },
  },
  relation: { kind: 'supports' },
  confidence: 100,
  observedAtMillis: 100,
  freshness: { kind: 'persistent_until_reviewed' },
});

class FakeCaptureRuntime implements MemoryCaptureRuntime {
  grant?: MemoryStandingGrant;
  autoCaptured: string[] = [];
  reviewed: string[] = [];
  undone?: { readonly observationId: string; readonly grantId: string };

  async setCaptureMode(mode: MemoryCaptureMode, scope: MemoryGrantScope): Promise<MemoryOperationResult> {
    this.grant = {
      schemaVersion: 1,
      grantId,
      actorId,
      scope,
      mode,
      createdAtMillis: 100,
    };
    return this.result('capture_mode_changed', undefined, this.grant);
  }

  async rememberPreference(statement: string): Promise<MemoryOperationResult> {
    this.reviewed.push(statement);
    return this.result('admitted', preference(statement));
  }

  async autoCapture(statement: string): Promise<MemoryOperationResult> {
    this.autoCaptured.push(statement);
    return this.result('admitted', preference(statement));
  }

  async undoAutoCapture(observationId: string, sourceGrantId: string): Promise<MemoryOperationResult> {
    this.undone = { observationId, grantId: sourceGrantId };
    return this.result('auto_capture_undone');
  }

  async revokeGrant(): Promise<MemoryOperationResult> {
    return this.result('grant_revoked', undefined, this.grant);
  }

  async inspect(): Promise<MemoryInspection> {
    return {
      schemaVersion: 1,
      scope: developerScope,
      active: [],
      activeCount: 0,
      recoveryCount: 0,
      ...(this.grant === undefined ? {} : { grants: [this.grant] }),
    };
  }

  async remember(statement: string): Promise<MemoryOperationResult> {
    return this.result('admitted', preference(statement));
  }

  async correct(
    _target: string,
    replacement: string,
    _disposition: MemoryCorrectionDisposition,
  ): Promise<MemoryOperationResult> {
    return this.result('corrected', preference(replacement));
  }

  async restore(): Promise<MemoryOperationResult> {
    return this.result('restored', preference('I prefer restored output.'));
  }

  private result(
    status: MemoryOperationResult['status'],
    activeObservation?: MemoryObservation,
    grant?: MemoryStandingGrant,
  ): MemoryOperationResult {
    return {
      schemaVersion: 1,
      status,
      scope: developerScope,
      ...(activeObservation === undefined ? {} : { activeObservation }),
      ...(grant === undefined ? {} : { grant }),
      activeCount: activeObservation === undefined ? 0 : 1,
      recoveryCount: 0,
      ledgerHeadSha256: 'e'.repeat(64),
      compacted: status === 'auto_capture_undone',
    };
  }
}

test('eligibility is narrow, attributable, and secret-safe', () => {
  assert.deepEqual(classifyMemoryCaptureCandidate('I prefer concise test output.'), {
    eligible: true,
    statement: 'I prefer concise test output.',
  });
  assert.deepEqual(classifyMemoryCaptureCandidate('Always use concise output.'), { eligible: false, reason: 'ambiguous' });
  assert.deepEqual(classifyMemoryCaptureCandidate('I prefer pnpm.'), { eligible: false, reason: 'ambiguous' });
  assert.deepEqual(classifyMemoryCaptureCandidate('Inspect this repository.'), { eligible: false, reason: 'not_candidate' });
  assert.deepEqual(classifyMemoryCaptureCandidate('I prefer password hunter2.'), { eligible: false, reason: 'sensitive' });
  assert.deepEqual(classifyMemoryCaptureCandidate('I prefer approval bypasses.'), { eligible: false, reason: 'authority_change' });
  assert.deepEqual(classifyMemoryCaptureCandidate('I prefer concise output.', 'model_output'), { eligible: false, reason: 'ineligible_source' });
  assert.deepEqual(classifyMemoryCaptureCandidate('I prefer concise output.', 'tool_output'), { eligible: false, reason: 'ineligible_source' });
  assert.deepEqual(classifyMemoryCaptureCandidate('I prefer concise output.', 'repository_text'), { eligible: false, reason: 'ineligible_source' });
});

test('ask is the default and requires explicit review', async () => {
  const runtime = new FakeCaptureRuntime();
  const controller = new MemoryAutoSaveController(runtime, repositoryScope);
  assert.deepEqual(await controller.state(), { mode: 'ask' });
  assert.deepEqual(await controller.captureDirectInput('I prefer concise test output.'), {
    kind: 'proposal',
    statement: 'I prefer concise test output.',
  });
  const declined = await controller.captureDirectInput('I prefer concise test output.', async () => false);
  assert.equal(declined.kind, 'declined');
  assert.deepEqual(runtime.reviewed, []);
  const accepted = await controller.captureDirectInput('I prefer concise test output.', async () => true);
  assert.equal(accepted.kind, 'remembered');
  assert.deepEqual(runtime.reviewed, ['I prefer concise test output.']);
});

test('auto saves an eligible preference without approval and undo targets only that admission', async () => {
  const runtime = new FakeCaptureRuntime();
  const controller = new MemoryAutoSaveController(runtime, repositoryScope);
  await controller.setMode('auto');
  let approvalCalled = false;
  const outcome = await controller.captureDirectInput('I prefer concise test output.', async () => {
    approvalCalled = true;
    return true;
  });
  assert.equal(approvalCalled, false);
  assert.equal(outcome.kind, 'remembered');
  assert.deepEqual(runtime.autoCaptured, ['I prefer concise test output.']);
  if (outcome.kind !== 'remembered' || outcome.receipt === undefined) assert.fail('expected auto receipt');
  await controller.undo(outcome.receipt);
  assert.deepEqual(runtime.undone, {
    observationId: `memory_observation:v1:sha256:${'d'.repeat(64)}`,
    grantId,
  });
});

test('off never captures and ambiguous auto candidates fall back to review', async () => {
  const runtime = new FakeCaptureRuntime();
  const controller = new MemoryAutoSaveController(runtime, repositoryScope);
  await controller.setMode('off');
  assert.deepEqual(await controller.captureDirectInput('I prefer concise test output.'), { kind: 'off' });
  assert.deepEqual(runtime.autoCaptured, []);

  await controller.setMode('auto');
  let reviewed = false;
  const ambiguous = await controller.captureDirectInput('Always use concise output.', async () => {
    reviewed = true;
    return false;
  });
  assert.equal(reviewed, true);
  assert.equal(ambiguous.kind, 'declined');
  assert.deepEqual(runtime.autoCaptured, []);
});
