import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  probeForgeKernelBinary,
  requireForgeKernelBinary,
  resolveForgeKernelBinary,
} from '../src/hybrid/kernel-binary.js';

const withFixture = async (context: { after(callback: () => Promise<void>): void }) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-kernel-resolution-'));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
};

test('kernel discovery prefers an explicit path and fails closed when it is invalid', async (context) => {
  const root = await withFixture(context);
  const missing = join(root, 'missing-kernel');
  const resolution = resolveForgeKernelBinary({ configuredPath: missing, packageRoot: root });
  assert.equal(resolution.ready, false);
  assert.deepEqual(resolution.searchedPaths, [missing]);
  assert.throws(() => requireForgeKernelBinary(resolution), /not an executable file/u);
});

test('kernel discovery selects a source build without an environment override', async (context) => {
  const root = await withFixture(context);
  const executable = process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel';
  const binary = join(root, 'target', 'debug', executable);
  await mkdir(join(root, 'target', 'debug'), { recursive: true });
  await writeFile(binary, 'fixture', 'utf8');
  if (process.platform !== 'win32') await chmod(binary, 0o755);
  const resolution = resolveForgeKernelBinary({ packageRoot: root, environment: {} });
  assert.equal(resolution.ready, true);
  assert.equal(resolution.source, 'source-debug');
  assert.equal(requireForgeKernelBinary(resolution), realpathSync(binary));
});

test('kernel discovery selects the newest source build instead of a stale release binary', async (context) => {
  const root = await withFixture(context);
  const executable = process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel';
  const release = join(root, 'target', 'release', executable);
  const debug = join(root, 'target', 'debug', executable);
  await mkdir(join(root, 'target', 'release'), { recursive: true });
  await mkdir(join(root, 'target', 'debug'), { recursive: true });
  await writeFile(release, 'old release', 'utf8');
  await writeFile(debug, 'new debug', 'utf8');
  if (process.platform !== 'win32') {
    await chmod(release, 0o755);
    await chmod(debug, 0o755);
  }
  await utimes(release, new Date(1_000), new Date(1_000));
  await utimes(debug, new Date(2_000), new Date(2_000));

  const resolution = resolveForgeKernelBinary({ packageRoot: root, environment: {} });
  assert.equal(resolution.ready, true);
  assert.equal(resolution.source, 'source-debug');
  assert.equal(requireForgeKernelBinary(resolution), realpathSync(debug));
});

test('kernel discovery selects only a version-and-host-matched optional native package', async (context) => {
  const root = await withFixture(context);
  const target = `${process.platform}-${process.arch}`;
  const packageName = `forge-engine-kernel-${target}`;
  const executable = process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel';
  const nativeRoot = join(root, 'node_modules', packageName);
  const binary = join(nativeRoot, 'bin', executable);
  await mkdir(join(nativeRoot, 'bin'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'forge-engine', version: '0.1.0' }));
  await writeFile(join(nativeRoot, 'package.json'), JSON.stringify({
    name: packageName,
    version: '0.1.0',
    os: [process.platform],
    cpu: [process.arch],
  }));
  await writeFile(binary, 'fixture', 'utf8');
  if (process.platform !== 'win32') await chmod(binary, 0o755);

  const resolution = resolveForgeKernelBinary({ packageRoot: root, environment: {} });
  assert.equal(resolution.ready, true);
  assert.equal(resolution.source, 'packaged');
  assert.equal(requireForgeKernelBinary(resolution), realpathSync(binary));

  await writeFile(join(nativeRoot, 'package.json'), JSON.stringify({
    name: packageName,
    version: '0.2.0',
    os: [process.platform],
    cpu: [process.arch],
  }));
  const mismatch = resolveForgeKernelBinary({ packageRoot: root, environment: {} });
  assert.equal(mismatch.ready, false);
  assert.match(mismatch.message, /does not match ForgeEngine 0\.1\.0/u);
});

test('an invalid environment override does not silently fall through to another kernel', async (context) => {
  const root = await withFixture(context);
  const executable = process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel';
  const binary = join(root, 'target', 'release', executable);
  await mkdir(join(root, 'target', 'release'), { recursive: true });
  await writeFile(binary, 'fixture', 'utf8');
  if (process.platform !== 'win32') await chmod(binary, 0o755);
  const missing = join(root, 'explicitly-missing');
  const resolution = resolveForgeKernelBinary({
    packageRoot: root,
    environment: { FORGE_KERNEL_BINARY: missing },
  });
  assert.equal(resolution.ready, false);
  assert.deepEqual(resolution.searchedPaths, [missing]);
});


test('kernel probe rejects an executable that does not implement the Forge protocol', async () => {
  const resolution = resolveForgeKernelBinary({ configuredPath: process.execPath });
  assert.equal(resolution.ready, true);
  const probe = await probeForgeKernelBinary(resolution);
  assert.equal(probe.ready, false);
  assert.match(probe.message, /probe (?:exited|returned invalid output)/u);
});
