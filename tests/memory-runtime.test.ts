import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { RustMemoryRuntime } from '../src/memory/runtime.js';

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
