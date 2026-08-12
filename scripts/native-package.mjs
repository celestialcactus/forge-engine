import { access, chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const supportedTargets = new Set([
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
]);

export const currentNativeTarget = () => {
  const target = `${process.platform}-${process.arch}`;
  if (!supportedTargets.has(target)) {
    throw new Error(`ForgeEngine has no native package contract for ${target}.`);
  }
  return target;
};

export const nativePackageName = (target = currentNativeTarget()) =>
  `forge-engine-kernel-${target}`;

const requireFile = async (path, label) => {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`${label} is unavailable at ${path}. Build the release workspace first.`);
  }
};

export const stageNativePackage = async (target = currentNativeTarget()) => {
  if (!supportedTargets.has(target)) throw new Error(`Unsupported Forge native target ${target}.`);
  const [platform, architecture] = target.split('-');
  const packageName = nativePackageName(target);
  const templateRoot = join(repositoryRoot, 'packages', packageName);
  const manifest = JSON.parse(await readFile(join(templateRoot, 'package.json'), 'utf8'));
  if (manifest.name !== packageName
    || manifest.private !== true
    || manifest.forgeTarget?.platform !== platform
    || manifest.forgeTarget?.architecture !== architecture) {
    throw new Error(`Native package manifest does not match ${target}.`);
  }

  const executableSuffix = platform === 'win32' ? '.exe' : '';
  const releaseRoot = join(repositoryRoot, 'target', 'release');
  const kernelSource = join(releaseRoot, `forge-kernel${executableSuffix}`);
  const watchdogSource = join(releaseRoot, `forge-process-watchdog${executableSuffix}`);
  await requireFile(kernelSource, 'Forge release kernel');
  if (platform !== 'win32') await requireFile(watchdogSource, 'Forge release watchdog');

  const packageRoot = join(repositoryRoot, 'target', 'native-packages', packageName);
  const binRoot = join(packageRoot, 'bin');
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(binRoot, { recursive: true });
  const { private: _private, forgeTarget: _forgeTarget, ...publishableManifest } = manifest;
  await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
    ...publishableManifest,
    os: [platform],
    cpu: [architecture],
  }, null, 2)}\n`, 'utf8');
  const kernelDestination = join(binRoot, `forge-kernel${executableSuffix}`);
  await copyFile(kernelSource, kernelDestination);
  if (platform !== 'win32') {
    const watchdogDestination = join(binRoot, 'forge-process-watchdog');
    await copyFile(watchdogSource, watchdogDestination);
    await chmod(watchdogDestination, 0o755);
    await chmod(kernelDestination, 0o755);
  }
  return { target, packageName, packageRoot, binRoot, kernelDestination };
};
