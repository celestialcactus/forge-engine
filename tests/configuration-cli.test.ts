import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { configurationFieldIds } from '../src/config/contracts.js';

const cli = [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli.ts')];
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

const withRoots = async (
  run: (roots: { readonly root: string; readonly workspace: string; readonly home: string }) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'forge-config-cli-'));
  const workspace = join(root, 'workspace');
  const home = join(root, 'home');
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  try {
    await run({ root, workspace, home });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const environmentFor = (
  home: string,
  additions: Readonly<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  for (const variable of coveredEnvironmentVariables) delete environment[variable];
  environment.HOME = home;
  environment.USERPROFILE = home;
  return { ...environment, ...additions };
};

const runCli = (
  argumentsList: readonly string[],
  home: string,
  additions: Readonly<NodeJS.ProcessEnv> = {},
) => spawnSync(process.execPath, [...cli, ...argumentsList], {
  encoding: 'utf8',
  timeout: 15_000,
  windowsHide: true,
  env: environmentFor(home, additions),
});

test('config path and validate are exact, silent-by-default, kernel-free commands', async () => {
  await withRoots(async ({ root, workspace, home }) => {
    const paths = runCli(['config', 'path', '--workspace', workspace, '--json'], home);
    assert.equal(paths.status, 0, paths.stderr);
    const report = JSON.parse(paths.stdout) as {
      readonly workspace: { readonly path: string };
      readonly user: { readonly path: string };
    };
    assert.equal(report.workspace.path, join(workspace, '.forge', 'config.json'));
    assert.equal(report.user.path, join(home, '.forge', 'config.json'));
    assert.doesNotMatch(paths.stderr, /kernel|provider/iu);

    const valid = runCli(['config', 'validate', '--workspace', workspace, '--json'], home, {
      FORGE_KERNEL_BINARY: join(root, 'missing-kernel'),
    });
    assert.equal(valid.status, 0, valid.stderr);
    const validReport = JSON.parse(valid.stdout) as {
      readonly ok: boolean;
      readonly paths: {
        readonly workspace: { readonly status: string };
        readonly user: { readonly status: string };
      };
    };
    assert.equal(validReport.ok, true);
    assert.equal(validReport.paths.workspace.status, 'absent');
    assert.equal(validReport.paths.user.status, 'absent');
    assert.equal(Object.hasOwn(validReport, 'configuration'), false);
    assert.doesNotMatch(valid.stderr, /kernel|provider/iu);

    const invalidAction = runCli(['config', 'unknown', '--workspace', workspace, '--json'], home);
    assert.notEqual(invalidAction.status, 0);
    assert.equal(JSON.parse(invalidAction.stderr).error.code, 'config_command_invalid');

    const invalidArgument = runCli(['config', 'show', '--workspace', workspace, '--not-an-option', '--json'], home);
    assert.notEqual(invalidArgument.status, 0);
    assert.equal(JSON.parse(invalidArgument.stderr).error.code, 'cli_arguments_invalid');

    const irrelevantOverride = runCli([
      'config', 'path', '--workspace', workspace, '--provider', 'ollama', '--model', 'fixture', '--json',
    ], home);
    assert.notEqual(irrelevantOverride.status, 0);
    assert.equal(JSON.parse(irrelevantOverride.stderr).error.code, 'config_command_invalid');

    await mkdir(join(workspace, '.forge'), { recursive: true });
    await writeFile(join(workspace, '.forge', 'config.json'), '{ invalid', 'utf8');
    const invalid = runCli(['config', 'validate', '--workspace', workspace, '--json'], home);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, '');
    const failure = JSON.parse(invalid.stderr) as {
      readonly ok: boolean;
      readonly error: { readonly code: string; readonly source: string; readonly location: string; readonly hint: string };
    };
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, 'config_json_invalid');
    assert.equal(failure.error.source, 'workspace');
    assert.equal(failure.error.location, join(await realpath(workspace), '.forge', 'config.json'));
    assert.ok(failure.error.hint.length > 0);
  });
});

test('config init safely creates each minimal file and never overwrites it', async () => {
  await withRoots(async ({ workspace, home }) => {
    for (const scope of ['workspace', 'user'] as const) {
      const first = runCli(['config', 'init', scope, '--workspace', workspace, '--json'], home);
      assert.equal(first.status, 0, first.stderr);
      const report = JSON.parse(first.stdout) as { readonly path: string; readonly next: string };
      const expectedPath = join(scope === 'workspace' ? workspace : home, '.forge', 'config.json');
      assert.equal(report.path, expectedPath);
      assert.equal(report.next, 'forge config validate');
      const original = await readFile(expectedPath, 'utf8');
      assert.equal(original, '{\n  "schemaVersion": 1\n}\n');

      const second = runCli(['config', 'init', scope, '--workspace', workspace, '--json'], home);
      assert.notEqual(second.status, 0);
      assert.match(second.stderr, /will not overwrite/u);
      assert.equal(await readFile(expectedPath, 'utf8'), original);
    }
    const valid = runCli(['config', 'validate', '--workspace', workspace, '--json'], home);
    assert.equal(valid.status, 0, valid.stderr);
  });
});

test('config show and doctor share one ordered redacted diagnostic truth', async () => {
  await withRoots(async ({ root, workspace, home }) => {
    const common = {
      FORGE_DEFAULT_PROVIDER: 'openai',
      FORGE_DEFAULT_MODEL: 'gpt-fixture',
      FORGE_KERNEL_BINARY: join(root, 'missing-kernel'),
    };
    const first = runCli(['config', 'show', '--workspace', workspace, '--json'], home, {
      ...common,
      OPENAI_API_KEY: 'alpha-super-secret',
    });
    const second = runCli(['config', 'show', '--workspace', workspace, '--json'], home, {
      ...common,
      OPENAI_API_KEY: 'beta-super-secret',
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(first.stdout + first.stderr, /alpha-super-secret/u);
    assert.doesNotMatch(second.stdout + second.stderr, /beta-super-secret/u);
    const firstReport = JSON.parse(first.stdout) as { readonly configuration: readonly Record<string, unknown>[] };
    const secondReport = JSON.parse(second.stdout) as { readonly configuration: readonly Record<string, unknown>[] };
    assert.deepEqual(firstReport.configuration, secondReport.configuration);
    assert.deepEqual(firstReport.configuration.map(({ field }) => field), configurationFieldIds);
    const credential = firstReport.configuration.find(({ field }) => field === 'credential.openai_api_key');
    assert.deepEqual(credential, {
      field: 'credential.openai_api_key',
      label: 'OpenAI credential',
      sources: ['environment'],
      digest: '6ecd79b0d70dcbb94d7264e6ca50ff079ac17e4015ca66125599e49de7d1e17c',
      present: true,
      redacted: true,
    });

    const doctor = runCli(['doctor', '--workspace', workspace, '--json'], home, {
      ...common,
      OPENAI_API_KEY: 'alpha-super-secret',
    });
    assert.notEqual(doctor.status, 0);
    assert.doesNotMatch(doctor.stdout + doctor.stderr, /alpha-super-secret/u);
    const doctorReport = JSON.parse(doctor.stdout) as {
      readonly configuration: { readonly effective: readonly Record<string, unknown>[] };
    };
    assert.deepEqual(doctorReport.configuration.effective, firstReport.configuration);

    const human = runCli(['config', 'show', '--workspace', workspace], home, {
      ...common,
      OPENAI_API_KEY: 'alpha-super-secret',
    });
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /OpenAI credential: available \(value redacted\)/u);
    assert.doesNotMatch(human.stdout + human.stderr, /alpha-super-secret/u);

    const humanDoctor = runCli(['doctor', '--workspace', workspace], home, {
      ...common,
      OPENAI_API_KEY: 'alpha-super-secret',
    });
    assert.notEqual(humanDoctor.status, 0);
    assert.match(humanDoctor.stdout, /State separation:/u);
    assert.match(humanDoctor.stdout, /Approval authority: rust-kernel/u);
    assert.match(humanDoctor.stdout, /OpenAI credential: available \(value redacted\).*from environment.*digest=/u);
    assert.match(humanDoctor.stdout, /does not enforce an accepted Forge-enforced OS sandbox|no accepted Forge-enforced OS sandbox/u);
    assert.doesNotMatch(humanDoctor.stdout + humanDoctor.stderr, /alpha-super-secret/u);
  });
});
