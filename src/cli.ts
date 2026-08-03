#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ApprovalFacts, CapabilityCall, RunArtifact } from './slice0/contracts.js';
import { startForgeMcpServer } from './mcp/server.js';
import {
  probeForgeKernelBinary,
  requireForgeKernelBinary,
  resolveForgeKernelBinary,
} from './hybrid/kernel-binary.js';
import {
  RustCandidateLifecycleRuntime,
  type CandidateLifecycleSubject,
} from './hybrid/rust-candidate-lifecycle-runtime.js';
import type { TrustedVerificationCheckConfiguration } from './hybrid/rust-candidate-transaction-runtime.js';
import {
  RustSovereignChangeRuntime,
  type SovereignChangeProposal,
} from './hybrid/rust-sovereign-change-runtime.js';
import { artifactPayload, ForgeWorkspaceService, type ForgeWorkspaceServiceOptions } from './v1/service.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    workspace: { type: 'string' },
    config: { type: 'string' },
    policy: { type: 'string' },
    check: { type: 'string' },
    staged: { type: 'boolean', default: false },
    'case-sensitive': { type: 'boolean', default: false },
    'max-files': { type: 'string' },
    'max-matches': { type: 'string' },
    'start-line': { type: 'string' },
    'max-lines': { type: 'string' },
    'max-symbols': { type: 'string' },
    'max-diagnostics': { type: 'string' },
    'max-bytes': { type: 'string' },
    'candidate-parent': { type: 'string' },
    'engine-root': { type: 'string' },
    approve: { type: 'boolean', default: false },
  },
});

const command = positionals[0] ?? 'help';
const workspaceRoot = resolve(values.workspace ?? process.cwd());
const kernelResolution = resolveForgeKernelBinary();
const kernelProbe = command === 'doctor' ? await probeForgeKernelBinary(kernelResolution) : undefined;
const requireKernel = (): string => requireForgeKernelBinary(kernelResolution);
const productServiceOptions = (): ForgeWorkspaceServiceOptions => ({
  runtime: { kind: 'rust_kernel', kernel: { binaryPath: requireKernel() } },
});
let service: ForgeWorkspaceService | undefined;

const workspaceService = (): ForgeWorkspaceService => {
  service ??= new ForgeWorkspaceService(workspaceRoot, productServiceOptions());
  return service;
};

const engineRoot = (): string => resolve(
  values['engine-root']
    ?? process.env.FORGE_ENGINE_ROOT
    ?? join(homedir(), '.forge'),
);

const candidateLifecycle = (): RustCandidateLifecycleRuntime => {
  const configuredParent = values['candidate-parent'] ?? process.env.FORGE_CANDIDATE_PARENT;
  if (configuredParent === undefined || configuredParent.trim().length === 0) {
    throw new Error('Legacy candidate lifecycle commands require --candidate-parent <path> or FORGE_CANDIDATE_PARENT.');
  }
  return new RustCandidateLifecycleRuntime({
    kernelPath: requireKernel(),
    repositoryRoot: workspaceRoot,
    candidateParent: resolve(configuredParent),
  });
};

const sovereignChangeRuntime = (
  verificationChecks: readonly TrustedVerificationCheckConfiguration[] = [],
): RustSovereignChangeRuntime => new RustSovereignChangeRuntime({
  kernelPath: requireKernel(),
  repositoryRoot: workspaceRoot,
  engineRoot: engineRoot(),
  verificationChecks,
});

const integerOption = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
};

const readJson = async (path: string, label: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Cannot read ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const loadProposal = async (path: string): Promise<SovereignChangeProposal> => {
  const candidate = asRecord(await readJson(path, 'proposal'));
  if (candidate?.schemaVersion !== 1 || !Array.isArray(candidate.operations)) {
    throw new Error('Proposal JSON requires schemaVersion 1 and an operations array.');
  }
  return candidate as unknown as SovereignChangeProposal;
};

const loadVerificationPolicy = async (
  path: string,
): Promise<readonly TrustedVerificationCheckConfiguration[]> => {
  const candidate = asRecord(await readJson(path, 'verification policy'));
  if (candidate?.schemaVersion !== 1 || !Array.isArray(candidate.checks) || candidate.checks.length === 0) {
    throw new Error('Verification policy JSON requires schemaVersion 1 and a non-empty checks array.');
  }
  return candidate.checks as unknown as readonly TrustedVerificationCheckConfiguration[];
};

const selectedChecks = (
  checks: readonly TrustedVerificationCheckConfiguration[],
): readonly string[] => {
  const explicit = values.check?.split(',').map((value) => value.trim()).filter(Boolean);
  return explicit === undefined || explicit.length === 0
    ? checks.map((check) => check.checkId)
    : explicit;
};

const mutationApproval = (
  capabilityId: string,
  input: unknown,
): { readonly call: CapabilityCall; readonly approvalFacts: ApprovalFacts } => {
  const callId = `forge-cli:${randomUUID()}`;
  return {
    call: { id: callId, capabilityId, input },
    approvalFacts: {
      schemaVersion: 1,
      callId,
      capabilityId,
      hostPolicy: {
        posture: 'ask',
        source: 'forge.cli.explicit-operation',
        reason: 'The local CLI requires explicit consent for sovereign change execution.',
      },
      userConsent: {
        status: 'granted',
        source: 'forge.cli.--approve',
        reason: 'The developer supplied --approve for this exact change operation.',
      },
    },
  };
};

const requireConsent = (operation: string): void => {
  if (!values.approve) {
    throw new Error(`${operation} requires --approve after reviewing the proposal or transaction.`);
  }
};

const printJsonArtifact = (artifact: unknown): void => {
  console.log(JSON.stringify(artifact, null, 2));
};

const printChangeArtifact = (artifact: unknown): void => {
  if (values.json) {
    printJsonArtifact(artifact);
    return;
  }
  const value = asRecord(artifact);
  const transaction = asRecord(value?.transaction) ?? value;
  console.log(`Forge change: ${String(value?.status ?? transaction?.state ?? 'unknown')}`);
  if (typeof transaction?.transactionId === 'string') console.log(`Transaction: ${transaction.transactionId}`);
  if (typeof transaction?.changeSetId === 'string') console.log(`ChangeSet: ${transaction.changeSetId}`);
  if (typeof transaction?.candidateRetained === 'boolean') console.log(`Candidate retained: ${transaction.candidateRetained}`);
  if (Array.isArray(transaction?.verification)) console.log(`Verification checks: ${transaction.verification.length}`);
  if (typeof value?.failure === 'string') console.log(`Failure: ${value.failure}`);
  if (typeof transaction?.failure === 'string') console.log(`Failure: ${transaction.failure}`);
};

const printArtifact = (artifact: RunArtifact): void => {
  const payload = artifactPayload(artifact);
  if (values.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`Forge run ${artifact.runId}`);
  console.log(`Status: ${artifact.status}`);
  console.log(`Capability success: ${artifact.capabilityResults.at(-1)?.success ?? false}`);
  console.log(`Workspace: ${artifact.snapshot.rootLabel} (${artifact.snapshot.files.length} files)`);
  console.log(JSON.stringify(payload.evidence, null, 2));
};

const legacyCandidateApproval = (callId: string, capabilityId: string): ApprovalFacts => ({
  schemaVersion: 1,
  callId,
  capabilityId,
  hostPolicy: {
    posture: 'ask',
    source: 'forge.cli.explicit-operation',
    reason: 'The local CLI requires explicit consent for candidate mutation.',
  },
  userConsent: {
    status: 'granted',
    source: 'forge.cli.--approve',
    reason: 'The developer supplied --approve for this exact lifecycle call.',
  },
});

const candidateCall = (
  capabilityId: string,
  operationIdName: 'promotionId' | 'discardId',
  operationId: string,
  subject: CandidateLifecycleSubject,
) => {
  const callId = `candidate-cli:${randomUUID()}`;
  return {
    call: {
      id: callId,
      capabilityId,
      input: { [operationIdName]: operationId, subject },
    },
    approvalFacts: legacyCandidateApproval(callId, capabilityId),
  };
};

try {
  if (command === 'doctor') {
    const report = {
      ok: kernelProbe?.ready === true,
      node: process.version,
      platform: process.platform,
      runtime: kernelProbe?.ready === true ? 'rust-kernel-typescript-adapter' : 'unavailable',
      kernel: {
        ready: kernelProbe?.ready === true,
        path: kernelResolution.path ?? null,
        source: kernelResolution.source ?? null,
        searchedPaths: kernelResolution.searchedPaths,
        version: kernelProbe?.kernelVersion ?? null,
        protocols: {
          run: kernelProbe?.runProtocolVersion ?? null,
          transaction: kernelProbe?.transactionProtocolVersion ?? null,
          candidate: kernelProbe?.candidateProtocolVersion ?? null,
          sovereignChange: kernelProbe?.sovereignChangeProtocolVersion ?? null,
        },
        message: kernelProbe?.message ?? kernelResolution.message,
      },
      mcp: 'stdio',
      workspaceRoot,
      engineRoot: engineRoot(),
      readOnlyFeatures: ['summary', 'search', 'read', 'symbols', 'typescript-diagnostics', 'git-status', 'git-diff'],
      changeFlow: kernelProbe?.ready === true ? 'forge.kernel.changeset.v2' : 'unavailable',
      isolation: 'trusted verification; process lifecycle owned; no Forge-enforced OS sandbox',
    };
    if (!report.ok) process.exitCode = 1;
    console.log(values.json
      ? JSON.stringify(report)
      : `ForgeEngine doctor: ${report.ok ? 'OK' : 'NOT READY'}\nNode: ${report.node}\nRuntime: ${report.runtime}\nKernel: ${report.kernel.path ?? report.kernel.message}\nMCP: ${report.mcp}\nChange flow: ${report.changeFlow}\nIsolation: ${report.isolation}\nFeatures: ${report.readOnlyFeatures.join(', ')}`);
  } else if (command === 'inspect') {
    printArtifact(await workspaceService().inspect(integerOption(values['max-files'], 200, '--max-files')));
  } else if (command === 'search') {
    const query = positionals.slice(1).join(' ').trim();
    if (query.length === 0) throw new Error('Usage: forge search <literal query> [--workspace <path>] [--json]');
    printArtifact(await workspaceService().search(query, {
      maxMatches: integerOption(values['max-matches'], 50, '--max-matches'),
      caseSensitive: values['case-sensitive'],
    }));
  } else if (command === 'read') {
    const path = positionals.slice(1).join(' ').trim();
    if (path.length === 0) throw new Error('Usage: forge read <workspace-relative path> [--start-line <line>] [--max-lines <count>]');
    printArtifact(await workspaceService().read(path, {
      startLine: integerOption(values['start-line'], 1, '--start-line'),
      maxLines: integerOption(values['max-lines'], 200, '--max-lines'),
    }));
  } else if (command === 'symbols') {
    const query = positionals.slice(1).join(' ').trim();
    printArtifact(await workspaceService().symbols({
      ...(query.length === 0 ? {} : { query }),
      maxFiles: integerOption(values['max-files'], 200, '--max-files'),
      maxSymbols: integerOption(values['max-symbols'], 500, '--max-symbols'),
    }));
  } else if (command === 'diagnostics') {
    printArtifact(await workspaceService().diagnostics({
      ...(values.config === undefined ? {} : { configPath: values.config }),
      maxDiagnostics: integerOption(values['max-diagnostics'], 200, '--max-diagnostics'),
    }));
  } else if (command === 'git-status') {
    printArtifact(await workspaceService().gitStatus());
  } else if (command === 'git-diff') {
    printArtifact(await workspaceService().gitDiff({
      staged: values.staged,
      maxBytes: integerOption(values['max-bytes'], 100_000, '--max-bytes'),
    }));
  } else if (command === 'change') {
    const action = positionals[1];
    if (action === 'propose') {
      requireConsent('forge change propose');
      const proposalPath = positionals[2];
      if (proposalPath === undefined || values.policy === undefined) {
        throw new Error('Usage: forge change propose <proposal.json> --policy <verification-policy.json> --approve [--check <id,id>]');
      }
      const proposal = await loadProposal(proposalPath);
      const checks = await loadVerificationPolicy(values.policy);
      const checkIds = selectedChecks(checks);
      const input = { proposalSchemaVersion: proposal.schemaVersion, selectedCheckIds: checkIds };
      const exact = mutationApproval('workspace.change.propose', input);
      printChangeArtifact(await sovereignChangeRuntime(checks).propose(
        proposal,
        checkIds,
        exact.call,
        exact.approvalFacts,
      ));
    } else {
      const transactionId = positionals[2]?.trim();
      if (transactionId === undefined || transactionId.length === 0) {
        throw new Error('Usage: forge change <inspect|accept|discard> <transaction-id> [--approve]');
      }
      const runtime = sovereignChangeRuntime();
      if (action === 'inspect') {
        printChangeArtifact(await runtime.inspect(transactionId));
      } else if (action === 'accept' || action === 'discard') {
        requireConsent(`forge change ${action}`);
        const capabilityId = `workspace.change.${action}`;
        const exact = mutationApproval(capabilityId, { transactionId });
        printChangeArtifact(action === 'accept'
          ? await runtime.accept(transactionId, exact.call, exact.approvalFacts)
          : await runtime.discard(transactionId, exact.call, exact.approvalFacts));
      } else {
        throw new Error('Usage: forge change <propose|inspect|accept|discard> ...');
      }
    }
  } else if (command === 'candidate') {
    const action = positionals[1];
    const candidateId = positionals[2]?.trim();
    if (candidateId === undefined || candidateId.length === 0) {
      throw new Error('Legacy usage: forge candidate <inspect|accept|discard> <candidate-id> --candidate-parent <path> [--approve]');
    }
    const lifecycle = candidateLifecycle();
    if (action === 'inspect') {
      printJsonArtifact(await lifecycle.inspect(candidateId));
    } else if (action === 'accept' || action === 'discard') {
      requireConsent(`legacy forge candidate ${action}`);
      const subject = (await lifecycle.inspect(candidateId)).subject;
      const operationId = `${action}:cli:${randomUUID()}`;
      const capabilityId = action === 'accept' ? 'workspace.candidate.promote' : 'workspace.candidate.discard';
      const exact = candidateCall(
        capabilityId,
        action === 'accept' ? 'promotionId' : 'discardId',
        operationId,
        subject,
      );
      printJsonArtifact(action === 'accept'
        ? await lifecycle.promote({ promotionId: operationId, subject, ...exact })
        : await lifecycle.discard({ discardId: operationId, subject, ...exact }));
    } else {
      throw new Error('Legacy usage: forge candidate <inspect|accept|discard> ...');
    }
  } else if (command === 'run') {
    const task = positionals.slice(1).join(' ').trim();
    if (task.length === 0) throw new Error('Usage: forge run <task> [--workspace <path>] [--json]');
    printArtifact(await workspaceService().run(task, integerOption(values['max-files'], 200, '--max-files')));
  } else if (command === 'mcp') {
    await startForgeMcpServer(workspaceRoot, productServiceOptions());
  } else {
    console.log([
      'ForgeEngine V1 — sovereign evidence runtime',
      '',
      'Core change flow:',
      '  forge change propose <proposal.json> --policy <policy.json> --approve [--check <id,id>] [--json]',
      '  forge change inspect <transaction-id> [--json]',
      '  forge change accept <transaction-id> --approve [--json]',
      '  forge change discard <transaction-id> --approve [--json]',
      '',
      'Evidence commands:',
      '  forge doctor [--json] [--workspace <path>]',
      '  forge inspect [--json] [--max-files <count>]',
      '  forge search <literal query> [--json] [--max-matches <count>]',
      '  forge read <path> [--json] [--start-line <line>] [--max-lines <count>]',
      '  forge symbols [name query] [--json] [--max-symbols <count>]',
      '  forge diagnostics [--config <tsconfig>] [--json] [--max-diagnostics <count>]',
      '  forge git-status [--json]',
      '  forge git-diff [--staged] [--json] [--max-bytes <count>]',
      '  forge run <task> [--json]',
      '  forge mcp [--workspace <path>]',
      '',
      'Product commands require the Rust kernel. Source builds discover target/release or target/debug; FORGE_KERNEL_BINARY overrides discovery. State defaults to ~/.forge and can be overridden with --engine-root or FORGE_ENGINE_ROOT.',
      'Verification is currently trusted local execution; Forge owns process cleanup but does not yet enforce an OS sandbox.',
    ].join('\n'));
  }
} finally {
  service?.close();
}