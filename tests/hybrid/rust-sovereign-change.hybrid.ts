import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import type { ApprovalFacts, CapabilityCall } from '../../src/slice0/contracts.js';
import {
  RustSovereignChangeRuntime,
  type SovereignChangeProposal,
} from '../../src/hybrid/rust-sovereign-change-runtime.js';
import type { TrustedVerificationCheckConfiguration } from '../../src/hybrid/verification-configuration.js';

const execFileAsync = promisify(execFile);
const kernelBinary = process.env.FORGE_KERNEL_BINARY;
const cli = resolve('dist/src/cli.js');

interface Fixture {
  readonly root: string;
  readonly repository: string;
  readonly engine: string;
  readonly proposal: string;
  readonly proposalValue: SovereignChangeProposal;
  readonly policy: string;
  readonly checks: readonly TrustedVerificationCheckConfiguration[];
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
  const proposalValue: SovereignChangeProposal = {
    schemaVersion: 1,
    operations: [{
      kind: 'replace',
      path: 'message.txt',
      after: { encoding: 'utf8', value: 'after\n' },
    }],
  };
  await writeFile(proposal, JSON.stringify(proposalValue));
  const policy = join(root, 'policy.json');
  const verificationScript = verificationSucceeds
    ? "const fs=require('node:fs');if(fs.readFileSync('message.txt','utf8')!=='after\\n')process.exit(7)"
    : 'process.exit(9)';
  const checks: readonly TrustedVerificationCheckConfiguration[] = [{
    checkId: 'candidate-content',
    executable: process.execPath,
    arguments: ['-e', verificationScript],
    timeoutMs: 10_000,
    maxOutputBytes: 16_384,
  }];
  await writeFile(policy, JSON.stringify({ schemaVersion: 1, checks }));
  return { root, repository, engine, proposal, proposalValue, policy, checks };
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

const forgeFailure = async (fixture_: Fixture, ...arguments_: string[]): Promise<string> => {
  try {
    await forge(fixture_, ...arguments_);
  } catch (error) {
    const failure = error as { readonly stderr?: string };
    return failure.stderr ?? String(error);
  }
  assert.fail('Forge command unexpectedly succeeded.');
};

const transactionId = (artifact: Record<string, unknown>): string => {
  const transaction = artifact.transaction as Record<string, unknown> | undefined;
  assert.ok(transaction);
  assert.equal(typeof transaction.transactionId, 'string');
  return transaction.transactionId as string;
};

test('CLI prepares exact change identity before approval and does not create a candidate when consent is absent', {
  skip: kernelBinary === undefined ? 'FORGE_KERNEL_BINARY is required.' : false,
}, async () => {
  const f = await fixture();
  try {
    const stderr = await forgeFailure(f, 'change', 'propose', f.proposal, '--policy', f.policy);
    assert.match(stderr, /prepared changeset:sha256:[0-9a-f]+; rerun with --approve/u);
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'before\n');
    const entries = await readdir(f.engine, { recursive: true });
    assert.equal(entries.some((entry) => entry.includes('forge-v2-')), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('Rust rejects a prepared ChangeSet when the workspace changes before approved candidate execution', {
  skip: kernelBinary === undefined ? 'FORGE_KERNEL_BINARY is required.' : false,
}, async () => {
  const f = await fixture();
  try {
    const runtime = new RustSovereignChangeRuntime({
      kernelPath: kernelBinary as string,
      repositoryRoot: f.repository,
      engineRoot: f.engine,
      verificationChecks: f.checks,
    });
    const prepared = await runtime.prepare(f.proposalValue);
    await writeFile(join(f.repository, 'message.txt'), 'raced!\n');
    const call: CapabilityCall = {
      id: 'call:stale-change-set',
      capabilityId: 'workspace.change.propose',
      input: {
        changeSetId: prepared.changeSetId,
        selectedCheckIds: ['candidate-content'],
      },
    };
    const approvalFacts: ApprovalFacts = {
      schemaVersion: 1,
      callId: call.id,
      capabilityId: call.capabilityId,
      hostPolicy: {
        posture: 'ask',
        source: 'test',
        reason: 'Test exact prepared identity.',
      },
      userConsent: {
        status: 'granted',
        source: 'test',
        reason: 'Test exact prepared identity.',
      },
    };
    const result = await runtime.propose(
      f.proposalValue,
      prepared.changeSetId,
      ['candidate-content'],
      call,
      approvalFacts,
    );
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.equal(result.outcome.status, 'unmet');
    assert.match(result.failure ?? '', /Prepared ChangeSet no longer matches/u);
    assert.equal(result.transaction, undefined);
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'raced!\n');
    const entries = await readdir(f.engine, { recursive: true });
    assert.equal(entries.some((entry) => entry.includes('forge-v2-')), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('CLI proposes, persists, inspects, and idempotently accepts one ChangeSet v2 transaction', {
  skip: kernelBinary === undefined ? 'FORGE_KERNEL_BINARY is required.' : false,
}, async () => {
  const f = await fixture();
  try {
    const proposed = await forge(f, 'change', 'propose', f.proposal, '--policy', f.policy, '--approve');
    assert.equal(proposed.schemaVersion, 2, JSON.stringify(proposed));
    assert.equal(proposed.status, 'verified_candidate', JSON.stringify(proposed));
    const approvedCall = proposed.approvedCall as Record<string, unknown>;
    const approvedInput = approvedCall.input as Record<string, unknown>;
    const approval = proposed.approval as Record<string, unknown>;
    assert.equal(approval.outcome, 'allow');
    const changeSet = proposed.changeSet as Record<string, unknown>;
    assert.equal(approvedInput.changeSetId, changeSet.changeSetId);
    const outcome = proposed.outcome as Record<string, unknown>;
    assert.equal(outcome.status, 'verified', JSON.stringify(proposed));
    const contract = proposed.outcomeContract as Record<string, unknown>;
    const requirements = contract.requirements as Array<Record<string, unknown>>;
    assert.equal(requirements.length, 3);
    assert.equal(requirements[0]?.expected, changeSet.changeSetId);
    assert.equal(requirements[1]?.capabilityId, 'verification.check.candidate-content');
    assert.equal(requirements[2]?.capabilityId, 'workspace.change.candidate.registered');
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

    const audit = await forge(f, 'change', 'audit');
    assert.equal(audit.schemaVersion, 1);
    assert.equal(audit.truncated, false);
    assert.equal(audit.orphanStagingRemoved, 0);
    const audited = audit.transactions as Array<Record<string, unknown>>;
    assert.equal(audited.length, 1);
    assert.equal(audited[0]?.transactionId, id);
    assert.equal(audited[0]?.state, 'prepared');
    assert.equal(audited[0]?.candidateRetained, true);
    assert.equal(audited[0]?.recommendation, 'review_prepared');

    const accepted = await forge(f, 'change', 'accept', id, '--approve');
    assert.equal(accepted.state, 'promoted');
    assert.equal(accepted.candidateRetained, false);
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'after\n');

    const repeated = await forge(f, 'change', 'accept', id, '--approve');
    assert.equal(repeated.state, 'promoted');
    assert.equal(repeated.candidateRetained, false);

    const terminalAudit = await forge(f, 'change', 'audit');
    const terminal = terminalAudit.transactions as Array<Record<string, unknown>>;
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0]?.transactionId, id);
    assert.equal(terminal[0]?.state, 'promoted');
    assert.equal(terminal[0]?.candidateRetained, false);
    assert.equal(terminal[0]?.recommendation, 'none');
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
    assert.equal(discarded.state, 'discarded');
    assert.equal(discarded.candidateRetained, false);
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'before\n');
    const repeated = await forge(f, 'change', 'discard', id, '--approve');
    assert.equal(repeated.state, 'discarded');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('CLI audit reports startup cleanup of exact unpublished transaction staging', {
  skip: kernelBinary === undefined ? 'FORGE_KERNEL_BINARY is required.' : false,
}, async () => {
  const f = await fixture();
  try {
    const initial = await forge(f, 'change', 'audit');
    assert.equal(initial.orphanStagingRemoved, 0);
    const human = await execFileAsync(process.execPath, [
      cli,
      'change',
      'audit',
      '--workspace', f.repository,
      '--engine-root', f.engine,
    ], {
      env: { ...process.env, FORGE_KERNEL_BINARY: kernelBinary },
      encoding: 'utf8',
    });
    assert.match(human.stdout, /Forge transaction audit: 0/u);
    assert.match(human.stdout, /No durable ChangeSet transactions found\./u);
    const entries = await readdir(f.engine, { recursive: true });
    const relativeState = entries.find((entry) => /(?:^|[\\/])transactions$/u.test(entry));
    assert.notEqual(relativeState, undefined);
    const stateRoot = join(f.engine, relativeState as string);
    const staging = join(
      stateRoot,
      `.transaction-${'a'.repeat(64)}-${String(process.pid)}-${String(Date.now())}.tmp`,
    );
    await mkdir(staging);

    const audit = await forge(f, 'change', 'audit');
    assert.equal(audit.orphanStagingRemoved, 1);
    assert.deepEqual(audit.transactions, []);
    await assert.rejects(readdir(staging), /ENOENT/u);
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
    assert.equal(proposed.status, 'verification_failed', JSON.stringify(proposed));
    assert.equal((proposed.outcome as Record<string, unknown>).status, 'unmet');
    assert.equal(proposed.transaction, undefined);
    assert.equal(typeof proposed.candidateCleanup, 'string', JSON.stringify(proposed));
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'before\n');
    const entries = await readdir(f.engine, { recursive: true });
    assert.equal(entries.some((entry) => entry.includes('forge-v2-')), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test('a missing policy verifier fails honestly and still removes the candidate', {
  skip: kernelBinary === undefined ? 'FORGE_KERNEL_BINARY is required.' : false,
}, async () => {
  const f = await fixture();
  try {
    await writeFile(f.policy, JSON.stringify({
      schemaVersion: 1,
      checks: [{
        checkId: 'missing',
        executable: join(f.root, 'missing-verifier'),
        timeoutMs: 10_000,
        maxOutputBytes: 16_384,
      }],
    }));
    const proposed = await forge(f, 'change', 'propose', f.proposal, '--policy', f.policy, '--approve');
    assert.equal(proposed.status, 'failed');
    assert.equal(proposed.transaction, undefined);
    assert.equal(typeof proposed.candidateCleanup, 'string', JSON.stringify(proposed));
    assert.match(String(proposed.failure), /execute policy verification check/u);
    assert.equal(await readFile(join(f.repository, 'message.txt'), 'utf8'), 'before\n');
    const entries = await readdir(f.engine, { recursive: true });
    assert.equal(entries.some((entry) => entry.includes('forge-v2-')), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
