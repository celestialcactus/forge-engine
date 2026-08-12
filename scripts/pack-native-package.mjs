import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { repositoryRoot, stageNativePackage } from './native-package.mjs';

const npmCli = process.env.npm_execpath;
if (npmCli === undefined || npmCli.length === 0) {
  throw new Error('Native package packing must be launched through npm.');
}
const staged = await stageNativePackage();
const destination = join(repositoryRoot, 'target', 'native-package-archives');
await mkdir(destination, { recursive: true });
const packed = await promisify(execFile)(process.execPath, [
  npmCli,
  'pack',
  staged.packageRoot,
  '--pack-destination',
  destination,
  '--json',
], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
console.log(packed.stdout.trim());
