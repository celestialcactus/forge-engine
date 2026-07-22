import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

const runGit = async (repository: string, ...arguments_: readonly string[]): Promise<void> => {
  await execFileAsync('git', ['-C', repository, ...arguments_], {
    encoding: 'utf8',
    windowsHide: true,
  });
};

const sha256 = (content: Uint8Array): string => createHash('sha256').update(content).digest('hex');

interface BoundedProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly outputTruncated: boolean;
}

interface BoundedProcessOptions {
  readonly cwd: string;
  readonly arguments: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

const runBoundedNodeProcess = async (options: BoundedProcessOptions): Promise<BoundedProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...options.arguments], {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let storedBytes = 0;
    let timedOut = false;
    let aborted = false;

    const capture = (target: Buffer[], chunk: Buffer): void => {
      const remaining = Math.max(0, options.maxOutputBytes - storedBytes);
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
      storedBytes += Math.min(remaining, chunk.byteLength);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      capture(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      capture(stderr, chunk);
    });

    const stopForAbort = (): void => {
      aborted = true;
      child.kill();
    };
    options.signal?.addEventListener('abort', stopForAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', stopForAbort);
      resolve({
        exitCode,
        signal,
        timedOut,
        aborted,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdoutBytes,
        stderrBytes,
        outputTruncated: stdoutBytes + stderrBytes > options.maxOutputBytes,
      });
    });
  });

test('Git worktree boundary isolates committed edits but cannot represent a dirty source base', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-slice2-worktree-'));
  const repository = join(root, 'repository');
  const worktree = join(root, 'worktree');
  await mkdir(repository);
  try {
    await runGit(repository, 'init', '--quiet');
    await runGit(repository, 'config', 'user.name', 'Forge Slice 2 Fixture');
    await runGit(repository, 'config', 'user.email', 'fixture@forge.invalid');
    await writeFile(join(repository, '.gitignore'), 'node_modules/\n', 'utf8');
    await writeFile(join(repository, 'evidence.txt'), 'committed base\n', 'utf8');
    await runGit(repository, 'add', '.');
    await runGit(repository, 'commit', '--quiet', '-m', 'fixture base');

    await mkdir(join(repository, 'node_modules', 'local-only'), { recursive: true });
    await writeFile(join(repository, 'node_modules', 'local-only', 'marker.txt'), 'not portable', 'utf8');
    await writeFile(join(repository, 'evidence.txt'), 'dirty developer base\n', 'utf8');
    const dirtyBase = await readFile(join(repository, 'evidence.txt'));

    await runGit(repository, 'worktree', 'add', '--quiet', '--detach', worktree, 'HEAD');
    const isolatedBase = await readFile(join(worktree, 'evidence.txt'));
    assert.notEqual(sha256(isolatedBase), sha256(dirtyBase));
    await assert.rejects(readFile(join(worktree, 'node_modules', 'local-only', 'marker.txt')));

    await writeFile(join(worktree, 'evidence.txt'), 'candidate change\n', 'utf8');
    assert.equal(await readFile(join(repository, 'evidence.txt'), 'utf8'), 'dirty developer base\n');
  } finally {
    try {
      await runGit(repository, 'worktree', 'remove', '--force', worktree);
    } catch {
      // The experiment reports cleanup separately; final temp cleanup remains best-effort.
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('candidate verification runner bounds combined output without hiding actual byte counts', async () => {
  const result = await runBoundedNodeProcess({
    cwd: tmpdir(),
    arguments: ['-e', 'process.stdout.write("x".repeat(4096)); process.stderr.write("ERR")'],
    timeoutMs: 2_000,
    maxOutputBytes: 256,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
  assert.equal(result.stdoutBytes, 4096);
  assert.equal(result.stderrBytes, 3);
  assert.equal(Buffer.byteLength(result.stdout + result.stderr), 256);
  assert.equal(result.outputTruncated, true);
});

test('candidate verification runner reports timeout and caller cancellation distinctly', async () => {
  const timedOut = await runBoundedNodeProcess({
    cwd: tmpdir(),
    arguments: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 100,
    maxOutputBytes: 256,
  });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.aborted, false);

  const controller = new AbortController();
  const cancellation = runBoundedNodeProcess({
    cwd: tmpdir(),
    arguments: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 2_000,
    maxOutputBytes: 256,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  const aborted = await cancellation;
  assert.equal(aborted.timedOut, false);
  assert.equal(aborted.aborted, true);
});
