import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createRunCancellation, LiveCliPresenter } from '../src/live-cli.js';
import type { RunArtifact, RunEvent } from '../src/slice0/contracts.js';

const inferenceEvidence = {
  schemaVersion: 1,
  requestId: 'inference:live',
  provider: 'ollama',
  locality: 'local',
  model: 'fixture-model',
  finishReason: 'stop',
  durationMs: 12,
  outputCharacters: 11,
  toolCallCount: 0,
  usage: { inputTokens: 8, outputTokens: 3 },
  cost: { status: 'not_applicable' },
  routing: {
    requestedProvider: 'ollama',
    selectedProvider: 'ollama',
    requestedModel: 'fixture-model',
    selectedModel: 'fixture-model',
    fallbackUsed: false,
  },
} as const;

test('streams human text while presenting canonical run status and a terminal evidence summary', () => {
  let stdout = '';
  let stderr = '';
  const presenter = new LiveCliPresenter({
    stdout: (chunk) => { stdout += chunk; },
    stderr: (chunk) => { stderr += chunk; },
  });
  const runEvents: RunEvent[] = [
    {
      runId: 'run:live',
      sequence: 1,
      type: 'run.started',
      task: 'Inspect.',
      snapshotId: 'workspace:live',
    },
    {
      runId: 'run:live',
      sequence: 2,
      type: 'context.planned',
      plan: {
        id: 'context:live',
        budgetBytes: 100,
        selected: [{ id: 'task', kind: 'user.task', locator: 'user.task', bytes: 8, reason: 'Developer task.' }],
        omitted: [],
      },
    },
    {
      runId: 'run:live',
      sequence: 3,
      type: 'inference.completed',
      evidence: inferenceEvidence,
    },
    {
      runId: 'run:live',
      sequence: 4,
      type: 'outcome.assessed',
      assessment: {
        schemaVersion: 1,
        status: 'not_evaluated',
        reason: 'No caller-authored outcome contract was supplied.',
        checks: [],
      },
    },
    {
      runId: 'run:live',
      sequence: 5,
      type: 'run.completed',
      output: 'Forge ready',
    },
  ];
  presenter.onRunEvent(runEvents[0]!);
  presenter.onRunEvent(runEvents[1]!);
  presenter.onInferenceEvent({
    requestId: 'inference:live',
    provider: 'ollama',
    model: 'fixture-model',
    event: { type: 'text.delta', text: 'Forge' },
  });
  presenter.onInferenceEvent({
    requestId: 'inference:live',
    provider: 'ollama',
    model: 'fixture-model',
    event: { type: 'text.delta', text: ' ready' },
  });
  presenter.onInferenceEvent({
    requestId: 'inference:live',
    provider: 'ollama',
    model: 'fixture-model',
    event: { type: 'response.completed', finishReason: 'stop' },
  });
  presenter.onRunEvent(runEvents[2]!);
  presenter.onRunEvent(runEvents[3]!);
  const contextEvent = runEvents[1];
  if (contextEvent?.type !== 'context.planned') throw new Error('Context event fixture is missing.');
  const outcomeEvent = runEvents[3];
  if (outcomeEvent?.type !== 'outcome.assessed') throw new Error('Outcome event fixture is missing.');
  const artifact: RunArtifact = {
    schemaVersion: 3,
    runId: 'run:live',
    task: 'Inspect.',
    snapshot: { id: 'workspace:live', rootLabel: 'fixture', files: [] },
    status: 'completed',
    contextPlan: contextEvent.plan,
    capabilityResults: [],
    inferenceEvidence: [inferenceEvidence],
    outcome: outcomeEvent.assessment,
    output: 'Forge ready',
    events: runEvents,
  };
  presenter.printSummary(artifact);

  assert.equal(stdout, 'assistant> Forge ready\n');
  assert.match(stderr, /\[forge\] run run:live started; snapshot=workspace:live/u);
  assert.match(stderr, /\[forge\] context selected=1 omitted=0 bytes=8\/100/u);
  assert.match(stderr, /\[forge\] inference ollama\/fixture-model stop 12ms in=8 out=3/u);
  assert.match(stderr, /\[forge\] evidence summary/u);
  assert.match(stderr, /run=run:live status=completed/u);
  assert.match(stderr, /outcome=not_evaluated checks=0/u);
  assert.match(stderr, /inference turns=1 tokens input=8 output=3/u);
  assert.equal(stderr.includes('Forge ready'), false);
});

test('prints a buffered assistant answer when the caller withheld live deltas', () => {
  let stdout = '';
  const presenter = new LiveCliPresenter({
    stdout: (chunk) => { stdout += chunk; },
    stderr: () => {},
  });
  presenter.printAssistantOutput('Evidence-backed answer.');
  assert.equal(stdout, 'assistant> Evidence-backed answer.\n');
});

test('shows a bounded single-line capability failure reason', () => {
  let stderr = '';
  const presenter = new LiveCliPresenter({
    stdout: () => {},
    stderr: (chunk) => { stderr += chunk; },
  });
  presenter.onRunEvent({
    runId: 'run:failure',
    sequence: 1,
    type: 'capability.completed',
    result: {
      callId: 'call:failure',
      success: false,
      content: 'invalid input\n' + 'x'.repeat(500),
    },
  });
  assert.match(stderr, /capability failed: call:failure - invalid input x+/u);
  assert.equal(stderr.includes('\nxxxxxxxx'), false);
  assert.ok(stderr.length < 400);
});

test('turns the first SIGINT into a cancellable run signal and removes the listener', () => {
  const interrupts = new EventEmitter();
  const cancellation = createRunCancellation(10_000, interrupts);
  assert.equal(interrupts.listenerCount('SIGINT'), 1);
  interrupts.emit('SIGINT');
  assert.equal(cancellation.signal.aborted, true);
  assert.equal(cancellation.source, 'sigint');
  assert.match(String(cancellation.signal.reason), /Forge run cancelled by SIGINT/u);
  cancellation.dispose();
  assert.equal(interrupts.listenerCount('SIGINT'), 0);
});

test('turns the configured deadline into an attributable cancellation', async () => {
  const interrupts = new EventEmitter();
  const cancellation = createRunCancellation(5, interrupts);
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  assert.equal(cancellation.signal.aborted, true);
  assert.equal(cancellation.source, 'timeout');
  assert.match(String(cancellation.signal.reason), /timed out after 5ms/u);
  cancellation.dispose();
});
