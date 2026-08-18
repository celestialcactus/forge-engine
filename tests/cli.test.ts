import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const fixtureRoot = resolve('tests/fixtures/slice1-workspace');
const cli = [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli.ts')];

test('product CLI fails closed instead of selecting the TypeScript conformance runtime', () => {
  const missingKernel = join(fixtureRoot, 'missing-forge-kernel');
  const environment = { ...process.env, FORGE_KERNEL_BINARY: missingKernel };
  const run = spawnSync(process.execPath, [
    ...cli,
    'inspect',
    '--workspace',
    fixtureRoot,
    '--json',
  ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /kernel path is not an executable file/u);
  assert.doesNotMatch(run.stderr, /typescript[_ -]conformance/iu);

  const doctor = spawnSync(process.execPath, [
    ...cli,
    'doctor',
    '--workspace',
    fixtureRoot,
    '--json',
  ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
  assert.notEqual(doctor.status, 0);
  const report = JSON.parse(doctor.stdout) as {
    readonly ok: boolean;
    readonly runtime: string;
    readonly kernel: { readonly ready: boolean; readonly path: string | null; readonly message: string };
    readonly approval: { readonly profile: string; readonly source: string; readonly decisionAuthority: string };
    readonly executionDefaults: {
      readonly schemaVersion: number;
      readonly maxCapabilityCalls: number;
      readonly maxReportedInputTokens: number;
      readonly maxReportedOutputTokens: number;
    };
  };
  assert.equal(report.ok, false);
  assert.equal(report.runtime, 'unavailable');
  assert.equal(report.kernel.ready, false);
  assert.equal(report.kernel.path, null);
  assert.match(report.kernel.message, /not an executable file/u);
  assert.deepEqual(report.approval, {
    profile: 'developer',
    source: 'default',
    decisionAuthority: 'rust-kernel',
    scope: 'registered capabilities; governed mutations retain exact-change approval',
  });
  assert.deepEqual(report.executionDefaults, {
    schemaVersion: 1,
    maxCapabilityCalls: 6,
    maxReportedInputTokens: 262_144,
    maxReportedOutputTokens: 32_768,
  });
});

test('does not expose superseded candidate commands or fake task execution', () => {
  const environment = { ...process.env, FORGE_KERNEL_BINARY: join(fixtureRoot, 'missing-forge-kernel') };
  const help = spawnSync(process.execPath, [...cli, 'help'], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment,
  });
  assert.equal(help.status, 0);
  assert.doesNotMatch(help.stdout, /forge candidate/u);

  const optionHelp = spawnSync(process.execPath, [...cli, '--help'], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment,
  });
  assert.equal(optionHelp.status, 0);
  assert.match(optionHelp.stdout, /With no route flags, Forge auto-discovers/u);
  assert.match(optionHelp.stdout, /approval-profile <developer\|review\|locked>/u);

  const invalidProfile = spawnSync(process.execPath, [...cli, 'help', '--approval-profile', 'yolo'], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment,
  });
  assert.notEqual(invalidProfile.status, 0);
  assert.match(invalidProfile.stderr, /developer, review, or locked/u);

  const reviewJson = spawnSync(process.execPath, [
    ...cli,
    'run',
    'fixture task',
    '--provider',
    'ollama',
    '--model',
    'fixture-model',
    '--approval-profile',
    'review',
    '--json',
  ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
  assert.notEqual(reviewJson.status, 0);
  assert.match(reviewJson.stderr, /cannot be combined.*consent prompts/iu);

  const interactive = spawnSync(process.execPath, cli, {
    encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment,
  });
  assert.notEqual(interactive.status, 0);
  assert.match(interactive.stderr, /^\[forge\] .*kernel path is not an executable file/mu);
  assert.doesNotMatch(interactive.stderr, /\n\s+at /u);
  assert.doesNotMatch(interactive.stdout, /Core change flow/u);

  const candidate = spawnSync(process.execPath, [...cli, 'candidate', 'inspect', 'legacy-id'], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment,
  });
  assert.notEqual(candidate.status, 0);
  assert.match(candidate.stderr, /Unknown Forge command: candidate/u);
  assert.doesNotMatch(candidate.stdout, /Legacy usage/u);

  const run = spawnSync(process.execPath, [...cli, 'run', 'pretend to execute this task'], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment,
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /explicit --provider/u);
  assert.doesNotMatch(run.stdout, /totalFiles/u);
});

test('forge onboard separates accepted release contracts from remaining evidence gates', () => {
  const environment = { ...process.env, FORGE_KERNEL_BINARY: join(fixtureRoot, 'missing-forge-kernel') };
  const result = spawnSync(process.execPath, [
    ...cli,
    'onboard',
    '--approval-profile',
    'review',
    '--workspace',
    fixtureRoot,
    '--json',
  ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(result.stdout) as {
    readonly runtimeReady: boolean;
    readonly releaseReady: boolean;
    readonly containment: { readonly profile: string; readonly enforced: boolean; readonly disclosure: string };
    readonly configuration: { readonly precedenceStatus: string; readonly disclosure: string };
    readonly releaseBlockers: readonly string[];
  };

  assert.equal(report.runtimeReady, false);
  assert.equal(report.releaseReady, false);
  assert.equal(report.containment.profile, 'trusted');
  assert.equal(report.containment.enforced, false);
  assert.match(report.containment.disclosure, /does not enforce an accepted OS sandbox/u);
  assert.equal(report.configuration.precedenceStatus, 'contract_accepted_implementation_pending');
  assert.match(report.configuration.disclosure, /managed ceilings, explicit CLI/u);
  assert.match(report.configuration.disclosure, /policy values may only tighten/u);
  assert.deepEqual(report.releaseBlockers, [
    'Rights attestation for existing contributions',
    'Public artifact signing and provenance',
    'Configuration precedence implementation and conformance',
  ]);
});
