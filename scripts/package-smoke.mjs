import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { nativePackageName, repositoryRoot, stageNativePackage } from './native-package.mjs';

const execFileAsync = promisify(execFile);
const npmCli = process.env.npm_execpath;
if (npmCli === undefined || npmCli.length === 0) {
  throw new Error('Package smoke must be launched through npm so npm_execpath is attributable.');
}
const runNpm = (arguments_, options) => execFileAsync(
  process.execPath,
  [npmCli, ...arguments_],
  options,
);
const root = await mkdtemp(join(tmpdir(), 'forge-package-smoke-'));

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
];

const productEnvironment = (homeRoot, additions = {}) => {
  const environment = { ...process.env };
  for (const variable of coveredEnvironmentVariables) delete environment[variable];
  return {
    ...environment,
    HOME: homeRoot,
    USERPROFILE: homeRoot,
    ...additions,
  };
};

const readTree = async (directory) => {
  const chunks = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) chunks.push(await readTree(path));
    else if (entry.isFile() && entry.name !== 'lock') chunks.push(await readFile(path, 'utf8'));
  }
  return chunks.join('\n');
};

try {
  const archives = join(root, 'archives');
  const installRoot = join(root, 'install');
  const workspaceRoot = join(root, 'workspace');
  const homeRoot = join(root, 'home');
  const engineRoot = join(root, 'engine');
  const initWorkspaceRoot = join(root, 'init-workspace');
  const initHomeRoot = join(root, 'init-home');
  const partialWorkspaceRoot = join(root, 'partial-workspace');
  const partialHomeRoot = join(root, 'partial-home');
  await Promise.all([
    mkdir(archives),
    mkdir(installRoot),
    mkdir(workspaceRoot),
    mkdir(homeRoot),
    mkdir(engineRoot),
    mkdir(initWorkspaceRoot),
    mkdir(initHomeRoot),
    mkdir(partialWorkspaceRoot),
    mkdir(partialHomeRoot),
  ]);
  await writeFile(join(workspaceRoot, 'README.md'), '# Forge clean-install smoke\n', 'utf8');
  await Promise.all([
    mkdir(join(workspaceRoot, '.forge')),
    mkdir(join(homeRoot, '.forge')),
  ]);
  await writeFile(join(workspaceRoot, '.forge', 'config.json'), JSON.stringify({
    schemaVersion: 1,
    inference: { provider: 'ollama', model: 'workspace-model' },
    execution: { maxTurns: 4, maxCapabilityCalls: 2 },
  }), 'utf8');
  await writeFile(join(homeRoot, '.forge', 'config.json'), JSON.stringify({
    schemaVersion: 1,
    inference: { provider: 'ollama', model: 'user-model' },
    engineRoot: join(root, 'user-engine'),
    providers: { ollama: { baseUrl: 'http://127.0.0.1:11434', contextWindowTokens: 16_384 } },
    execution: { maxTurns: 6, maxCapabilityCalls: 5 },
  }), 'utf8');

  const staged = await stageNativePackage();
  const nativePack = await runNpm([
    'pack', staged.packageRoot, '--pack-destination', archives, '--json',
  ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  const rootPack = await runNpm([
    'pack', repositoryRoot, '--pack-destination', archives, '--json',
  ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  const nativeArchive = join(archives, JSON.parse(nativePack.stdout)[0].filename);
  const rootArchive = join(archives, JSON.parse(rootPack.stdout)[0].filename);

  await writeFile(join(installRoot, 'package.json'), JSON.stringify({ private: true }), 'utf8');
  await runNpm([
    'install', '--ignore-scripts', '--no-audit', '--no-fund', rootArchive, nativeArchive,
  ], { cwd: installRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000 });

  const cli = join(installRoot, 'node_modules', 'forge-engine', 'dist', 'src', 'cli.js');
  const fixtureSecret = 'package-smoke-secret-must-not-appear';
  const cliEnvironment = productEnvironment(homeRoot, {
    FORGE_DEFAULT_PROVIDER: 'openai',
    FORGE_DEFAULT_MODEL: 'environment-model',
    FORGE_MAX_TURNS: '5',
    OPENAI_API_KEY: fixtureSecret,
  });
  const runCli = (arguments_) => execFileAsync(process.execPath, [cli, ...arguments_], {
    cwd: installRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    env: cliEnvironment,
  });
  const runCliWithEnvironment = (arguments_, environment) => execFileAsync(process.execPath, [cli, ...arguments_], {
    cwd: installRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    env: environment,
  });

  const pathsResult = await runCli(['config', 'path', '--workspace', workspaceRoot, '--json']);
  const paths = JSON.parse(pathsResult.stdout);
  if (paths.workspace?.path !== join(workspaceRoot, '.forge', 'config.json')
    || paths.user?.path !== join(homeRoot, '.forge', 'config.json')) {
    throw new Error(`Clean-install config path returned invalid fixed paths: ${pathsResult.stdout}`);
  }
  const validation = await runCli(['config', 'validate', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json']);
  if (JSON.parse(validation.stdout).ok !== true) {
    throw new Error(`Clean-install config validation failed: ${validation.stdout}`);
  }

  const initializedWorkspace = await runCli([
    'config', 'init', 'workspace', '--workspace', initWorkspaceRoot, '--json',
  ]);
  const initializedWorkspacePath = join(initWorkspaceRoot, '.forge', 'config.json');
  if (JSON.parse(initializedWorkspace.stdout).path !== initializedWorkspacePath) {
    throw new Error(`Clean-install workspace config init returned the wrong path: ${initializedWorkspace.stdout}`);
  }
  const initializedWorkspaceBytes = await readFile(initializedWorkspacePath, 'utf8');
  const workspaceRefusal = await runCli([
    'config', 'init', 'workspace', '--workspace', initWorkspaceRoot, '--json',
  ]).then(() => undefined, (error) => error);
  if (workspaceRefusal?.code !== 1
    || !String(workspaceRefusal.stderr).includes('config_command_failed')
    || await readFile(initializedWorkspacePath, 'utf8') !== initializedWorkspaceBytes) {
    throw new Error('Clean-install workspace config init did not refuse overwrite without changing bytes.');
  }

  const initUserEnvironment = productEnvironment(initHomeRoot);
  const initializedUser = await runCliWithEnvironment(['config', 'init', 'user', '--json'], initUserEnvironment);
  const initializedUserPath = join(initHomeRoot, '.forge', 'config.json');
  if (JSON.parse(initializedUser.stdout).path !== initializedUserPath) {
    throw new Error(`Clean-install user config init returned the wrong path: ${initializedUser.stdout}`);
  }
  const initializedUserBytes = await readFile(initializedUserPath, 'utf8');
  const userRefusal = await runCliWithEnvironment(
    ['config', 'init', 'user', '--json'],
    initUserEnvironment,
  ).then(() => undefined, (error) => error);
  if (userRefusal?.code !== 1
    || !String(userRefusal.stderr).includes('config_command_failed')
    || await readFile(initializedUserPath, 'utf8') !== initializedUserBytes) {
    throw new Error('Clean-install user config init did not refuse overwrite without changing bytes.');
  }
  const show = await runCli(['config', 'show', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json']);
  if (show.stdout.includes(fixtureSecret) || show.stderr.includes(fixtureSecret)) {
    throw new Error('Clean-install configuration output exposed the fixture credential.');
  }
  const shown = JSON.parse(show.stdout);
  if (!Array.isArray(shown.configuration) || shown.configuration.length !== 12) {
    throw new Error(`Clean-install config show omitted effective fields: ${show.stdout}`);
  }
  const field = (id) => shown.configuration.find((entry) => entry.field === id);
  if (field('inference.route')?.value?.model !== 'environment-model'
    || field('inference.route')?.sources?.[0] !== 'environment'
    || field('engine.root')?.value !== engineRoot
    || field('engine.root')?.sources?.[0] !== 'command_line'
    || field('execution.max_turns')?.value !== 4
    || field('provider.ollama.context_window_tokens')?.value !== 16_384
    || field('credential.openai_api_key')?.redacted !== true
    || field('credential.openai_api_key')?.present !== true
    || Object.hasOwn(field('credential.openai_api_key') ?? {}, 'value')) {
    throw new Error(`Clean-install effective configuration was not conformant: ${show.stdout}`);
  }
  const doctor = await execFileAsync(process.execPath, [
    cli, 'doctor', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ], {
    cwd: installRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    env: cliEnvironment,
  });
  const report = JSON.parse(doctor.stdout);
  if (report.ok !== true
    || report.kernel?.ready !== true
    || report.kernel?.source !== 'packaged'
    || report.kernel?.protocols?.sovereignChange !== 'forge.kernel.changeset.v4'
    || JSON.stringify(report.configuration?.effective) !== JSON.stringify(shown.configuration)) {
    throw new Error(`Clean-install doctor returned an invalid report: ${doctor.stdout}`);
  }
  if (doctor.stdout.includes(fixtureSecret) || doctor.stderr.includes(fixtureSecret)) {
    throw new Error('Clean-install doctor output exposed the fixture credential.');
  }

  const onboard = await runCli([
    'onboard', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ]);
  const onboarding = JSON.parse(onboard.stdout);
  if (onboarding.runtimeReady !== true
    || onboarding.releaseReady !== false
    || onboarding.configuration?.precedenceStatus !== 'conformant'
    || onboarding.releaseBlockers?.includes('Configuration precedence implementation and conformance')) {
    throw new Error(`Clean-install onboarding did not report conformant configuration: ${onboard.stdout}`);
  }

  const autosaveInitial = JSON.parse((await runCli([
    'memory', 'autosave', 'status', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ])).stdout);
  if (autosaveInitial.mode !== 'ask' || autosaveInitial.grant !== undefined) {
    throw new Error(`Clean-install autosave default was not ask: ${JSON.stringify(autosaveInitial)}`);
  }
  const autosaveEnabled = JSON.parse((await runCli([
    'memory', 'autosave', 'auto', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ])).stdout);
  if (autosaveEnabled.mode !== 'auto'
    || autosaveEnabled.grant?.scope?.kind !== 'repository'
    || autosaveEnabled.grant?.actorId !== 'developer:local') {
    throw new Error(`Clean-install autosave did not create an exact local grant: ${JSON.stringify(autosaveEnabled)}`);
  }
  const autosaveDisabled = JSON.parse((await runCli([
    'memory', 'autosave', 'off', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ])).stdout);
  if (autosaveDisabled.mode !== 'off'
    || autosaveDisabled.grant?.grantId !== autosaveEnabled.grant?.grantId) {
    throw new Error(`Clean-install autosave did not persist local disablement: ${JSON.stringify(autosaveDisabled)}`);
  }

  const privacyAlpha = 'Package privacy alpha must be removable from memory state.';
  const privacyBeta = 'Package privacy beta must leave no lineage content behind.';
  await runCli([
    'memory', 'remember', privacyAlpha, '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ]);
  const unconfirmedPurge = await runCli([
    'memory', 'purge', 'Package privacy alpha', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ]).then(() => undefined, (error) => error);
  if (unconfirmedPurge?.code !== 1
    || !String(unconfirmedPurge.stderr).includes('memory_command_failed')
    || !String(unconfirmedPurge.stderr).includes('Re-run with --yes')) {
    throw new Error('Clean-install purge did not require explicit noninteractive confirmation.');
  }
  await runCli([
    'memory', 'forget', 'Package privacy alpha', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ]);
  const hidden = JSON.parse((await runCli([
    'memory', 'find', 'Package privacy alpha', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ])).stdout);
  const recoverable = JSON.parse((await runCli([
    'memory', 'history', 'Package privacy alpha', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ])).stdout);
  if (hidden.matches.length !== 0 || recoverable.matches.length !== 1) {
    throw new Error('Clean-install forget was not inactive and recoverable.');
  }
  await runCli([
    'memory', 'restore', 'Package privacy alpha', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ]);
  await runCli([
    'memory', 'correct', 'Package privacy alpha', '--replacement', privacyBeta,
    '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ]);
  const purged = JSON.parse((await runCli([
    'memory', 'purge', 'Package privacy beta', '--yes',
    '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ])).stdout);
  const purgeReceipt = purged.result?.receipt;
  const forbiddenReceiptFields = [
    'claimId', 'observationId', 'targetId', 'contentSha256', 'statement', 'subject',
  ];
  if (purged.result?.status !== 'purged'
    || purgeReceipt?.reasonCode !== 'memory_purged'
    || purgeReceipt?.removedRecordCount !== 2
    || forbiddenReceiptFields.some((fieldName) => Object.hasOwn(purgeReceipt ?? {}, fieldName))
    || !String(purged.disclosure).includes('runs, artifacts, conversations, backups, and media')) {
    throw new Error(`Clean-install purge receipt was not conformant: ${JSON.stringify(purged)}`);
  }
  const afterPurge = await readTree(engineRoot);
  if (afterPurge.includes(privacyAlpha) || afterPurge.includes(privacyBeta)) {
    throw new Error('Clean-install purge retained lineage content in Forge memory state.');
  }

  const historyAlpha = 'Package history alpha should be recoverable only.';
  const historyBeta = 'Package history beta must remain active.';
  await runCli([
    'memory', 'remember', historyAlpha, '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ]);
  await runCli([
    'memory', 'correct', 'Package history alpha', '--replacement', historyBeta,
    '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ]);
  const cleared = JSON.parse((await runCli([
    'memory', 'history', 'clear', '--yes', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ])).stdout);
  const afterClear = await readTree(engineRoot);
  if (cleared.clearedRecordCount !== 1
    || afterClear.includes(historyAlpha)
    || !afterClear.includes(historyBeta)) {
    throw new Error(`Clean-install history clear did not retain only active memory: ${JSON.stringify(cleared)}`);
  }

  const partialEnvironment = productEnvironment(partialHomeRoot, {
    FORGE_DEFAULT_PROVIDER: 'ollama',
    FORGE_KERNEL_BINARY: join(root, 'kernel-must-not-be-probed'),
  });
  const partialFailure = await runCliWithEnvironment([
    'doctor', '--workspace', partialWorkspaceRoot, '--json',
  ], partialEnvironment).then(() => undefined, (error) => error);
  const partialOutput = String(partialFailure?.stdout ?? '') + String(partialFailure?.stderr ?? '');
  if (partialFailure?.code !== 1
    || !partialOutput.includes('config_route_incomplete')
    || partialOutput.includes('Rust kernel is unavailable')) {
    throw new Error(`Partial route did not fail before kernel work: ${partialOutput}`);
  }

  const inspection = await execFileAsync(process.execPath, [
    cli, 'inspect', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--max-files', '1', '--json',
  ], {
    cwd: installRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    env: cliEnvironment,
  });
  const artifact = JSON.parse(inspection.stdout);
  if (artifact.status !== 'completed' || artifact.outcome?.status !== 'verified') {
    throw new Error(`Clean-install inspection failed: ${inspection.stdout}`);
  }

  const installedManifest = JSON.parse(await readFile(
    join(installRoot, 'node_modules', nativePackageName(), 'package.json'),
    'utf8',
  ));
  const installedRootManifest = JSON.parse(await readFile(
    join(installRoot, 'node_modules', 'forge-engine', 'package.json'),
    'utf8',
  ));
  if (installedManifest.version !== installedRootManifest.version) {
    throw new Error(`Installed main/native versions differ: ${installedRootManifest.version}/${installedManifest.version}.`);
  }

  await runNpm([
    'update', '--ignore-scripts', '--no-audit', '--no-fund', 'forge-engine', nativePackageName(),
  ], { cwd: installRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  const updatedRootManifest = JSON.parse(await readFile(
    join(installRoot, 'node_modules', 'forge-engine', 'package.json'),
    'utf8',
  ));
  const updatedNativeManifest = JSON.parse(await readFile(
    join(installRoot, 'node_modules', nativePackageName(), 'package.json'),
    'utf8',
  ));
  if (updatedRootManifest.version !== installedRootManifest.version
    || updatedNativeManifest.version !== installedManifest.version
    || updatedRootManifest.version !== updatedNativeManifest.version) {
    throw new Error('Package update did not preserve the exact main/native version pair.');
  }

  await runNpm([
    'uninstall', '--ignore-scripts', '--no-audit', '--no-fund', 'forge-engine', nativePackageName(),
  ], { cwd: installRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  for (const removed of ['forge-engine', nativePackageName()]) {
    try {
      await access(join(installRoot, 'node_modules', removed, 'package.json'));
      throw new Error(`Package uninstall left ${removed} installed.`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Package uninstall left')) throw error;
      if (typeof error !== 'object' || error === null || error.code !== 'ENOENT') throw error;
    }
  }
  console.log(JSON.stringify({
    ok: true,
    nativePackage: installedManifest.name,
    version: installedManifest.version,
    kernelSource: report.kernel.source,
    runId: artifact.runId,
    lifecycle: [
      'pack',
      'clean-install',
      'config-path',
      'config-init-user',
      'config-init-workspace',
      'config-validate',
      'config-show',
      'config-partial-route-refusal',
      'doctor',
      'onboard',
      'memory-autosave-ask-auto-off',
      'memory-forget-restore-purge-history-clear',
      'inspect',
      'update',
      'uninstall',
    ],
  }));
} finally {
  if (process.env.FORGE_KEEP_PACKAGE_SMOKE !== '1') {
    await rm(root, { recursive: true, force: true });
  } else {
    console.error(`Forge package smoke retained at ${root}`);
  }
}
