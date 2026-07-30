import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const kernelBinary = process.env.FORGE_KERNEL_BINARY;
const cli = resolve('dist/src/cli.js');

interface Fixture {
  readonly root: string;
  readonly repository: string;
  readonly engine: string;
  readonly proposal: string;
  readonly policy: string;
}

const git = async (root: string, ...arguments_: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', arguments_, { cwd: root, encoding: 'utf8' });
  return stdout.trim();
};

const fixture = async (verificationSucceeds = true): Promise<Fixture> => {
  const root = await mkdtemp(join(tmpdir(), 'forge-sovereign-change-'));
  const repository = join(root, 'repository');
  const engine = join(root, 'engine');
  await mkdir(repository);
  await mkdir(engine);
  await git(repository, 'init', '--quiet');
  await git(repository, 'config', 'user.email', 'forge@example.test');
  await git(repository, 'config', 'user.name', 'Forge Test');
  await git(repository, 'config', 'core.autocrlf', 'false');
  await writeFile(join(repository, 'message.txt'), 'before\n');
  await git(repository, 'add', '.');
  await git(repository, 'commit', '--quiet', '-m', 'base');
  const proposal = join(root, 'proposal.json');
  await writeFile(proposal, JSON.stringify({
    schemaVersion: 1,
    operations: [{
      kind: 'replace',
      path: 'message.txt',
      after: { encoding: 'utf8', value: 'after\n' },
    }],
  }));
  const policy = join(root, 'policy.json');
  const verificationScript = verificationSucceeds
    ? "const fs=require('node:fs');if(fs.readFileSync('message.txt','utf8')!=='after\\n')process.exit(7)"
    : 'process.exit(9)';
  await writeFile(policy, JSON.stringify({
    schemaVersion: 1,
    checks: [{
      checkId: 'candidate-content',
      executable: process.execPath,
      arguments: ['-e', verificationScript],
      timeoutMs: 10_000,
      maxOutputBytes: 16_384,
    }],
  }));
  return { root, repository, engine, proposal, policy };
};

const forge = async (fixture_: Fixture, ...arguments_: string[]): Promise<Record<string, unknown>> => {
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    ...arguments_,
    '--workspace', fixture_.repository,
    '--engine-root', fixture_.engine,
    '--json',
  ], {
    env: { ...process.env, FORGE_KERNEL_BINARY: kernelBinary },
    encoding: 'utf8',
    maxBuffer: 4 * 1_048_576,
  });
  return JSON.parse(stdout) as Record<string, unknown>;
};

const transactionId = (artifact: Record<string, unknown>): string => {
  const transaction = artifact.transaction as Record<string, unknown> | undefined;
  assert.ok(transaction);
  assert.equal(typeof transaction.transactionId, 'string');
  return transaction.transactionId as string;
};

test('CLI proposes, persists, inspects, and idempotently accepts one ChangeSet v2 transaction', {
  skip: kernelBinary === undefined ? 'FORGE_KERNEL_BINARY is required.' : false,
}, async () => {
  const f = await fixture();
  try {
    const proposed = await forge(f, 'change', 'propose', f.proposal, '--policy', f.policy, '--approve');
    assert.equal(proposed.status, 'verified_candidate');
    const id = transactionId(proposed);
    const proposedTransaction = proposed.transaction as Record<string, unknown>;
    assert.equal(proposedTransaction.state, 'prepared');
    assert.equal(proposedTransaction.candidateRetained, true);
    assert.equal((proposedTransaction.verification as unknown[]).length, 1);
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'before\n');

    const inspected = await forge(f, 'change', 'inspect', id);
    assert.equal(inspected.state, 'prepared');
    assert.equal(inspected.candidateRetained, true);
    assert.equal((inspected.verification as unknown[]).length, 1);

    const accepted = await forge(f, 'change', 'accept', id, '--approve');
    assert.equal(accepted.state, 'promoted');
    assert.equal(accepted.candidateRetained, false);
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'after\n');

    const repeated = await forge(f, 'change', 'accept', id, '--approve');
    assert.equal(repeated.state, 'promoted');
    assert.equal(repeated.candidateRetained, false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('CLI discards a verified candidate without mutating the active workspace', {
  skip: kernelBinary === undefined ? 'FORGE_KERNEL_BINARY is required.' : false,
}, async () => {
  const f = await fixture();
  try {
    const proposed = await forge(f, 'change', 'propose', f.proposal, '--policy', f.policy, '--approve');
    const id = transactionId(proposed);
    const discarded = await forge(f, 'change', 'discard', id, '--approve');
    assert.equal(discarded.state, 'rolled_back');
    assert.equal(discarded.candidateRetained, false);
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'before\n');
    const repeated = await forge(f, 'change', 'discard', id, '--approve');
    assert.equal(repeated.state, 'rolled_back');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('failed verification cleans the candidate and never registers an acceptable transaction', {
  skip: kernelBinary === undefined ? 'FORGE_KERNEL_BINARY is required.' : false,
}, async () => {
  const f = await fixture(false);
  try {
    const proposed = await forge(f, 'change', 'propose', f.proposal, '--policy', f.policy, '--approve');
    assert.equal(proposed.status, 'verification_failed');
    assert.equal(proposed.transaction, undefined);
    assert.equal(typeof proposed.candidateCleanup, 'string');
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'before\n');
    const entries = await readdir(f.engine, { recursive: true });
    assert.equal(entries.some((entry) => entry.includes('forge-v2-')), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});