import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import {
  RustCandidateTransactionRuntime,
  type CandidateTransactionRequest,
  type RustCandidateTransactionRuntimeOptions,
} from '../../src/hybrid/rust-candidate-transaction-runtime.js';import { signHostBoundaryStatement } from '../../src/hybrid/host-authority-transcript.js';
import {
  RustCandidateLifecycleRuntime,
  type CandidateLifecycleSubject,
  type CandidatePromotionRequest,
  type CandidateDiscardRequest,
} from '../../src/hybrid/rust-candidate-lifecycle-runtime.js';import { createChangeProposalCapability, type ChangeProposalArtifact } from '../../src/v1/change-proposal.js';
import { createWorkspaceSnapshot } from '../../src/v1/workspace.js';

const execFileAsync = promisify(execFile);
const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', 'debug', process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');

interface Fixture {
  readonly root: string;
  readonly repository: string;
  readonly candidates: string;
  readonly request: CandidateTransactionRequest;
}

const git = async (root: string, ...arguments_: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', arguments_, { cwd: root, encoding: 'utf8' });
  return stdout;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const fixture = async (): Promise<Fixture> => {
  const root = await mkdtemp(join(tmpdir(), 'forge-ts-transaction-'));
  const repository = join(root, 'repository');
  const candidates = join(root, 'candidates');
  await mkdir(repository);
  await mkdir(candidates);
  await git(repository, 'init', '--quiet');
  await git(repository, 'config', 'user.name', 'Forge Fixture');
  await git(repository, 'config', 'user.email', 'fixture@forge.invalid');
  await writeFile(join(repository, '.gitattributes'), '* text eol=lf\n', 'utf8');
  await writeFile(join(repository, 'evidence.txt'), 'before\n', 'utf8');
  await git(repository, 'add', '.');
  await git(repository, 'commit', '--quiet', '-m', 'fixture base');
  const expectedBaseRevision = (await git(repository, 'rev-parse', 'HEAD')).trim();
  const snapshot = await createWorkspaceSnapshot(repository);
  const proposalResult = await createChangeProposalCapability(repository).invoke(
    {
      id: 'call-propose',
      capabilityId: 'workspace.change.propose',
      input: {
        changes: [{
          path: 'evidence.txt',
          expectedSha256: sha256('before\n'),
          replacementText: 'after\n',
        }],
      },
    },
    snapshot,
    new AbortController().signal,
  );
  assert.equal(proposalResult.success, true);
  const proposal = JSON.parse(proposalResult.content) as ChangeProposalArtifact;
  assert.equal(proposal.status, 'ready');
  const request: CandidateTransactionRequest = {
    transactionId: 'transaction:typescript-fixture',
    expectedBaseRevision,
    call: {
      id: 'call-apply',
      capabilityId: 'workspace.change.apply',
      input: {
        transactionId: 'transaction:typescript-fixture',
        expectedBaseRevision,
        proposalId: proposal.proposalId,
        snapshotId: proposal.snapshotId,
        verificationCheckId: 'fixture.check',
        isolationProfile: 'trusted',
        isolationProviderId: null,
        isolationBoundaryId: null,
      },
    },
    manifest: {
      schemaVersion: 1,
      proposalId: proposal.proposalId,
      snapshotId: proposal.snapshotId,
      changes: proposal.changes.map((change) => ({
        path: change.path,
        beforeSha256: change.beforeSha256,
        afterSha256: change.afterSha256,
        replacementText: 'after\n',
      })),
    },
    approvalFacts: {
      schemaVersion: 1,
      callId: 'call-apply',
      capabilityId: 'workspace.change.apply',
      hostPolicy: {
        posture: 'allow',
        source: 'fixture.policy',
        reason: 'Fixture allows the exact call.',
      },
      userConsent: {
        status: 'notRequired',
        source: 'fixture.ui',
        reason: 'Fixture does not require interactive consent.',
      },
    },
    verification: {
      checkId: 'fixture.check',
      isolation: { profile: 'trusted' },
    },
  };
  return { root, repository, candidates, request };
};

const runtimeOptions = (
  value: Fixture,
  script: string,
  environment: RustCandidateTransactionRuntimeOptions['verificationChecks'][number]['environment'] = [],
  inheritEnvironment: readonly string[] = [],
  kernelEnvironment?: Readonly<NodeJS.ProcessEnv>,
): RustCandidateTransactionRuntimeOptions => ({
  kernelPath: kernelBinary,
  repositoryRoot: value.repository,
  candidateParent: value.candidates,
  ...(kernelEnvironment === undefined ? {} : { kernelEnvironment }),
  verificationChecks: [{
    checkId: 'fixture.check',
    executable: process.execPath,
    arguments: ['-e', script],
    environment,
    inheritEnvironment,
    timeoutMs: 10_000,
    maxOutputBytes: 4_096,
  }],
  requestIdFactory: () => 'request:typescript-fixture',
});

test('TypeScript host invokes a verified Rust-owned candidate transaction end to end', async () => {
  assert.equal(existsSync(kernelBinary), true, 'Build forge-kernel or set FORGE_KERNEL_BINARY.');
  const value = await fixture();
  try {
    const runtime = new RustCandidateTransactionRuntime(runtimeOptions(
      value,
      "const fs=require('node:fs');process.exit(fs.readFileSync('evidence.txt','utf8')==='after\\n'?0:1)",
    ));
    const artifact = await runtime.execute(value.request);
    assert.equal(artifact.status, 'verified_candidate');
    assert.match(artifact.retention?.candidateId ?? '', /^candidate:/u);
    assert.equal(await readFile(join(value.repository, 'evidence.txt'), 'utf8'), 'before\n');
    const candidates = (await readdir(value.candidates)).filter((entry) => entry !== '.forge-leases');
    assert.equal(candidates.length, 1);
    assert.equal(await readFile(join(value.candidates, candidates[0] as string, 'evidence.txt'), 'utf8'), 'after\n');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

const hostRuntime = (
  value: Fixture,
  options: { readonly invalidSignature?: boolean; readonly marker?: string; readonly stallAttestor?: boolean } = {},
): RustCandidateTransactionRuntime => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyHex = publicDer.subarray(publicDer.byteLength - 32).toString('hex');
  const base = runtimeOptions(
    value,
    options.marker === undefined
      ? "const fs=require('node:fs');process.exit(fs.readFileSync('evidence.txt','utf8')==='after\\n'?0:1)"
      : "const fs=require('node:fs');fs.writeFileSync(process.env.FORGE_TEST_MARKER,'started')",
    options.marker === undefined ? [] : [{ name: 'FORGE_TEST_MARKER', value: options.marker }],
  );
  return new RustCandidateTransactionRuntime({
    ...base,
    verificationChecks: base.verificationChecks.map((check) => ({
      ...check,
      isolationPolicy: {
        profile: 'host_managed',
        requiredControls: ['process', 'filesystem'],
        allowedHostProviderIds: ['fixture.host'],
      },
    })),
    hostAuthority: {
      ledgerRoot: join(value.root, 'host-authority-ledger'),
      trustedKeys: [{
        providerId: 'fixture.host',
        keyId: 'fixture-key',
        publicKeyHex,
      }],
      challengeTtlMs: 5_000,
    },
    hostAttestor: (challenge) => {
      if (options.stallAttestor === true) return new Promise(() => {});
      const statement = {
        challengeId: challenge.challengeId,
        keyId: 'fixture-key',
        boundaryId: 'boundary:typescript-host',
        processBoundaryInherited: true,
        attestedControls: ['process', 'filesystem'] as const,
      };
      return options.invalidSignature === true
        ? { statement, signatureHex: '00'.repeat(64) }
        : signHostBoundaryStatement(challenge, statement, privateKey);
    },
  });
};

const hostRequest = (value: Fixture): CandidateTransactionRequest => ({
  ...value.request,
  call: {
    ...value.request.call,
    input: {
      ...(value.request.call.input as Record<string, unknown>),
      isolationProfile: 'host_managed',
      isolationProviderId: 'fixture.host',
      isolationBoundaryId: null,
    },
  },
  verification: {
    ...value.request.verification,
    isolation: { profile: 'host_managed', hostProviderId: 'fixture.host' },
  },
});

test('TypeScript relays one Rust-bound host challenge and receives auditable host evidence', async () => {
  assert.equal(existsSync(kernelBinary), true, 'Build forge-kernel or set FORGE_KERNEL_BINARY.');
  const value = await fixture();
  try {
    const artifact = await hostRuntime(value).execute(hostRequest(value));
    assert.equal(artifact.status, 'verified_candidate');
    const authorization = artifact.hostAuthorization as {
      readonly capabilityDigest?: string;
      readonly policyDigest?: string;
      readonly authority?: {
        readonly challenge?: { readonly providerId?: string };
        readonly statement?: { readonly boundaryId?: string };
      };
    } | undefined;
    assert.match(authorization?.capabilityDigest ?? '', /^[0-9a-f]{64}$/u);
    assert.match(authorization?.policyDigest ?? '', /^[0-9a-f]{64}$/u);
    assert.equal(authorization?.authority?.challenge?.providerId, 'fixture.host');
    assert.equal(authorization?.authority?.statement?.boundaryId, 'boundary:typescript-host');
    const verification = artifact.verification as {
      readonly isolation?: {
        readonly enforcement?: string;
        readonly forgeEnforced?: boolean;
        readonly hostAuthority?: unknown;
      };
    } | undefined;
    assert.equal(verification?.isolation?.enforcement, 'host_attested');
    assert.equal(verification?.isolation?.forgeEnforced, false);
    assert.notEqual(verification?.isolation?.hostAuthority, undefined);
    assert.equal(await readFile(join(value.repository, 'evidence.txt'), 'utf8'), 'before\n');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('invalid host signature recovers before candidate application or verifier launch', async () => {
  assert.equal(existsSync(kernelBinary), true, 'Build forge-kernel or set FORGE_KERNEL_BINARY.');
  const value = await fixture();
  const marker = join(value.root, 'host-verifier-started');
  try {
    const artifact = await hostRuntime(value, { invalidSignature: true, marker })
      .execute(hostRequest(value));
    assert.equal(artifact.status, 'recovered');
    assert.equal(artifact.hostAuthorization, undefined);
    assert.equal(artifact.application, undefined);
    assert.equal(artifact.verification, undefined);
    assert.equal(existsSync(marker), false);
    assert.equal(await readFile(join(value.repository, 'evidence.txt'), 'utf8'), 'before\n');
    const candidates = (await readdir(value.candidates)).filter((entry) => entry !== '.forge-leases');
    assert.deepEqual(candidates, []);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test('cancellation during host negotiation recovers the prepared boundary without applying', async () => {
  assert.equal(existsSync(kernelBinary), true, 'Build forge-kernel or set FORGE_KERNEL_BINARY.');
  const value = await fixture();
  const marker = join(value.root, 'cancelled-host-verifier-started');
  try {
    const controller = new AbortController();
    const execution = hostRuntime(value, { stallAttestor: true, marker })
      .execute(hostRequest(value), controller.signal);
    const pendingRoot = join(value.root, 'host-authority-ledger', 'pending');
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (existsSync(pendingRoot) && (await readdir(pendingRoot)).length > 0) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.equal(existsSync(pendingRoot), true, 'host challenge was not issued');
    controller.abort(new Error('Cancel host negotiation fixture.'));
    const artifact = await execution;
    assert.equal(artifact.status, 'cancelled');
    assert.equal(artifact.application, undefined);
    assert.equal(artifact.verification, undefined);
    assert.equal(existsSync(marker), false);
    const candidates = (await readdir(value.candidates)).filter((entry) => entry !== '.forge-leases');
    assert.deepEqual(candidates, []);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test('verifier environment excludes inherited secrets unless policy explicitly allows them', async () => {
  assert.equal(existsSync(kernelBinary), true, 'Build forge-kernel or set FORGE_KERNEL_BINARY.');
  const value = await fixture();
  try {
    const runtime = new RustCandidateTransactionRuntime(runtimeOptions(
      value,
      "const e=process.env;process.exit(e.PATH&&e.FORGE_FIXED_ENV==='fixed-value'&&e.FORGE_ALLOWED_ENV==='allowed-value'&&e.FORGE_SECRET_SHOULD_NOT_LEAK===undefined?0:1)",
      [{ name: 'FORGE_FIXED_ENV', value: 'fixed-value' }],
      ['FORGE_ALLOWED_ENV'],
      {
        FORGE_ALLOWED_ENV: 'allowed-value',
        FORGE_SECRET_SHOULD_NOT_LEAK: 'secret-value',
      },
    ));
    const artifact = await runtime.execute(value.request);
    assert.equal(artifact.status, 'verified_candidate');
    const verification = artifact.verification as {
      readonly environment?: {
        readonly cleared?: boolean;
        readonly inheritedNames?: readonly string[];
        readonly fixedNames?: readonly string[];
      };
    } | undefined;
    assert.equal(verification?.environment?.cleared, true);
    assert.equal(verification?.environment?.inheritedNames?.includes('FORGE_ALLOWED_ENV'), true);
    assert.deepEqual(verification?.environment?.fixedNames, ['FORGE_FIXED_ENV']);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test('TypeScript abort is carried into Rust verification and recovers the candidate', async () => {
  assert.equal(existsSync(kernelBinary), true, 'Build forge-kernel or set FORGE_KERNEL_BINARY.');
  const value = await fixture();
  const marker = join(value.root, 'verifier-started');
  try {
    const runtime = new RustCandidateTransactionRuntime(runtimeOptions(
      value,
      "const fs=require('node:fs');fs.writeFileSync(process.env.FORGE_TEST_MARKER,'started');setTimeout(()=>{},10000)",
      [{ name: 'FORGE_TEST_MARKER', value: marker }],
    ));
    const controller = new AbortController();
    const execution = runtime.execute(value.request, controller.signal);
    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.equal(existsSync(marker), true, 'verification did not start');
    controller.abort(new Error('Fixture requested cancellation.'));
    const artifact = await execution;
    assert.equal(artifact.status, 'cancelled');
    assert.equal((artifact.recovery as { readonly success?: boolean } | undefined)?.success, true);
    assert.equal(await readFile(join(value.repository, 'evidence.txt'), 'utf8'), 'before\n');
    const candidates = (await readdir(value.candidates)).filter((entry) => entry !== '.forge-leases');
    assert.deepEqual(candidates, []);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test('TypeScript transport inspects, promotes, and discards through the Rust lifecycle authority', async () => {
  assert.equal(existsSync(kernelBinary), true, 'Build forge-kernel or set FORGE_KERNEL_BINARY.');
  const value = await fixture();
  try {
    const transaction = new RustCandidateTransactionRuntime(runtimeOptions(
      value,
      "const fs=require('node:fs');process.exit(fs.readFileSync('evidence.txt','utf8')==='after\\n'?0:1)",
    ));
    const candidate = await transaction.execute(value.request);
    const candidateId = candidate.retention?.candidateId;
    assert.match(candidateId ?? '', /^candidate:/u);

    const lifecycle = new RustCandidateLifecycleRuntime({
      kernelPath: kernelBinary,
      repositoryRoot: value.repository,
      candidateParent: value.candidates,
      requestIdFactory: () => 'request:lifecycle-fixture',
    });
    const inspection = await lifecycle.inspect(candidateId as string);
    assert.equal(inspection.state, 'retained');
    assert.equal(inspection.candidateValid, true);
    assert.equal(inspection.activeWorkspaceClean, true);
    const approval = (
      callId: string,
      capabilityId: string,
    ): CandidatePromotionRequest['approvalFacts'] => ({
      schemaVersion: 1,
      callId,
      capabilityId,
      hostPolicy: {
        posture: 'allow',
        source: 'fixture.policy',
        reason: 'Fixture allows this exact lifecycle call.',
      },
      userConsent: {
        status: 'notRequired',
        source: 'fixture.ui',
        reason: 'Fixture does not require interactive consent.',
      },
    });
    const promoteCallId = 'call:promote-fixture';
    const promotion: CandidatePromotionRequest = {
      promotionId: 'promotion:typescript-fixture',
      subject: inspection.subject,
      call: {
        id: promoteCallId,
        capabilityId: 'workspace.candidate.promote',
        input: {
          promotionId: 'promotion:typescript-fixture',
          subject: inspection.subject,
        },
      },
      approvalFacts: approval(promoteCallId, 'workspace.candidate.promote'),
    };
    const promoted = await lifecycle.promote(promotion);
    assert.equal(promoted.status, 'promoted');
    assert.equal(await readFile(join(value.repository, 'evidence.txt'), 'utf8'), 'after\n');
    assert.equal((await lifecycle.inspect(candidateId as string)).state, 'promoted');

    const discardCallId = 'call:discard-fixture';
    const discard: CandidateDiscardRequest = {
      discardId: 'discard:typescript-fixture',
      subject: inspection.subject as CandidateLifecycleSubject,
      call: {
        id: discardCallId,
        capabilityId: 'workspace.candidate.discard',
        input: {
          discardId: 'discard:typescript-fixture',
          subject: inspection.subject,
        },
      },
      approvalFacts: approval(discardCallId, 'workspace.candidate.discard'),
    };
    const discarded = await lifecycle.discard(discard);
    assert.equal(discarded.status, 'discarded');
    const candidates = (await readdir(value.candidates)).filter((entry) => entry !== '.forge-leases');
    assert.deepEqual(candidates, []);
    assert.equal(await readFile(join(value.repository, 'evidence.txt'), 'utf8'), 'after\n');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
