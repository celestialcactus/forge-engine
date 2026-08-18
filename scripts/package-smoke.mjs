import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

try {
  const archives = join(root, 'archives');
  const installRoot = join(root, 'install');
  const workspaceRoot = join(root, 'workspace');
  const engineRoot = join(root, 'engine');
  await Promise.all([
    mkdir(archives),
    mkdir(installRoot),
    mkdir(workspaceRoot),
    mkdir(engineRoot),
  ]);
  await writeFile(join(workspaceRoot, 'README.md'), '# Forge clean-install smoke\n', 'utf8');

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
  const doctor = await execFileAsync(process.execPath, [
    cli, 'doctor', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--json',
  ], { cwd: installRoot, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  const report = JSON.parse(doctor.stdout);
  if (report.ok !== true
    || report.kernel?.ready !== true
    || report.kernel?.source !== 'packaged'
    || report.kernel?.protocols?.sovereignChange !== 'forge.kernel.changeset.v4') {
    throw new Error(`Clean-install doctor returned an invalid report: ${doctor.stdout}`);
  }

  const inspection = await execFileAsync(process.execPath, [
    cli, 'inspect', '--workspace', workspaceRoot, '--engine-root', engineRoot, '--max-files', '1', '--json',
  ], { cwd: installRoot, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
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
    lifecycle: ['pack', 'clean-install', 'doctor', 'inspect', 'update', 'uninstall'],
  }));
} finally {
  if (process.env.FORGE_KEEP_PACKAGE_SMOKE !== '1') {
    await rm(root, { recursive: true, force: true });
  } else {
    console.error(`Forge package smoke retained at ${root}`);
  }
}
