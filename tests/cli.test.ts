import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);
const fixtureRoot = resolve('tests/fixtures/slice1-workspace');

test('forge run preserves the supplied developer task in the accepted run artifact', async () => {
  const task = 'Explain the fixture workspace deterministically.';
  const { stdout } = await execFileAsync(process.execPath, [
    resolve('node_modules/tsx/dist/cli.mjs'),
    resolve('src/cli.ts'),
    'run',
    task,
    '--workspace',
    fixtureRoot,
    '--json',
  ], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  const payload = JSON.parse(stdout) as {
    readonly status: string;
    readonly events: Array<{ readonly type: string; readonly task?: string }>;
  };

  assert.equal(payload.status, 'completed');
  assert.equal(payload.events.find((event) => event.type === 'run.started')?.task, task);
});
