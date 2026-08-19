import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compileProductConfiguration } from '../src/config/compile.js';
import { configurationFieldIds } from '../src/config/contracts.js';
import { ConfigurationIssueError } from '../src/config/schema.js';

const withConfigurationRoots = async (
  run: (roots: { readonly root: string; readonly workspace: string; readonly home: string }) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'forge-config-compile-'));
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

const writeConfiguration = async (
  root: string,
  value: unknown,
): Promise<void> => {
  const directory = join(root, '.forge');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'config.json'), JSON.stringify(value), 'utf8');
};

test('zero-config compiles one complete immutable diagnostic model', async () => {
  await withConfigurationRoots(async ({ workspace, home }) => {
    const compiled = await compileProductConfiguration({
      workspaceRoot: workspace,
      currentWorkingDirectory: workspace,
      homeDirectory: home,
      environment: {},
    });

    assert.equal(compiled.effective.route, undefined);
    assert.equal(compiled.effective.engineRoot.value, join(home, '.forge'));
    assert.equal(compiled.effective.providers.ollama.baseUrl.value, 'http://127.0.0.1:11434/');
    assert.equal(compiled.effective.providers.ollama.contextWindowTokens.value, 8_192);
    assert.equal(compiled.effective.providers.openai.baseUrl.value, 'https://api.openai.com/');
    assert.equal(compiled.effective.providers.openai.credential.value.present, false);
    assert.deepEqual(
      compiled.effective.diagnostics.map(({ field }) => field),
      configurationFieldIds,
    );
    assert.equal(
      compiled.effective.diagnostics[0]?.digest,
      '351471e1b72e4a1f662e3208dd5ab7c7af358121ad3c58d136e6a53faae65893',
    );
    assert.equal(compiled.files.workspace.kind, 'absent');
    assert.equal(compiled.files.user.kind, 'absent');
    assert.ok(Object.isFrozen(compiled));
    assert.ok(Object.isFrozen(compiled.effective));
    assert.ok(Object.isFrozen(compiled.effective.execution));
    assert.ok(Object.isFrozen(compiled.effective.diagnostics));
  });
});

test('compiles exact precedence, atomic routes, and monotonic ceilings once', async () => {
  await withConfigurationRoots(async ({ workspace, home }) => {
    await writeConfiguration(workspace, {
      schemaVersion: 1,
      inference: { provider: 'ollama', model: 'workspace-model' },
      approvalProfile: 'locked',
      execution: { maxTurns: 3, maxCapabilityCalls: 1 },
    });
    await writeConfiguration(home, {
      schemaVersion: 1,
      inference: { provider: 'openai', model: 'user-model' },
      engineRoot: join(home, 'state'),
      providers: {
        ollama: { baseUrl: 'https://ollama.example.test', contextWindowTokens: 16_384 },
        openai: { baseUrl: 'https://openai.example.test' },
      },
      approvalProfile: 'developer',
      execution: { maxTurns: 7, maxCapabilityCalls: 4 },
    });
    const environment: Record<string, string | undefined> = {
      FORGE_DEFAULT_PROVIDER: 'openai',
      FORGE_DEFAULT_MODEL: 'environment-model',
      FORGE_MAX_TURNS: '5',
      OPENAI_API_KEY: 'first-secret-value',
    };
    const commandLine: Record<string, string | undefined> = {
      provider: 'ollama',
      model: 'command-model',
      maxTurns: '6',
      approvalProfile: 'review',
    };
    const compiled = await compileProductConfiguration({
      workspaceRoot: workspace,
      currentWorkingDirectory: workspace,
      homeDirectory: home,
      environment,
      commandLine,
    });
    environment.FORGE_DEFAULT_MODEL = 'mutated-after-compile';
    environment.OPENAI_API_KEY = 'second-secret-value';
    commandLine.model = 'mutated-after-compile';

    assert.deepEqual(compiled.effective.route?.value, { provider: 'ollama', model: 'command-model' });
    assert.deepEqual(compiled.effective.route?.sources, ['command_line']);
    assert.equal(compiled.effective.approvalProfile.value, 'locked');
    assert.deepEqual(
      compiled.effective.approvalProfile.sources,
      ['command_line', 'workspace', 'user', 'built_in'],
    );
    assert.equal(compiled.effective.execution.maxTurns.value, 3);
    assert.equal(compiled.effective.execution.maxCapabilityCalls.value, 1);
    assert.equal(compiled.effective.providers.openai.credential.value.present, true);
    assert.equal(
      JSON.stringify(compiled.effective).includes('first-secret-value')
        || JSON.stringify(compiled.effective).includes('second-secret-value'),
      false,
    );
  });
});

test('a higher partial route fails instead of splicing with a lower complete route', async () => {
  await withConfigurationRoots(async ({ workspace, home }) => {
    await writeConfiguration(home, {
      schemaVersion: 1,
      inference: { provider: 'ollama', model: 'lower-model' },
    });
    await assert.rejects(
      compileProductConfiguration({
        workspaceRoot: workspace,
        homeDirectory: home,
        environment: {},
        commandLine: { provider: 'openai' },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationIssueError);
        assert.equal(error.issue.code, 'config_route_incomplete');
        assert.equal(error.issue.source, 'command_line');
        assert.equal(error.issue.location, '--provider and --model');
        return true;
      },
    );
    await assert.rejects(
      compileProductConfiguration({
        workspaceRoot: workspace,
        homeDirectory: home,
        environment: { FORGE_DEFAULT_MODEL: 'environment-model' },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationIssueError);
        assert.equal(error.issue.code, 'config_route_incomplete');
        assert.equal(error.issue.source, 'environment');
        return true;
      },
    );
  });
});

test('normalizes and validates trusted managed facts before projection', async () => {
  await withConfigurationRoots(async ({ workspace, home, root }) => {
    const compiled = await compileProductConfiguration({
      workspaceRoot: workspace,
      homeDirectory: home,
      environment: {},
      managed: {
        schemaVersion: 1,
        facts: [{
          field: 'provider.openai.base_url',
          source: 'managed',
          value: 'https://managed.example.test',
          evidence: { authority: 'fixture-host' },
        }],
      },
    });
    assert.equal(compiled.effective.providers.openai.baseUrl.value, 'https://managed.example.test/');
    assert.deepEqual(compiled.effective.providers.openai.baseUrl.sources, ['managed']);

    await assert.rejects(
      compileProductConfiguration({
        workspaceRoot: workspace,
        homeDirectory: home,
        environment: {},
        managed: {
          schemaVersion: 1,
          facts: [{
            field: 'engine.root',
            source: 'managed',
            value: join(root, 'bad\nroot'),
            evidence: { authority: 'fixture-host' },
          }],
        },
      }),
      ConfigurationIssueError,
    );
  });
});
