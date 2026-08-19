import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ConfigurationIssueError,
  normalizeApprovalProfile,
  normalizeConfigurationInteger,
  normalizeEngineRoot,
  normalizeInferenceRoute,
  normalizeProviderOrigin,
  parseConfigurationDocument,
} from '../src/config/schema.js';
import {
  loadFileConfigurationSources,
  loadUserConfiguration,
  loadWorkspaceConfiguration,
} from '../src/config/sources.js';
import { configurationGoldenCases } from './fixtures/configuration/golden-cases.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/configuration/sources/', import.meta.url));

const withTemporaryDirectory = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-config-source-'));
  try {
    // macOS exposes /var as a symlink to /private/var. The loader intentionally
    // reports its canonical workspace authority, so assertions use that same root.
    await run(await realpath(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const expectIssue = async (
  operation: () => unknown | Promise<unknown>,
  expected: {
    readonly code: ConfigurationIssueError['issue']['code'];
    readonly source?: ConfigurationIssueError['issue']['source'];
    readonly location?: string;
    readonly message?: string;
    readonly hint?: string;
  },
): Promise<void> => {
  await assert.rejects(async () => operation(), (error: unknown) => {
    assert.ok(error instanceof ConfigurationIssueError);
    assert.equal(error.issue.code, expected.code);
    if (expected.source !== undefined) assert.equal(error.issue.source, expected.source);
    if (expected.location !== undefined) assert.equal(error.issue.location, expected.location);
    if (expected.message !== undefined) assert.equal(error.issue.message, expected.message);
    if (expected.hint !== undefined) assert.equal(error.issue.hint, expected.hint);
    assert.ok(error.issue.message.length <= 512);
    assert.ok(error.issue.hint.length <= 512);
    return true;
  });
};

test('strict workspace parsing normalizes values and emits source-attributed facts', async () => {
  const raw = JSON.parse(await readFile(join(fixtureRoot, 'valid-workspace.json'), 'utf8')) as unknown;
  const parsed = parseConfigurationDocument('workspace', raw, '<workspace>/.forge/config.json');

  assert.deepEqual(parsed.configuration, {
    schemaVersion: 1,
    inference: { provider: 'ollama', model: 'qwen-fixture' },
    approvalProfile: 'review',
    execution: {
      maxTurns: 4,
      maxCapabilityCalls: 2,
      maxReportedInputTokens: 100_000,
      maxReportedOutputTokens: 10_000,
      timeoutMs: 60_000,
    },
  });
  assert.deepEqual(parsed.facts.map(({ field }) => field), [
    'inference.route',
    'approval.profile',
    'execution.max_turns',
    'execution.max_capability_calls',
    'execution.max_reported_input_tokens',
    'execution.max_reported_output_tokens',
    'execution.timeout_ms',
  ]);
  for (const fact of parsed.facts) {
    assert.equal(fact.source, 'workspace');
    assert.equal(fact.evidence.path, '<workspace>/.forge/config.json');
  }
});

test('strict user parsing accepts only host-owned fields and canonicalizes provider origins', async () => {
  const raw = JSON.parse(await readFile(join(fixtureRoot, 'valid-user.json'), 'utf8')) as unknown;
  const parsed = parseConfigurationDocument('user', raw, '~/.forge/config.json');

  assert.equal(parsed.configuration.providers?.ollama?.baseUrl, 'http://127.0.0.1:11434/');
  assert.equal(parsed.configuration.providers?.openai?.baseUrl, 'https://api.openai.com/');
  assert.equal(parsed.configuration.providers?.ollama?.contextWindowTokens, 16_384);
  assert.equal(parsed.configuration.approvalProfile, 'locked');
  assert.deepEqual(parsed.facts.map(({ field }) => field), [
    'inference.route',
    'provider.ollama.base_url',
    'provider.ollama.context_window_tokens',
    'provider.openai.base_url',
    'approval.profile',
  ]);
});

test('source-owned golden document failures produce the frozen actionable issues', async () => {
  const cases = configurationGoldenCases.filter((candidate) =>
    candidate.kind === 'source_document_matrix');
  for (const fixture of cases) {
    if (fixture.kind !== 'source_document_matrix') continue;
    for (const sample of fixture.documents) {
      await expectIssue(
        () => parseConfigurationDocument(fixture.source, sample.document,
          fixture.source === 'workspace' ? '<workspace>/.forge/config.json' : '~/.forge/config.json'),
        { source: fixture.source, ...sample.expectedIssue },
      );
    }
  }
});

test('fixed workspace and user discovery treats only missing files as absence', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace');
    const home = join(directory, 'home');
    await Promise.all([mkdir(workspace), mkdir(home)]);

    const missing = await loadFileConfigurationSources({ workspaceRoot: workspace, homeDirectory: home });
    assert.deepEqual(missing.workspace, {
      kind: 'absent', source: 'workspace', path: join(workspace, '.forge', 'config.json'),
    });
    assert.deepEqual(missing.user, {
      kind: 'absent', source: 'user', path: join(home, '.forge', 'config.json'),
    });

    const workspacePath = join(workspace, '.forge', 'config.json');
    const userPath = join(home, '.forge', 'config.json');
    await Promise.all([mkdir(dirname(workspacePath)), mkdir(dirname(userPath))]);
    await Promise.all([
      cp(join(fixtureRoot, 'valid-workspace.json'), workspacePath),
      cp(join(fixtureRoot, 'valid-user.json'), userPath),
    ]);
    const loaded = await loadFileConfigurationSources({ workspaceRoot: workspace, homeDirectory: home });
    assert.equal(loaded.workspace.kind, 'present');
    assert.equal(loaded.user.kind, 'present');
    if (loaded.workspace.kind === 'present') {
      assert.equal(loaded.workspace.document.facts[0]?.field, 'inference.route');
    }
    if (loaded.user.kind === 'present') {
      assert.equal(loaded.user.document.configuration.providers?.openai?.baseUrl, 'https://api.openai.com/');
    }
  });
});

test('present malformed, oversized, directory, and broken-link files fail instead of disappearing', async (t) => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace');
    const configPath = join(workspace, '.forge', 'config.json');
    await mkdir(dirname(configPath), { recursive: true });

    await cp(join(fixtureRoot, 'malformed.json'), configPath);
    await expectIssue(() => loadWorkspaceConfiguration(workspace), {
      code: 'config_json_invalid', source: 'workspace', location: configPath,
    });

    await writeFile(configPath, Buffer.alloc(65_537, 0x20));
    await expectIssue(() => loadWorkspaceConfiguration(workspace), {
      code: 'config_file_too_large', source: 'workspace', location: configPath,
    });

    await rm(configPath);
    await mkdir(configPath);
    await expectIssue(() => loadWorkspaceConfiguration(workspace), {
      code: 'config_file_not_regular', source: 'workspace', location: configPath,
    });

    await rm(configPath, { recursive: true });
    try {
      await symlink(join(directory, 'missing-target.json'), configPath, 'file');
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === 'EPERM') {
        t.diagnostic('Symlink creation is unavailable on this Windows host.');
        return;
      }
      throw error;
    }
    await expectIssue(() => loadWorkspaceConfiguration(workspace), {
      code: 'config_file_unreadable', source: 'workspace', location: configPath,
    });
  });
});

test('workspace canonical containment rejects a configuration link that escapes the workspace', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace');
    const configPath = join(workspace, '.forge', 'config.json');
    const outsideDirectory = join(directory, 'outside');
    const outside = join(outsideDirectory, 'config.json');
    await mkdir(dirname(configPath), { recursive: true });
    await mkdir(outsideDirectory);
    await writeFile(outside, '{"schemaVersion":1}');
    try {
      await symlink(outside, configPath, 'file');
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === 'EPERM') {
        // Windows commonly permits directory junctions even when file symlinks
        // require Developer Mode. Both exercise the same canonical containment.
        await rm(dirname(configPath), { recursive: true });
        await symlink(outsideDirectory, dirname(configPath), 'junction');
      } else {
        throw error;
      }
    }
    await expectIssue(() => loadWorkspaceConfiguration(workspace), {
      code: 'config_file_outside_workspace', source: 'workspace', location: configPath,
    });
  });
});

test('the user config path follows host home, not engineRoot', async () => {
  await withTemporaryDirectory(async (directory) => {
    const home = join(directory, 'home');
    const configuredEngineRoot = join(directory, 'other-state');
    const userPath = join(home, '.forge', 'config.json');
    await mkdir(dirname(userPath), { recursive: true });
    await writeFile(userPath, JSON.stringify({ schemaVersion: 1, engineRoot: resolve(configuredEngineRoot) }));

    const loaded = await loadUserConfiguration(home);
    assert.equal(loaded.kind, 'present');
    assert.equal(loaded.path, userPath);
    if (loaded.kind === 'present') {
      assert.equal(loaded.document.configuration.engineRoot, resolve(configuredEngineRoot));
    }
  });
});

test('reusable normalizers give CLI and environment compilation the same strict values', () => {
  const context = { source: 'environment', location: 'FORGE_TEST' } as const;
  assert.deepEqual(normalizeInferenceRoute({ provider: ' OPENAI ', model: ' fixture ' }, context), {
    provider: 'openai', model: 'fixture',
  });
  assert.equal(normalizeApprovalProfile(' REVIEW ', context), 'review');
  assert.equal(normalizeConfigurationInteger('execution.max_turns', '08', context), 8);
  assert.equal(normalizeEngineRoot('./state', context, { requireAbsolute: false, relativeTo: 'C:/fixture' }),
    resolve('C:/fixture', 'state'));
  assert.equal(normalizeProviderOrigin('https://example.test', context), 'https://example.test/');
});

test('accepts a UTF-8 BOM but rejects malformed UTF-8 and duplicate JSON keys', async () => {
  await withTemporaryDirectory(async (directory) => {
    const home = join(directory, 'home');
    const configPath = join(home, '.forge', 'config.json');
    await mkdir(dirname(configPath), { recursive: true });

    await writeFile(configPath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('{"schemaVersion":1}', 'utf8'),
    ]));
    const bom = await loadUserConfiguration(home);
    assert.equal(bom.kind, 'present');

    await writeFile(configPath, Buffer.from([
      ...Buffer.from('{"schemaVersion":1,"inference":{"provider":"ollama","model":"', 'utf8'),
      0xc3,
      0x28,
      ...Buffer.from('"}}', 'utf8'),
    ]));
    await expectIssue(() => loadUserConfiguration(home), {
      code: 'config_json_invalid',
      message: 'Forge configuration must be valid UTF-8 JSON.',
    });

    await writeFile(configPath, '{"schemaVersion":1,"approvalProfile":"developer","approvalProfile":"locked"}', 'utf8');
    await expectIssue(() => loadUserConfiguration(home), {
      code: 'config_json_invalid',
      message: 'Forge configuration cannot contain duplicate object keys.',
    });
  });
});

test('reports unsupported schema versions before schema-v1 field errors', () => {
  assert.throws(
    () => parseConfigurationDocument('workspace', {
      schemaVersion: 2,
      engineRoot: '/not-workspace-owned',
      futureSetting: true,
    }, '<workspace>/.forge/config.json'),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationIssueError);
      assert.equal(error.issue.code, 'config_schema_unsupported');
      assert.equal(error.issue.location, '<workspace>/.forge/config.json#schemaVersion');
      return true;
    },
  );
});

test('bounds and control-escapes untrusted configuration issue fragments', () => {
  const hostileKey = `bad\u001b]8;;https://example.test\u0007${'x'.repeat(2_000)}`;
  assert.throws(
    () => parseConfigurationDocument('user', { schemaVersion: 1, [hostileKey]: true }, 'fixture\npath'),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationIssueError);
      assert.ok(error.issue.location.length <= 512);
      assert.ok(error.issue.message.length <= 512);
      assert.ok(error.issue.hint.length <= 512);
      assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(error.issue.location), false);
      assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(error.issue.message), false);
      assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(error.issue.hint), false);
      return true;
    },
  );
});
