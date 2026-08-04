#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ApprovalFacts, CapabilityCall, RunArtifact } from './slice0/contracts.js';
import { developerEvidenceTools } from './inference/developer-tools.js';
import { ProviderTaskPlanner } from './inference/planner.js';
import { createInferenceProvider, resolveInferenceRoute } from './inference/routing.js';
import {
  createNodeInteractiveIo,
  resolveInteractiveRoute,
  runInteractiveSession,
} from './interactive-cli.js';
import type { InferenceRoute } from './inference/contracts.js';
import { createRunCancellation, LiveCliPresenter } from './live-cli.js';
import { startForgeMcpServer } from './mcp/server.js';
import {
  probeForgeKernelBinary,
  requireForgeKernelBinary,
  resolveForgeKernelBinary,
} from './hybrid/kernel-binary.js';

import type { TrustedVerificationCheckConfiguration } from './hybrid/verification-configuration.js';
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
    'max-turns': { type: 'string' },
    'timeout-ms': { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    'engine-root': { type: 'string' },
    approve: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const command = values.help ? 'help' : positionals[0] ?? 'interactive';
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

const executeProviderTask = async (
  task: string,
  route: InferenceRoute,
  maxTurns: number,
  timeoutMs: number,
  presenter?: LiveCliPresenter,
): Promise<{
  readonly artifact: RunArtifact;
  readonly cancellationSource: ReturnType<typeof createRunCancellation>['source'];
}> => {
  if (timeoutMs < 1 || timeoutMs > 900_000) {
    throw new Error('--timeout-ms must be from 1 to 900000.');
  }
  const cancellation = createRunCancellation(timeoutMs);
  try {
    const planner = new ProviderTaskPlanner({
      provider: createInferenceProvider(route),
      route,
      tools: developerEvidenceTools,
      ...(presenter === undefined
        ? {}
        : { onInferenceEvent: (observation) => presenter.onInferenceEvent(observation) }),
    });
    const artifact = await workspaceService().executeTask(
      task,
      planner,
      {
        maxTurns,
        ...(presenter === undefined ? {} : { onEvent: (event) => presenter.onRunEvent(event) }),
      },
      cancellation.signal,
    );
    return { artifact, cancellationSource: cancellation.source };
  } finally {
    cancellation.dispose();
  }
};

const engineRoot = (): string => resolve(
  values['engine-root']
    ?? process.env.FORGE_ENGINE_ROOT
    ?? join(homedir(), '.forge'),
);


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
  for (const evidence of artifact.inferenceEvidence ?? []) {
    console.log(`Inference: ${evidence.provider}/${evidence.model} ${evidence.finishReason} ${evidence.durationMs}ms; fallback=${evidence.routing.fallbackUsed}`);
  }
  if (artifact.output !== undefined) console.log(artifact.output);
  else console.log(JSON.stringify(payload.evidence, null, 2));
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

  } else if (command === 'interactive') {
    if (values.json) throw new Error('Interactive Forge does not support --json; use forge run for machine output.');
    requireKernel();
    const selection = await resolveInteractiveRoute({
      ...(values.provider === undefined ? {} : { provider: values.provider }),
      ...(values.model === undefined ? {} : { model: values.model }),
    });
    createInferenceProvider(selection.route);
    const maxTurns = integerOption(values['max-turns'], 8, '--max-turns');
    const timeoutMs = integerOption(values['timeout-ms'], 120_000, '--timeout-ms');
    await runInteractiveSession({
      workspaceRoot,
      initialRoute: selection,
      io: createNodeInteractiveIo(),
      validateRoute: (route) => { createInferenceProvider(route); },
      runTask: async (task, route) => {
        const presenter = new LiveCliPresenter();
        const { artifact } = await executeProviderTask(task, route, maxTurns, timeoutMs, presenter);
        presenter.printSummary(artifact);
        return { runId: artifact.runId, status: artifact.status, outcome: artifact.outcome.status };
      },
    });
  } else if (command === 'run') {
    const task = positionals.slice(1).join(' ').trim();
    if (task.length === 0) throw new Error('Usage: forge run <task> --provider <ollama|openai> --model <model> [--workspace <path>] [--json]');
    const route = resolveInferenceRoute(values.provider, values.model);
    const presenter = values.json ? undefined : new LiveCliPresenter();
    const { artifact, cancellationSource } = await executeProviderTask(
      task,
      route,
      integerOption(values['max-turns'], 8, '--max-turns'),
      integerOption(values['timeout-ms'], 120_000, '--timeout-ms'),
      presenter,
    );
    if (presenter === undefined) printArtifact(artifact);
    else presenter.printSummary(artifact);
    if (artifact.status !== 'completed' || artifact.outcome.status === 'unmet') {
      process.exitCode = artifact.status === 'cancelled'
        ? cancellationSource === 'sigint'
          ? 130
          : cancellationSource === 'timeout'
            ? 124
            : 1
        : 1;
    }
  } else if (command === 'mcp') {
    await startForgeMcpServer(workspaceRoot, productServiceOptions());
  } else if (command === 'help') {
    console.log([
      'ForgeEngine V1 — sovereign evidence runtime',
      '',
      'Interactive:',
      '  forge [--provider <ollama|openai> --model <model>] [--workspace <path>]',
      '    With no route flags, Forge auto-discovers an installed local Ollama model.',
      '    Slash controls: /help, /status, /model, /clear, /exit.',
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
      '  forge run <task> --provider <ollama|openai> --model <model> [--max-turns <count>] [--timeout-ms <ms>] [--json]',
      '    Human mode streams validated assistant text and canonical run status; --json emits one terminal artifact.',
      '  forge mcp [--workspace <path>]',
      '',
      'Product commands require the Rust kernel. Source builds discover target/release or target/debug; FORGE_KERNEL_BINARY overrides discovery. Interactive route defaults can use FORGE_DEFAULT_PROVIDER and FORGE_DEFAULT_MODEL. State defaults to ~/.forge and can be overridden with --engine-root or FORGE_ENGINE_ROOT.',
      'Verification is currently trusted local execution; Forge owns process cleanup but does not yet enforce an OS sandbox.',
    ].join('\n'));
  } else {
    throw new Error(`Unknown Forge command: ${command}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[forge] ' + message);
  if (process.env.FORGE_DEBUG === '1' && error instanceof Error && error.stack !== undefined) {
    console.error(error.stack);
  }
  process.exitCode = 1;
} finally {
  service?.close();
}