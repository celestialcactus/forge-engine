import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
  assert.equal(requireForgeKernelBinary(resolution), await realpath(binary));
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
