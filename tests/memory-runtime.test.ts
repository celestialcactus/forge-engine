import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { RustMemoryRuntime } from '../src/memory/runtime.js';

const previewKernel = (
  providerWorkPerformed = false,
  statementPreview = 'Prefer concise output.',
  selectedStatement = 'Rust owns context admission.',
  responseAsOfMillis = 500,
  responseBudgetBytes = 65_536,
  selectedByteOffset = 0,
  forgeIdentity = false,
): string => `
import { createHash } from 'node:crypto';
const canonical = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  const action = request.action;
  if (action.operation !== 'preview'
    || action.actorId !== 'developer:local'
    || action.asOfMillis !== 500
    || action.budgetBytes !== 65536) process.exit(2);
  const id = (prefix, character) => prefix + character.repeat(64);
  const observation = {
    schemaVersion: 1,
    normalizationId: 'memory_text_v1',
    claimId: id('memory_claim:v1:sha256:', 'a'),
    observationId: id('memory_observation:v1:sha256:', 'b'),
    subjectKind: 'repository_convention',
    statementKind: 'reviewed_decision',
    subject: 'repository decision',
    statement: ${JSON.stringify(selectedStatement)},
    scope: request.scope,
    provenance: { kind: 'developer_statement', actorId: action.actorId },
    relation: { kind: 'supports' },
    confidence: 100,
    observedAtMillis: 100,
    freshness: { kind: 'persistent_until_reviewed' },
  };
  const developerScope = { kind: 'developer', actorId: action.actorId };
  const entry = { lineageId: observation.observationId, observation, admittedSequence: 1, updatedSequence: 1 };
  const contextBytes = Buffer.byteLength(JSON.stringify(entry)) + ${String(selectedByteOffset)};
  const identity = {
    schemaVersion: 1,
    asOfMillis: ${String(responseAsOfMillis)},
    budgetBytes: ${String(responseBudgetBytes)},
    selectedBytes: contextBytes,
    candidateCount: 2,
    selected: [{
      entry,
      contextBytes,
      reason: 'active_fresh_exact_scope',
    }],
    omitted: [{
      observationId: id('memory_observation:v1:sha256:', 'd'),
      scopeKind: 'developer',
      statementPreview: ${JSON.stringify(statementPreview)},
      contextBytes: 22,
      reason: 'budget_exceeded',
    }],
    scopeHeads: [
      { scope: request.scope, activeCount: 1, recoveryCount: 1 },
      { scope: developerScope, activeCount: 1, recoveryCount: 0 },
    ],
    forgottenExcludedCount: 1,
    supersededRecoveryExcludedCount: 0,
    retrievalActive: false,
    plannerInjection: false,
    providerWorkPerformed: ${String(providerWorkPerformed)},
  };
  const previewId = ${String(forgeIdentity)}
    ? id('memory_context_preview:v1:sha256:', 'c')
    : 'memory_context_preview:v1:sha256:' + createHash('sha256').update(canonical(identity)).digest('hex');
  const preview = { schemaVersion: 1, previewId, ...identity };
  process.stdout.write(JSON.stringify({
    type: 'memory.result',
    protocolVersion: request.protocolVersion,
    requestId: request.requestId,
    outcome: { kind: 'context_preview', preview },
  }) + '\\n');
});
`;

const previewRuntime = (script: string): RustMemoryRuntime => new RustMemoryRuntime({
  kernelPath: process.execPath,
  kernelArguments: ['--input-type=module', '-e', script],
  engineRoot: resolve(import.meta.dirname, 'fixtures', 'engine-root'),
  workspaceRoot: resolve(import.meta.dirname, '..'),
  scope: {
    kind: 'repository',
    workspaceId: 'workspace:test',
    repositoryId: 'repository:test',
  },
  actorId: 'developer:local',
  clock: () => 500,
});

test('waits for memory protocol stdout to close after the kernel parent exits', async () => {
  const runtime = new RustMemoryRuntime({
    kernelPath: process.execPath,
    kernelArguments: [resolve(import.meta.dirname, 'fixtures', 'delayed-memory-kernel.mjs')],
    engineRoot: resolve(import.meta.dirname, 'fixtures', 'engine-root'),
    workspaceRoot: resolve(import.meta.dirname, '..'),
    scope: {
      kind: 'repository',
      workspaceId: 'workspace:test',
      repositoryId: 'repository:test',
    },
    actorId: 'developer:local',
  });

  const inspection = await runtime.inspect(true);

  assert.equal(inspection.activeCount, 0);
  assert.equal(inspection.recoveryCount, 0);
});

test('sends the frozen preview action and validates the exact inactive result', async () => {
  const preview = await previewRuntime(previewKernel()).preview();
  assert.match(preview.previewId, /^memory_context_preview:v1:sha256:[a-f0-9]{64}$/u);
  assert.equal(preview.scopeHeads.length, 2);
  assert.equal(preview.candidateCount, 2);
  assert.equal(preview.selectedBytes, preview.selected[0]?.contextBytes);
  assert.equal(preview.retrievalActive, false);
  assert.equal(preview.plannerInjection, false);
  assert.equal(preview.providerWorkPerformed, false);
});

test('binds preview time, budget, byte accounting, and identity to the request', async () => {
  await assert.rejects(
    previewRuntime(previewKernel(false, 'Prefer concise output.', 'Valid.', 501)).preview(),
    /invalid memory context preview/u,
  );
  await assert.rejects(
    previewRuntime(previewKernel(false, 'Prefer concise output.', 'Valid.', 500, 65_535)).preview(),
    /invalid memory context preview/u,
  );
  await assert.rejects(
    previewRuntime(previewKernel(false, 'Prefer concise output.', 'Valid.', 500, 65_536, 1)).preview(),
    /invalid byte accounting/u,
  );
  await assert.rejects(
    previewRuntime(previewKernel(false, 'Prefer concise output.', 'Valid.', 500, 65_536, 0, true)).preview(),
    /invalid identity digest/u,
  );
});

test('rejects a preview that claims provider work was performed', async () => {
  await assert.rejects(
    previewRuntime(previewKernel(true)).preview(65_536),
    /invalid memory context preview/u,
  );
});

test('rejects a preview scope fingerprint derived from hidden ledger history', async () => {
  const leakingKernel = previewKernel().replace(
    '{ scope: request.scope, activeCount: 1',
    "{ scope: request.scope, ledgerHeadSha256: 'e'.repeat(64), activeCount: 1",
  );
  await assert.rejects(
    previewRuntime(leakingKernel).preview(65_536),
    /invalid memory preview scope head/u,
  );
});

test('rejects an omitted statement preview containing terminal control characters', async () => {
  await assert.rejects(
    previewRuntime(previewKernel(false, 'unsafe\nterminal line')).preview(65_536),
    /invalid omitted memory preview entry/u,
  );
  await assert.rejects(
    previewRuntime(previewKernel(false, 'unsafe\u009bterminal line')).preview(65_536),
    /invalid omitted memory preview entry/u,
  );
});

test('accepts normalized multiline memory but rejects forbidden controls in selected memory', async () => {
  const multiline = await previewRuntime(
    previewKernel(false, 'Prefer concise output.', 'First line.\nSecond line.'),
  ).preview(65_536);
  assert.equal(multiline.selected[0]?.entry.observation.statement, 'First line.\nSecond line.');

  await assert.rejects(
    previewRuntime(previewKernel(false, 'Prefer concise output.', 'unsafe\u0007terminal')).preview(65_536),
    /invalid memory observation/u,
  );
});
