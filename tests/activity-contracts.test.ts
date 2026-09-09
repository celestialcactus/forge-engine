import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  activityAuthorities,
  activityKinds,
  activityKindsByAuthority,
  configuredActivityModes,
  resolvedActivityModes,
  terminalActivityLimits,
  terminalActivitySchemaVersion,
  type ActivityAuthority,
  type ActivityKind,
  type TerminalActivityEnvelope,
} from '../src/activity/contracts.js';

interface ActivityTranscriptFixture {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly resolvedMode: string;
  readonly envelopes: readonly TerminalActivityEnvelope[];
  readonly expectedTranscript: readonly string[];
  readonly expectedAuthorityTrace: readonly string[];
}

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/activity/implementing-developer-transcript.json', import.meta.url),
  'utf8',
)) as ActivityTranscriptFixture;

const allowedKinds = (authority: ActivityAuthority): readonly ActivityKind[] =>
  activityKindsByAuthority[authority] as readonly ActivityKind[];

test('freezes the complete activity mode, authority, kind, and limit vocabulary', () => {
  assert.equal(terminalActivitySchemaVersion, 1);
  assert.deepEqual(configuredActivityModes, ['auto', 'detailed', 'compact', 'off']);
  assert.deepEqual(resolvedActivityModes, ['detailed', 'compact', 'off']);
  assert.deepEqual(activityAuthorities, [
    'canonical_run',
    'provider_reported',
    'assistant_commentary',
    'presentation_derived',
  ]);
  assert.deepEqual(activityKinds, [
    'working',
    'update',
    'run',
    'context',
    'evidence',
    'action',
    'result',
    'approval',
    'verify',
    'warning',
  ]);
  assert.deepEqual(terminalActivityLimits, {
    providerReasoningScalarValuesPerRequest: 65_536,
    assistantCommentaryScalarValuesPerRequest: 16_384,
    renderedLineCharacters: 1_024,
    capabilityResultPreviewBytes: 4_096,
  });
});

test('reserves execution claims for canonical run activity', () => {
  assert.deepEqual(activityKindsByAuthority.provider_reported, ['working']);
  assert.deepEqual(activityKindsByAuthority.assistant_commentary, ['update']);
  assert.deepEqual(activityKindsByAuthority.presentation_derived, ['run', 'warning']);
  for (const kind of ['action', 'result', 'approval', 'verify'] as const) {
    assert.equal(allowedKinds('canonical_run').includes(kind), true);
    assert.equal(allowedKinds('provider_reported').includes(kind), false);
    assert.equal(allowedKinds('assistant_commentary').includes(kind), false);
    assert.equal(allowedKinds('presentation_derived').includes(kind), false);
  }
});

test('golden transcript covers all four sources with valid, non-overlapping identity', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.name, 'implementing-developer-transcript');
  assert.equal(fixture.resolvedMode, 'detailed');
  assert.deepEqual(
    [...new Set(fixture.envelopes.map(({ authority }) => authority))].sort(),
    [...activityAuthorities].sort(),
  );

  for (const [index, envelope] of fixture.envelopes.entries()) {
    assert.equal(envelope.schemaVersion, terminalActivitySchemaVersion);
    assert.equal(envelope.ordinal, index + 1);
    assert.ok(activityKinds.includes(envelope.kind));
    assert.ok(allowedKinds(envelope.authority).includes(envelope.kind));
    assert.ok(envelope.message.length > 0);
    assert.equal(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u001B]/u.test(envelope.message), false);

    if (envelope.authority === 'canonical_run') {
      assert.equal(envelope.runId, 'run:fixture');
      assert.ok(Number.isSafeInteger(envelope.runSequence) && (envelope.runSequence ?? 0) > 0);
      assert.equal(envelope.requestId, undefined);
      assert.equal(envelope.reasoningFormat, undefined);
      assert.equal(envelope.assistantPhase, undefined);
    } else if (envelope.authority === 'provider_reported') {
      assert.equal(envelope.requestId, 'inference:one');
      assert.equal(envelope.provider, 'openai');
      assert.equal(envelope.model, 'fixture-model');
      assert.equal(envelope.reasoningFormat, 'summary');
      assert.equal(envelope.runId, undefined);
      assert.equal(envelope.assistantPhase, undefined);
    } else if (envelope.authority === 'assistant_commentary') {
      assert.match(envelope.requestId ?? '', /^inference:/u);
      assert.equal(envelope.provider, 'openai');
      assert.equal(envelope.model, 'fixture-model');
      assert.equal(envelope.assistantPhase, 'commentary');
      assert.equal(envelope.runId, undefined);
      assert.equal(envelope.reasoningFormat, undefined);
    } else {
      assert.equal(envelope.runId, undefined);
      assert.equal(envelope.requestId, undefined);
      assert.equal(envelope.reasoningFormat, undefined);
      assert.equal(envelope.assistantPhase, undefined);
    }
  }
});

test('golden transcript keeps human labels and source trace deterministic', () => {
  assert.deepEqual(
    fixture.envelopes.map(({ kind, message }) => `${kind.padEnd(10)}${message}`),
    fixture.expectedTranscript,
  );
  assert.deepEqual(
    fixture.envelopes.map(({ ordinal, authority, kind }) => `${ordinal} ${authority} ${kind}`),
    fixture.expectedAuthorityTrace,
  );
});
