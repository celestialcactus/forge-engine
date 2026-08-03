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
    'run',
    'Inspect the fixture.',
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
  };
  assert.equal(report.ok, false);
  assert.equal(report.runtime, 'unavailable');
  assert.equal(report.kernel.ready, false);
  assert.equal(report.kernel.path, null);
  assert.match(report.kernel.message, /not an executable file/u);
});
