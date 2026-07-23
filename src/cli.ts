#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { RunArtifact } from './slice0/contracts.js';
import { startForgeMcpServer } from './mcp/server.js';
import {
  RustCandidateLifecycleRuntime,
  type CandidateLifecycleSubject,
} from './hybrid/rust-candidate-lifecycle-runtime.js';import { artifactPayload, ForgeWorkspaceService, type ForgeWorkspaceServiceOptions } from './v1/service.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    workspace: { type: 'string' },
    config: { type: 'string' },
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
    approve: { type: 'boolean', default: false },
  },
});

const command = positionals[0] ?? 'help';
const workspaceRoot = resolve(values.workspace ?? process.cwd());
const configuredKernel = process.env.FORGE_KERNEL_BINARY?.trim();
const serviceOptions: ForgeWorkspaceServiceOptions = configuredKernel === undefined || configuredKernel.length === 0
  ? {}
  : { kernel: { binaryPath: configuredKernel } };
let service: ForgeWorkspaceService | undefined;
const workspaceService = (): ForgeWorkspaceService => {
  service ??= new ForgeWorkspaceService(workspaceRoot, serviceOptions);
  return service;
};

const candidateLifecycle = (): RustCandidateLifecycleRuntime => {
  if (configuredKernel === undefined || configuredKernel.length === 0) {
    throw new Error('Candidate lifecycle commands require FORGE_KERNEL_BINARY.');
  }
  const configuredParent = values['candidate-parent'] ?? process.env.FORGE_CANDIDATE_PARENT;
  if (configuredParent === undefined || configuredParent.trim().length === 0) {
    throw new Error('Candidate lifecycle commands require --candidate-parent <path> or FORGE_CANDIDATE_PARENT.');
  }
  return new RustCandidateLifecycleRuntime({
    kernelPath: configuredKernel,
    repositoryRoot: workspaceRoot,
    candidateParent: resolve(configuredParent),
  });
};

const printCandidateArtifact = (artifact: unknown): void => {
  console.log(JSON.stringify(artifact, null, values.json ? 2 : 2));
};

const lifecycleApproval = (callId: string, capabilityId: string) => ({
  schemaVersion: 1 as const,
  callId,
  capabilityId,
  hostPolicy: {
    posture: 'ask' as const,
    source: 'forge.cli.explicit-operation',
    reason: 'The local CLI requires explicit consent for candidate mutation.',
  },
  userConsent: {
    status: 'granted' as const,
    source: 'forge.cli.--approve',
    reason: 'The developer supplied --approve for this exact lifecycle call.',
  },
});

const requireCandidateConsent = (): void => {
  if (!values.approve) {
    throw new Error('Candidate accept/discard requires --approve after inspecting the candidate.');
  }
};

const candidateCall = (
  capabilityId: string,
  operationIdName: 'promotionId' | 'discardId',
  operationId: string,
  subject: CandidateLifecycleSubject,
) => {
  const callId = `candidate-cli:${randomUUID()}`;
  return {
    callId,
    call: {
      id: callId,
      capabilityId,
      input: { [operationIdName]: operationId, subject },
    },
    approvalFacts: lifecycleApproval(callId, capabilityId),
  };
};
const integerOption = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
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

try {
  if (command === 'doctor') {
    const report = {
      ok: true,
      node: process.version,
      platform: process.platform,
      runtime: configuredKernel === undefined || configuredKernel.length === 0 ? 'typescript-control' : 'rust-kernel-typescript-adapter',
      mcp: 'stdio',
      workspaceRoot,
      readOnlyFeatures: ['summary', 'search', 'read', 'symbols', 'typescript-diagnostics', 'git-status', 'git-diff'],
    };
    console.log(values.json ? JSON.stringify(report) : `ForgeEngine doctor: OK\nNode: ${report.node}\nRuntime: ${report.runtime}\nMCP: ${report.mcp}\nFeatures: ${report.readOnlyFeatures.join(', ')}`);
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
  } else if (command === 'candidate') {
    const action = positionals[1];
    const candidateId = positionals[2]?.trim();
    if (candidateId === undefined || candidateId.length === 0) {
      throw new Error('Usage: forge candidate <inspect|accept|discard> <candidate-id> --candidate-parent <path> [--approve]');
    }
    const lifecycle = candidateLifecycle();
    if (action === 'inspect') {
      printCandidateArtifact(await lifecycle.inspect(candidateId));
    } else if (action === 'accept') {
      requireCandidateConsent();
      const subject = (await lifecycle.inspect(candidateId)).subject;
      const promotionId = `promotion:cli:${randomUUID()}`;
      const exact = candidateCall(
        'workspace.candidate.promote',
        'promotionId',
        promotionId,
        subject,
      );
      printCandidateArtifact(await lifecycle.promote({
        promotionId,
        subject,
        call: exact.call,
        approvalFacts: exact.approvalFacts,
      }));
    } else if (action === 'discard') {
      requireCandidateConsent();
      const subject = (await lifecycle.inspect(candidateId)).subject;
      const discardId = `discard:cli:${randomUUID()}`;
      const exact = candidateCall(
        'workspace.candidate.discard',
        'discardId',
        discardId,
        subject,
      );
      printCandidateArtifact(await lifecycle.discard({
        discardId,
        subject,
        call: exact.call,
        approvalFacts: exact.approvalFacts,
      }));
    } else {
      throw new Error('Usage: forge candidate <inspect|accept|discard> <candidate-id> --candidate-parent <path> [--approve]');
    }  } else if (command === 'run') {
    const task = positionals.slice(1).join(' ').trim();
    if (task.length === 0) throw new Error('Usage: forge run <task> [--workspace <path>] [--json]');
    printArtifact(await workspaceService().run(task, integerOption(values['max-files'], 200, '--max-files')));
  } else if (command === 'mcp') {
    await startForgeMcpServer(workspaceRoot);
  } else {
    console.log([
      'ForgeEngine V1 — Slice 1 read-only evidence runtime',
      '',
      'Commands:',
      '  forge doctor [--json] [--workspace <path>]',
      '  forge inspect [--json] [--max-files <count>]',
      '  forge search <literal query> [--json] [--max-matches <count>]',
      '  forge read <path> [--json] [--start-line <line>] [--max-lines <count>]',
      '  forge symbols [name query] [--json] [--max-symbols <count>]',
      '  forge diagnostics [--config <tsconfig>] [--json] [--max-diagnostics <count>]',
      '  forge git-status [--json]',
      '  forge git-diff [--staged] [--json] [--max-bytes <count>]',
      '  forge run <task> [--json]                    # deterministic read-only inventory plan',
      '  forge candidate inspect <id> --candidate-parent <path> [--json]',
      '  forge candidate accept <id> --candidate-parent <path> --approve [--json]',
      '  forge candidate discard <id> --candidate-parent <path> --approve [--json]',
      '  forge mcp [--workspace <path>]               # stdio; invoked by an MCP host',
      '',
      'All workspace commands also accept --workspace <path>.',
    ].join('\n'));
  }
} finally {
  service?.close();
}
