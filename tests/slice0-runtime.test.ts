import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  equivalentTrace,
  type CapabilityContext,
  type InferenceEvidence,
  type OutcomeContract,
} from '../src/slice0/contracts.js';
import {
  allowAll,
  denyAll,
  explodingCapability,
  ScriptedPlanner,
  fixtureExecutionBudget,
  slice0Workspace,
  workspaceInventory,
} from '../src/slice0/fixtures.js';
import { TypeScriptConformanceRuntime } from '../src/slice0/runtime.js';

const inspectCall = { id: 'call-1', capabilityId: 'workspace.inventory', input: {} };

const outcomeContract = (capabilityId: string): OutcomeContract => ({
  schemaVersion: 1,
  requirements: [
    { id: 'required-capability', kind: 'capability_succeeded', capabilityId, minimumInvocations: 1 },
    { id: 'expected-output', kind: 'output_equals', expected: 'Workspace inspected.' },
  ],
});

const successfulRuntime = () => new TypeScriptConformanceRuntime({
  planner: new ScriptedPlanner([{ kind: 'call', call: inspectCall }, { kind: 'complete', output: 'Workspace inspected.' }]),
  approvalPolicy: allowAll,
  capabilities: [workspaceInventory],
});

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalJsonValue(record[key])]));
};

test('produces the Slice 0 golden trace for a successful read-only run', async () => {
  const artifact = await successfulRuntime().run({
    runId: 'golden-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
  });

  assert.equal(artifact.schemaVersion, 4);
  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.outcome.status, 'not_evaluated');
  assert.equal(artifact.output, 'Workspace inspected.');
  assert.deepEqual(
    artifact.events.map((event) => [event.sequence, event.type]),
    [
      [1, 'run.started'],
      [2, 'context.planned'],
      [3, 'capability.requested'],
      [4, 'approval.decided'],
      [5, 'capability.completed'],
      [6, 'outcome.assessed'],
      [7, 'run.completed'],
    ],
  );
  assert.deepEqual(artifact.contextPlan?.selected.map((item) => item.locator), [
    'run://task',
    'workspace://README.md',
    'workspace://package.json',
    'workspace://src/greeting.ts',
  ]);
});

test('binds approval and invocation to the same ordered prior capability context', async () => {
  const policyContexts: CapabilityContext[] = [];
  const invocationContexts: CapabilityContext[] = [];
  const firstCall = { id: 'call-context-1', capabilityId: 'fixture.context', input: { order: 1 } };
  const secondCall = { id: 'call-context-2', capabilityId: 'fixture.context', input: { order: 2 } };
  const runtime = new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([
      { kind: 'call', call: firstCall },
      { kind: 'call', call: secondCall },
      { kind: 'complete', output: 'Context inspected.' },
    ]),
    approvalPolicy: {
      async decide(_call, context) {
        policyContexts.push(context);
        return { outcome: 'allow', reason: 'Fixture permits context inspection.' };
      },
    },
    capabilities: [{
      id: 'fixture.context',
      async invoke(call, _snapshot, _signal, context) {
        invocationContexts.push(context);
        return {
          callId: call.id,
          success: true,
          content: `completed:${call.id}`,
          evidence: {
            schemaVersion: 1,
            kind: 'fixture.context.v1',
            data: { callId: call.id },
          },
        };
      },
    }],
  });
  const artifact = await runtime.run({
    runId: 'context-bound-run',
    task: 'Inspect capability context.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 3, executionBudget: fixtureExecutionBudget,
  });

  assert.equal(artifact.status, 'completed');
  assert.equal(policyContexts.length, 2);
  assert.deepEqual(invocationContexts, policyContexts);
  assert.deepEqual(policyContexts[0]?.priorObservations, []);
  const secondContext = policyContexts[1];
  assert.deepEqual(secondContext?.basis.priorCallIds, ['call-context-1']);
  assert.equal(secondContext?.priorObservations[0]?.call.id, 'call-context-1');
  assert.equal(secondContext?.priorObservations.some((observation) => observation.call.id === 'call-context-2'), false);
  const canonical = JSON.stringify(canonicalJsonValue(secondContext?.priorObservations));
  assert.equal(
    secondContext?.basis.priorObservationsSha256,
    createHash('sha256').update(canonical).digest('hex'),
  );
  const secondApproval = artifact.events.find((event) =>
    event.type === 'approval.decided' && event.callId === 'call-context-2');
  assert.equal(secondApproval?.type, 'approval.decided');
  if (secondApproval?.type !== 'approval.decided') throw new Error('Expected context-bound approval event.');
  assert.deepEqual(secondApproval.basis, secondContext?.basis);
  assert.equal(artifact.capabilityResults[1]?.evidence?.kind, 'fixture.context.v1');
});

test('fails closed on invalid structured capability evidence and duplicate call IDs', async () => {
  const invalidEvidence = await new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([
      { kind: 'call', call: inspectCall },
      { kind: 'complete', output: 'Invalid evidence handled.' },
    ]),
    approvalPolicy: allowAll,
    capabilities: [{
      id: 'workspace.inventory',
      async invoke(call) {
        return {
          callId: call.id,
          success: true,
          content: 'Untrusted result.',
          evidence: { schemaVersion: 2, kind: 'INVALID KIND', data: {} },
        } as never;
      },
    }],
  }).run({
    runId: 'invalid-evidence-run',
    task: 'Inspect invalid evidence.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
  });
  assert.equal(invalidEvidence.capabilityResults[0]?.success, false);
  assert.equal(invalidEvidence.capabilityResults[0]?.evidence, undefined);
  assert.match(invalidEvidence.capabilityResults[0]?.content ?? '', /schemaVersion must be 1/u);

  const duplicate = await new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([
      { kind: 'call', call: inspectCall },
      { kind: 'call', call: inspectCall },
    ]),
    approvalPolicy: allowAll,
    capabilities: [workspaceInventory],
  }).run({
    runId: 'duplicate-call-run',
    task: 'Reject duplicate calls.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
  });
  assert.equal(duplicate.status, 'failed');
  const terminal = duplicate.events.at(-1);
  assert.equal(terminal?.type, 'run.failed');
  if (terminal?.type !== 'run.failed') throw new Error('Expected duplicate-call failure.');
  assert.match(terminal.message, /already used/u);
});

test('fails closed before approval when prior capability context exceeds 4 MiB', async () => {
  let approvalCount = 0;
  const firstCall = { id: 'large-context-1', capabilityId: 'fixture.large-context', input: {} };
  const secondCall = { id: 'large-context-2', capabilityId: 'fixture.large-context', input: {} };
  const artifact = await new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([
      { kind: 'call', call: firstCall },
      { kind: 'call', call: secondCall },
    ]),
    approvalPolicy: {
      async decide() {
        approvalCount++;
        return { outcome: 'allow', reason: 'Fixture permits bounded context.' };
      },
    },
    capabilities: [{
      id: 'fixture.large-context',
      async invoke(call) {
        return {
          callId: call.id,
          success: true,
          content: 'x'.repeat((4 * 1_048_576) + 1),
        };
      },
    }],
  }).run({
    runId: 'large-context-run',
    task: 'Reject oversized prior context.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
  });
  assert.equal(artifact.status, 'failed');
  assert.equal(approvalCount, 1);
  assert.equal(artifact.capabilityResults.length, 1);
  const terminal = artifact.events.at(-1);
  assert.equal(terminal?.type, 'run.failed');
  if (terminal?.type !== 'run.failed') throw new Error('Expected prior-context failure.');
  assert.match(terminal.message, /Prior capability context exceeds the 4 MiB limit/u);
});

test('verifies only explicit caller-authored requirements', async () => {
  const verified = await successfulRuntime().run({
    runId: 'verified-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
    outcomeContract: outcomeContract('workspace.inventory'),
  });
  assert.equal(verified.status, 'completed');
  assert.equal(verified.outcome.status, 'verified');
  assert.deepEqual(verified.outcomeContract, outcomeContract('workspace.inventory'));
  assert.equal(verified.outcome.checks.every((check) => check.satisfied), true);
  assert.equal(verified.events.at(-2)?.type, 'outcome.assessed');

  const unmet = await successfulRuntime().run({
    runId: 'unmet-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
    outcomeContract: outcomeContract('workspace.read'),
  });
  assert.equal(unmet.status, 'completed');
  assert.equal(unmet.outcome.status, 'unmet');
  assert.equal(unmet.outcome.checks.find((check) => check.id === 'required-capability')?.satisfied, false);
});

test('uses Rust Unicode whitespace semantics for non-empty output checks', async () => {
  const runOutput = async (runId: string, output: string) => new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{ kind: 'complete', output }]),
    approvalPolicy: allowAll,
    capabilities: [],
  }).run({
    runId,
    task: 'Check output.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 1, executionBudget: fixtureExecutionBudget,
    outcomeContract: { schemaVersion: 1, requirements: [{ id: 'output', kind: 'output_non_empty' }] },
  });
  assert.equal((await runOutput('byte-order-mark-output', '\ufeff')).outcome.status, 'verified');
  assert.equal((await runOutput('next-line-output', '\u0085')).outcome.status, 'unmet');
});

test('rejects invalid outcome contracts before planner work', async () => {
  const artifact = await successfulRuntime().run({
    runId: 'invalid-outcome-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
    outcomeContract: { schemaVersion: 1, requirements: [] },
  });
  assert.equal(artifact.status, 'failed');
  assert.equal(artifact.outcome.status, 'not_evaluated');
  assert.equal(artifact.events.at(-1)?.type, 'run.failed');
  const terminal = artifact.events.at(-1);
  if (terminal?.type !== 'run.failed') throw new Error('Expected invalid outcome contract failure.');
  assert.equal(terminal.code, 'invalid_outcome_contract');
});

test('does not credit a capability result for a different call ID', async () => {
  const runtime = new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{ kind: 'call', call: inspectCall }, { kind: 'complete', output: 'Workspace inspected.' }]),
    approvalPolicy: allowAll,
    capabilities: [{
      id: 'workspace.inventory',
      async invoke() {
        return { callId: 'call-other', success: true, content: 'Mismatched fixture result.' };
      },
    }],
  });
  const artifact = await runtime.run({
    runId: 'mismatched-result-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
    outcomeContract: outcomeContract('workspace.inventory'),
  });
  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.outcome.status, 'unmet');
  assert.deepEqual(artifact.capabilityResults[0], {
    callId: 'call-1',
    success: false,
    content: 'Capability result call ID call-other does not match call-1.',
  });
});

test('produces an equivalent ordered trace for identical fixture inputs', async () => {
  const request = {
    runId: 'repeatable-run',
    task: 'Inspect the workspace.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2, executionBudget: fixtureExecutionBudget,
  };
  const first = await successfulRuntime().run(request);
  const second = await successfulRuntime().run(request);
  assert.equal(equivalentTrace(first.events, second.events), true);
  assert.deepEqual(first.contextPlan, second.contextPlan);
});

test('records a denied capability as inspectable tool evidence and continues', async () => {
  const runtime = new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{ kind: 'call', call: inspectCall }, { kind: 'complete', output: 'Denied request handled.' }]),
    approvalPolicy: denyAll,
    capabilities: [workspaceInventory],
  });
  const artifact = await runtime.run({
    runId: 'denied-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 200, maxTurns: 2, executionBudget: fixtureExecutionBudget,
  });

  assert.equal(artifact.status, 'completed');
  assert.match(artifact.capabilityResults[0]?.content ?? '', /deny: Fixture policy denied/);
  assert.deepEqual(artifact.events.map((event) => event.type), [
    'run.started', 'context.planned', 'capability.requested', 'approval.decided', 'capability.completed', 'outcome.assessed', 'run.completed',
  ]);
});

test('records a capability failure without corrupting the terminal run state', async () => {
  const runtime = new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([
      { kind: 'call', call: { id: 'call-explodes', capabilityId: 'fixture.explodes', input: {} } },
      { kind: 'complete', output: 'Failure was reported.' },
    ]),
    approvalPolicy: allowAll,
    capabilities: [explodingCapability],
  });
  const artifact = await runtime.run({
    runId: 'capability-failure-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 200, maxTurns: 2, executionBudget: fixtureExecutionBudget,
  });

  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.capabilityResults[0]?.success, false);
  assert.match(artifact.capabilityResults[0]?.content ?? '', /failed/);
});

test('stops transparently when the developer task cannot fit the context budget', async () => {
  const artifact = await successfulRuntime().run({
    runId: 'budget-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 1, maxTurns: 2, executionBudget: fixtureExecutionBudget,
  });

  assert.equal(artifact.status, 'budget_exhausted');
  assert.deepEqual(artifact.events.map((event) => event.type), ['run.started', 'context.planned', 'run.budget_exhausted']);
  assert.equal(artifact.capabilityResults.length, 0);
});

test('records cancellation before work and leaves a completed run unchanged after a later abort', async () => {
  const cancelled = new AbortController();
  cancelled.abort(new Error('Fixture cancelled before start.'));
  const cancelledArtifact = await successfulRuntime().run({
    runId: 'cancelled-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 200, maxTurns: 2, executionBudget: fixtureExecutionBudget, signal: cancelled.signal,
  });
  assert.equal(cancelledArtifact.status, 'cancelled');
  assert.deepEqual(cancelledArtifact.events.map((event) => event.type), ['run.cancelled']);

  const completed = await successfulRuntime().run({
    runId: 'completed-run', task: 'Inspect the workspace.', snapshot: slice0Workspace, contextBudgetBytes: 200, maxTurns: 2, executionBudget: fixtureExecutionBudget,
  });
  const afterCompletion = new AbortController();
  afterCompletion.abort(new Error('Too late.'));
  assert.equal(completed.status, 'completed');
  assert.equal(completed.events.at(-1)?.type, 'run.completed');
});

const measuredInference = (
  finishReason: 'stop' | 'tool_call',
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  outputCharacters: number,
): InferenceEvidence => ({
  schemaVersion: 1,
  requestId: `inference:${finishReason}:${inputTokens ?? 'missing'}:${outputTokens ?? 'missing'}`,
  provider: 'ollama',
  locality: 'local',
  model: 'fixture-model',
  finishReason,
  durationMs: 10,
  outputCharacters,
  toolCallCount: finishReason === 'tool_call' ? 1 : 0,
  usage: {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  },
  cost: { status: 'not_applicable' },
  routing: {
    requestedProvider: 'ollama',
    selectedProvider: 'ollama',
    requestedModel: 'fixture-model',
    selectedModel: 'fixture-model',
    fallbackUsed: false,
  },
});

test('stops before a capability call that would cross the independent capability budget', async () => {
  const secondCall = { ...inspectCall, id: 'call-2' };
  const artifact = await new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([
      { kind: 'call', call: inspectCall },
      { kind: 'call', call: secondCall },
    ]),
    approvalPolicy: allowAll,
    capabilities: [workspaceInventory],
  }).run({
    runId: 'capability-budget-run',
    task: 'Inspect twice.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 3,
    executionBudget: { ...fixtureExecutionBudget, maxCapabilityCalls: 1 },
  });

  assert.equal(artifact.status, 'execution_budget_exhausted');
  assert.equal(artifact.capabilityResults.length, 1);
  assert.equal(artifact.executionUsage.capabilityCalls, 1);
  assert.equal(artifact.events.filter((event) => event.type === 'capability.requested').length, 1);
  const terminal = artifact.events.at(-1);
  assert.deepEqual(terminal, {
    runId: 'capability-budget-run',
    sequence: 6,
    type: 'run.execution_budget_exhausted',
    dimension: 'capability_calls',
    limit: 1,
    observed: 2,
    usage: {
      schemaVersion: 1,
      capabilityCalls: 1,
      inferenceTurns: 0,
      reportedInputTokens: 0,
      reportedOutputTokens: 0,
    },
  });
});

test('allows an exact reported-token boundary and stops continuation after a crossing response', async () => {
  const exact = await new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{
      kind: 'complete',
      output: 'Done',
      inference: measuredInference('stop', 12, 3, 4),
    }]),
    approvalPolicy: allowAll,
    capabilities: [],
  }).run({
    runId: 'token-budget-exact',
    task: 'Finish.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 1,
    executionBudget: {
      ...fixtureExecutionBudget,
      maxReportedInputTokens: 12,
      maxReportedOutputTokens: 3,
    },
  });
  assert.equal(exact.status, 'completed');
  assert.deepEqual(exact.executionUsage, {
    schemaVersion: 1,
    capabilityCalls: 0,
    inferenceTurns: 1,
    reportedInputTokens: 12,
    reportedOutputTokens: 3,
  });

  const crossed = await new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{
      kind: 'complete',
      output: 'Done',
      inference: measuredInference('stop', 12, 3, 4),
    }]),
    approvalPolicy: allowAll,
    capabilities: [],
  }).run({
    runId: 'token-budget-crossed',
    task: 'Finish.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 1,
    executionBudget: { ...fixtureExecutionBudget, maxReportedInputTokens: 11 },
  });
  assert.equal(crossed.status, 'execution_budget_exhausted');
  assert.equal(crossed.output, undefined);
  const terminal = crossed.events.at(-1);
  assert.equal(terminal?.type, 'run.execution_budget_exhausted');
  if (terminal?.type !== 'run.execution_budget_exhausted') throw new Error('Expected execution budget exhaustion.');
  assert.equal(terminal.dimension, 'reported_input_tokens');
  assert.equal(terminal.limit, 11);
  assert.equal(terminal.observed, 12);

  const outputCrossed = await new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{
      kind: 'complete',
      output: 'Done',
      inference: measuredInference('stop', 12, 3, 4),
    }]),
    approvalPolicy: allowAll,
    capabilities: [],
  }).run({
    runId: 'output-token-budget-crossed',
    task: 'Finish.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 1,
    executionBudget: { ...fixtureExecutionBudget, maxReportedOutputTokens: 2 },
  });
  assert.equal(outputCrossed.status, 'execution_budget_exhausted');
  const outputTerminal = outputCrossed.events.at(-1);
  assert.equal(outputTerminal?.type, 'run.execution_budget_exhausted');
  if (outputTerminal?.type !== 'run.execution_budget_exhausted') throw new Error('Expected execution budget exhaustion.');
  assert.equal(outputTerminal.dimension, 'reported_output_tokens');
  assert.equal(outputTerminal.limit, 2);
  assert.equal(outputTerminal.observed, 3);
});

test('fails closed when an enabled token ceiling cannot be measured', async () => {
  const artifact = await new TypeScriptConformanceRuntime({
    planner: new ScriptedPlanner([{
      kind: 'complete',
      output: 'Done',
      inference: measuredInference('stop', undefined, 3, 4),
    }]),
    approvalPolicy: allowAll,
    capabilities: [],
  }).run({
    runId: 'token-usage-missing',
    task: 'Finish.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 1,
    executionBudget: fixtureExecutionBudget,
  });
  assert.equal(artifact.status, 'failed');
  assert.equal(artifact.executionUsage.inferenceTurns, 1);
  const terminal = artifact.events.at(-1);
  assert.equal(terminal?.type === 'run.failed' ? terminal.code : undefined, 'inference_usage_unavailable');
});

test('rejects an unsupported execution-budget contract before planning', async () => {
  const artifact = await successfulRuntime().run({
    runId: 'invalid-execution-budget',
    task: 'Inspect.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 2,
    executionBudget: { ...fixtureExecutionBudget, schemaVersion: 2 as 1 },
  });
  assert.equal(artifact.status, 'failed');
  assert.deepEqual(artifact.events.map((event) => event.type), ['run.started', 'run.failed']);
  const terminal = artifact.events.at(-1);
  assert.equal(terminal?.type === 'run.failed' ? terminal.code : undefined, 'invalid_execution_budget');
});
test('rejects a direct caller turn bound outside the kernel contract', async () => {
  const artifact = await successfulRuntime().run({
    runId: 'invalid-turn-limit',
    task: 'Inspect.',
    snapshot: slice0Workspace,
    contextBudgetBytes: 200,
    maxTurns: 0,
    executionBudget: fixtureExecutionBudget,
  });
  assert.equal(artifact.status, 'failed');
  const terminal = artifact.events.at(-1);
  assert.equal(terminal?.type === 'run.failed' ? terminal.code : undefined, 'invalid_turn_limit');
});