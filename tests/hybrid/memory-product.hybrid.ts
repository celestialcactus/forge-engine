import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
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

const coveredEnvironmentVariables = [
  'FORGE_DEFAULT_PROVIDER',
  'FORGE_DEFAULT_MODEL',
  'FORGE_ENGINE_ROOT',
  'FORGE_OLLAMA_URL',
  'FORGE_OLLAMA_CONTEXT_TOKENS',
  'FORGE_OPENAI_BASE_URL',
  'FORGE_APPROVAL_PROFILE',
  'FORGE_MAX_TURNS',
  'FORGE_MAX_CAPABILITY_CALLS',
  'FORGE_MAX_INPUT_TOKENS',
  'FORGE_MAX_OUTPUT_TOKENS',
  'FORGE_TIMEOUT_MS',
  'OPENAI_API_KEY',
] as const;

const runMemory = async (
  engineRoot: string,
  args: readonly string[],
  workspaceRoot = repositoryRoot,
  additions: Readonly<Record<string, string>> = {},
): Promise<Record<string, unknown>> => {
  const environment: NodeJS.ProcessEnv = { ...process.env, FORGE_KERNEL_BINARY: kernelPath };
  for (const variable of coveredEnvironmentVariables) delete environment[variable];
  environment.HOME = join(engineRoot, 'isolated-home');
  environment.USERPROFILE = environment.HOME;
  Object.assign(environment, additions);
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
      workspaceRoot,
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

const runMemoryFailure = async (
  engineRoot: string,
  args: readonly string[],
  workspaceRoot = repositoryRoot,
  additions: Readonly<Record<string, string>> = {},
): Promise<Record<string, unknown>> => {
  try {
    await runMemory(engineRoot, args, workspaceRoot, additions);
    assert.fail('memory command unexpectedly succeeded');
  } catch (error) {
    const failure = error as { readonly stderr?: string };
    assert.ok(typeof failure.stderr === 'string' && failure.stderr.length > 0);
    return JSON.parse(failure.stderr) as Record<string, unknown>;
  }
};

test('source CLI preview is exact-scope, deterministic, bounded, and provider-free', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-memory-preview-'));
  const engineRoot = join(root, 'engine');
  const firstRepository = join(root, 'repository-a');
  const secondRepository = join(root, 'repository-b');
  const repositoryDecision = 'Preview tracer: Rust owns final memory admission.';
  const developerPreference = 'I prefer concise explanations.';
  const forgotten = 'Preview forgotten content must stay out of context.';
  const crossRepository = 'Preview cross-repository content must stay isolated.';
  let providerRequests = 0;
  const provider = createServer((_request, response) => {
    providerRequests += 1;
    response.writeHead(500).end();
  });
  try {
    await mkdir(firstRepository, { recursive: true });
    await mkdir(secondRepository, { recursive: true });
    await new Promise<void>((resolveListen, rejectListen) => {
      provider.once('error', rejectListen);
      provider.listen(0, '127.0.0.1', () => resolveListen());
    });
    const address = provider.address();
    if (address === null || typeof address === 'string') throw new Error('Preview provider fixture did not bind TCP.');
    const routeEnvironment = {
      FORGE_DEFAULT_PROVIDER: 'ollama',
      FORGE_DEFAULT_MODEL: 'must-not-run',
      FORGE_OLLAMA_URL: `http://127.0.0.1:${String(address.port)}`,
    };

    await runMemory(engineRoot, ['remember', repositoryDecision], firstRepository, routeEnvironment);
    await runMemory(engineRoot, ['remember', forgotten], firstRepository, routeEnvironment);
    await runMemory(engineRoot, ['forget', 'Preview forgotten content'], firstRepository, routeEnvironment);
    await runMemory(engineRoot, ['remember', crossRepository], secondRepository, routeEnvironment);

    const firstScope = await repositoryMemoryScope(firstRepository);
    const developerRuntime = new RustMemoryRuntime({
      kernelPath,
      engineRoot,
      workspaceRoot: firstRepository,
      scope: { kind: 'developer', actorId: 'developer:local' },
      actorId: 'developer:local',
    });
    const autosave = new MemoryAutoSaveController(developerRuntime, firstScope);
    await autosave.setMode('auto');
    const capture = await autosave.captureDirectInput(developerPreference, async () => false);
    assert.equal(capture.kind, 'remembered');

    const first = await runMemory(engineRoot, ['preview'], firstRepository, routeEnvironment);
    const second = await runMemory(engineRoot, ['preview'], firstRepository, routeEnvironment);
    const preview = first.preview as {
      readonly previewId: string;
      readonly candidateCount: number;
      readonly selected: readonly { readonly entry: { readonly observation: { readonly statement: string } } }[];
      readonly scopeHeads: readonly { readonly scope: { readonly kind: string } }[];
      readonly forgottenExcludedCount: number;
      readonly retrievalActive: boolean;
      readonly plannerInjection: boolean;
      readonly providerWorkPerformed: boolean;
    };
    const serialized = JSON.stringify(first);
    assert.equal(first.operation, 'preview');
    const secondPreview = second.preview as {
      readonly selected: readonly unknown[];
      readonly omitted: readonly unknown[];
      readonly scopeHeads: readonly unknown[];
    };
    assert.deepEqual(secondPreview.selected, preview.selected);
    assert.deepEqual(secondPreview.omitted, (first.preview as { readonly omitted: readonly unknown[] }).omitted);
    assert.deepEqual(secondPreview.scopeHeads, preview.scopeHeads);
    assert.deepEqual(
      preview.selected.map((entry) => entry.entry.observation.statement),
      [repositoryDecision, developerPreference],
    );
    assert.equal(preview.candidateCount, 2);
    assert.deepEqual(preview.scopeHeads.map((head) => head.scope.kind).sort(), ['developer', 'repository']);
    assert.equal(preview.forgottenExcludedCount, 1);
    assert.equal(preview.retrievalActive, false);
    assert.equal(preview.plannerInjection, false);
    assert.equal(preview.providerWorkPerformed, false);
    assert.equal(serialized.includes('ledgerHeadSha256'), false);
    assert.equal(serialized.includes(forgotten), false);
    assert.equal(serialized.includes(crossRepository), false);

    const tiny = await runMemory(engineRoot, ['preview', '--max-bytes', '1'], firstRepository, routeEnvironment);
    const tinyPreview = tiny.preview as {
      readonly selected: readonly unknown[];
      readonly omitted: readonly { readonly reason: string }[];
    };
    assert.deepEqual(tinyPreview.selected, []);
    assert.deepEqual(tinyPreview.omitted.map((entry) => entry.reason), ['budget_exceeded', 'budget_exceeded']);

    for (const invalidArguments of [
      ['preview', '--replacement', 'ignored'],
      ['preview', '--erase-previous'],
      ['preview', '--yes'],
      ['preview', '--max-turns', '2'],
      ['preview', '--max-bytes', '1e3'],
      ['preview', '--max-bytes', '0x100'],
      ['preview', '--max-bytes', '1', '--max-bytes', '2'],
    ] as const) {
      const failure = await runMemoryFailure(engineRoot, invalidArguments);
      assert.equal((failure.error as { readonly code: string }).code, 'memory_command_failed');
    }
    const missingKernelGrammarFailure = await runMemoryFailure(
      engineRoot,
      ['preview', '--max-bytes', '1e3'],
      firstRepository,
      { FORGE_KERNEL_BINARY: join(root, 'kernel-must-not-be-probed') },
    );
    assert.match(
      (missingKernelGrammarFailure.error as { readonly message: string }).message,
      /base-10 integer/u,
    );
    assert.equal(providerRequests, 0);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      provider.close((error) => error === undefined ? resolveClose() : rejectClose(error));
    });
    await rm(root, { recursive: true, force: true });
  }
});

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

test('source CLI forgets reversibly, purges a lineage, and clears only recovery history', async () => {
  const engineRoot = await mkdtemp(join(tmpdir(), 'forge-memory-privacy-'));
  const alpha = 'Privacy tracer alpha should leave active memory when forgotten.';
  const beta = 'Privacy tracer beta should disappear with its lineage.';
  const gamma = 'Privacy tracer gamma should leave recovery when history is cleared.';
  const delta = 'Privacy tracer delta must remain active after history is cleared.';
  try {
    await runMemory(engineRoot, ['remember', alpha]);
    const unconfirmed = await runMemoryFailure(engineRoot, ['purge', 'Privacy tracer alpha']);
    assert.equal(((unconfirmed.error as { readonly code: string }).code), 'memory_command_failed');
    assert.match(
      ((unconfirmed.error as { readonly message: string }).message),
      /Re-run with --yes/u,
    );
    const unchanged = await runMemory(engineRoot, ['find', 'Privacy tracer alpha']);
    assert.equal((unchanged.matches as readonly unknown[]).length, 1);
    const forgotten = await runMemory(engineRoot, ['forget', 'Privacy tracer alpha']);
    assert.equal((forgotten.result as { readonly status: string }).status, 'forgotten');
    assert.equal((forgotten.result as { readonly activeCount: number }).activeCount, 0);
    assert.equal((forgotten.result as { readonly recoveryCount: number }).recoveryCount, 1);

    const inactive = await runMemory(engineRoot, ['find', 'Privacy tracer alpha']);
    assert.deepEqual(inactive.matches, []);
    const recoverable = await runMemory(engineRoot, ['history', 'Privacy tracer alpha']);
    assert.equal((recoverable.matches as readonly unknown[]).length, 1);

    await runMemory(engineRoot, ['restore', 'Privacy tracer alpha']);
    await runMemory(engineRoot, [
      'correct',
      'Privacy tracer alpha',
      '--replacement',
      beta,
    ]);
    const purged = await runMemory(engineRoot, ['purge', 'Privacy tracer beta', '--yes']);
    const purgeResult = purged.result as {
      readonly status: string;
      readonly activeCount: number;
      readonly recoveryCount: number;
      readonly receipt: Readonly<Record<string, unknown>>;
    };
    assert.equal(purgeResult.status, 'purged');
    assert.equal(purgeResult.activeCount, 0);
    assert.equal(purgeResult.recoveryCount, 0);
    assert.equal(purgeResult.receipt.reasonCode, 'memory_purged');
    assert.equal(purgeResult.receipt.removedRecordCount, 2);
    for (const forbidden of [
      'claimId', 'observationId', 'targetId', 'contentSha256', 'statement', 'subject',
    ]) {
      assert.equal(Object.hasOwn(purgeResult.receipt, forbidden), false);
    }
    let state = await readTree(engineRoot);
    assert.ok(!state.includes(alpha));
    assert.ok(!state.includes(beta));

    await runMemory(engineRoot, ['remember', gamma]);
    await runMemory(engineRoot, [
      'correct',
      'Privacy tracer gamma',
      '--replacement',
      delta,
    ]);
    const cleared = await runMemory(engineRoot, ['history', 'clear', '--yes']);
    assert.equal(cleared.operation, 'history_clear');
    assert.equal(cleared.clearedRecordCount, 1);
    assert.equal((cleared.results as readonly unknown[]).length, 1);
    const active = await runMemory(engineRoot, ['find', 'Privacy tracer delta']);
    assert.equal((active.matches as readonly unknown[]).length, 1);
    const history = await runMemory(engineRoot, ['history']);
    assert.deepEqual(history.matches, []);
    state = await readTree(engineRoot);
    assert.ok(!state.includes(gamma));
    assert.ok(state.includes(delta));
    assert.match(String(cleared.disclosure), /runs, artifacts, conversations, backups, and media/u);
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
