import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { MemoryAutoSaveController } from '../../src/memory/autosave.js';
import { repositoryMemoryScope } from '../../src/memory/commands.js';
import { RustMemoryRuntime } from '../../src/memory/runtime.js';

const execute = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const cliPath = join(repositoryRoot, 'src', 'cli.ts');
const kernelPath = join(
  repositoryRoot,
  'target',
  'debug',
  process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel',
);

const runMemory = async (
  engineRoot: string,
  args: readonly string[],
): Promise<Record<string, unknown>> => {
  const environment: NodeJS.ProcessEnv = { ...process.env, FORGE_KERNEL_BINARY: kernelPath };
  delete environment.FORGE_DEBUG;
  const { stdout, stderr } = await execute(
    process.execPath,
    [
      '--import',
      'tsx',
      cliPath,
      'memory',
      ...args,
      '--workspace',
      repositoryRoot,
      '--engine-root',
      engineRoot,
      '--json',
    ],
    {
      cwd: repositoryRoot,
      env: environment,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 8 * 1_048_576,
    },
  );
  assert.equal(stderr, '');
  return JSON.parse(stdout) as Record<string, unknown>;
};

test('source CLI remembers across restart, corrects, restores, and erases prior versions', async () => {
  const engineRoot = await mkdtemp(join(tmpdir(), 'forge-memory-product-'));
  const alpha = 'Tracer alpha: Rust is authoritative and TypeScript orchestrates.';
  const beta = 'Tracer beta: Rust validates authority and TypeScript orchestrates UX.';
  const gamma = 'Tracer gamma: Rust validates lifecycle; TypeScript remains orchestration only.';
  try {
    const remembered = await runMemory(engineRoot, ['remember', alpha]);
    assert.equal(remembered.ok, true);
    assert.equal(remembered.operation, 'remember');

    const afterRestart = await runMemory(engineRoot, ['explain', 'Tracer alpha']);
    assert.equal(afterRestart.ok, true);
    assert.equal(afterRestart.retrievalActive, false);
    assert.equal(
      ((afterRestart.entry as { observation: { statement: string } }).observation.statement),
      alpha,
    );

    const corrected = await runMemory(engineRoot, [
      'correct',
      'Tracer alpha',
      '--replacement',
      beta,
    ]);
    assert.equal(corrected.ok, true);
    assert.equal(
      ((corrected.result as { recoveryCount: number }).recoveryCount),
      1,
    );

    const history = await runMemory(engineRoot, ['history', 'Tracer alpha']);
    const historyMatches = history.matches as readonly {
      readonly observation: { readonly statement: string };
    }[];
    assert.equal(historyMatches.length, 1);
    assert.equal(historyMatches[0]?.observation.statement, alpha);

    const restored = await runMemory(engineRoot, ['restore', 'Tracer alpha']);
    assert.equal(
      ((restored.result as { activeObservation: { statement: string } }).activeObservation.statement),
      alpha,
    );

    const erased = await runMemory(engineRoot, [
      'correct',
      'Tracer alpha',
      '--replacement',
      gamma,
      '--erase-previous',
    ]);
    assert.equal((erased.result as { recoveryCount: number }).recoveryCount, 0);
    assert.equal((erased.result as { compacted: boolean }).compacted, true);

    const stateText = await readTree(engineRoot);
    assert.ok(stateText.includes(gamma));
    assert.ok(!stateText.includes(alpha));
    assert.ok(!stateText.includes(beta));
  } finally {
    await rm(engineRoot, { recursive: true, force: true });
  }
});

test('CLI autosave grant drives the same Rust-backed conversational capture and purge-style undo', async () => {
  const engineRoot = await mkdtemp(join(tmpdir(), 'forge-memory-autosave-'));
  const statement = 'I prefer concise test output.';
  try {
    const initial = await runMemory(engineRoot, ['autosave', 'status']);
    assert.equal(initial.mode, 'ask');

    const enabled = await runMemory(engineRoot, ['autosave', 'auto']);
    assert.equal(enabled.mode, 'auto');
    const grant = enabled.grant as { readonly grantId: string; readonly mode: string };
    assert.equal(grant.mode, 'auto');

    const grantScope = await repositoryMemoryScope(repositoryRoot);
    const runtime = new RustMemoryRuntime({
      kernelPath,
      engineRoot,
      workspaceRoot: repositoryRoot,
      scope: { kind: 'developer', actorId: 'developer:local' },
      actorId: 'developer:local',
    });
    const controller = new MemoryAutoSaveController(runtime, grantScope);
    assert.equal((await controller.state()).grant?.grantId, grant.grantId);
    let approvalCalled = false;
    const captured = await controller.captureDirectInput(statement, async () => {
      approvalCalled = true;
      return false;
    });
    assert.equal(approvalCalled, false);
    assert.equal(captured.kind, 'remembered');
    if (captured.kind !== 'remembered' || captured.receipt === undefined) {
      assert.fail('automatic capture must return an undo receipt');
    }
    assert.equal((await runtime.inspect(false)).activeCount, 1);
    const foundPreference = await runMemory(engineRoot, ['find', 'concise test output']);
    const preferenceMatches = foundPreference.matches as readonly {
      readonly observation: { readonly statement: string; readonly scope: { readonly kind: string } };
    }[];
    assert.equal(preferenceMatches.length, 1);
    assert.equal(preferenceMatches[0]?.observation.statement, statement);
    assert.equal(preferenceMatches[0]?.observation.scope.kind, 'developer');
    const explainedPreference = await runMemory(engineRoot, ['explain', 'concise test output']);
    assert.equal(
      ((explainedPreference.entry as { observation: { statement: string } }).observation.statement),
      statement,
    );

    await controller.undo(captured.receipt);
    const restarted = new RustMemoryRuntime({
      kernelPath,
      engineRoot,
      workspaceRoot: repositoryRoot,
      scope: { kind: 'developer', actorId: 'developer:local' },
      actorId: 'developer:local',
    });
    const afterUndo = await restarted.inspect(true);
    assert.equal(afterUndo.activeCount, 0);
    assert.equal(afterUndo.recoveryCount, 0);
    assert.ok(!await readTree(engineRoot).then((state) => state.includes(statement)));

    const disabled = await runMemory(engineRoot, ['autosave', 'off']);
    assert.equal(disabled.mode, 'off');
  } finally {
    await rm(engineRoot, { recursive: true, force: true });
  }
});

const readTree = async (root: string): Promise<string> => {
  const chunks: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) chunks.push(await readFile(path, 'utf8'));
    }
  };
  await visit(root);
  return chunks.join('\n');
};
