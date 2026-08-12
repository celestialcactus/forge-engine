#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import type { ApprovalFacts, CapabilityCall, ExecutionBudget, RunArtifact } from './slice0/contracts.js';
import { developerEvidenceTools, developerGovernedChangeTools } from './inference/developer-tools.js';
import { ProviderTaskPlanner } from './inference/planner.js';
import { createInferenceProvider, resolveInferenceRoute } from './inference/routing.js';
import {
  createNodeInteractiveIo,
  resolveInteractiveRoute,
  runInteractiveSession,
  type InteractiveSessionIo,
} from './interactive-cli.js';
import type { InferenceRoute } from './inference/contracts.js';
import { createRunCancellation, LiveCliPresenter } from './live-cli.js';
import type { GovernedChangeCapabilityOptions } from './governed-change.js';
import { startForgeMcpServer } from './mcp/server.js';
import {
  probeForgeKernelBinary,
  requireForgeKernelBinary,
  resolveForgeKernelBinary,
} from './hybrid/kernel-binary.js';
import { RustRunStoreRuntime } from './hybrid/rust-run-store-runtime.js';

import type { TrustedVerificationCheckConfiguration } from './hybrid/verification-configuration.js';
import {
  RustSovereignChangeRuntime,
  type SovereignChangeProposal,
} from './hybrid/rust-sovereign-change-runtime.js';
import { artifactPayload, defaultExecutionBudget, ForgeWorkspaceService, type ForgeWorkspaceServiceOptions } from './v1/service.js';
import { parseTrustedVerificationPolicy, selectVerificationCheckIds } from './verification-policy.js';
import {
  parseProductApprovalProfile,
  type ProductApprovalConfiguration,
} from './approval-profile.js';

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
    'max-capability-calls': { type: 'string' },
    'max-input-tokens': { type: 'string' },
    'max-output-tokens': { type: 'string' },
    'timeout-ms': { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    'engine-root': { type: 'string' },
    'approval-profile': { type: 'string' },
    approve: { type: 'boolean', default: false },
    'retry-evidence': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const command = values.help ? 'help' : positionals[0] ?? 'interactive';
const workspaceRoot = resolve(values.workspace ?? process.cwd());
const approvalProfileRaw = values['approval-profile'] ?? process.env.FORGE_APPROVAL_PROFILE;
const approvalProfile = parseProductApprovalProfile(approvalProfileRaw);
const approvalProfileSource = values['approval-profile'] !== undefined
  ? 'command-line'
  : process.env.FORGE_APPROVAL_PROFILE !== undefined
    ? 'environment'
    : 'default';
const kernelResolution = resolveForgeKernelBinary();
const kernelProbe = command === 'doctor' ? await probeForgeKernelBinary(kernelResolution) : undefined;
const requireKernel = (): string => requireForgeKernelBinary(kernelResolution);
let approvalIo: InteractiveSessionIo | undefined;
const interactiveIo = (): InteractiveSessionIo => {
  approvalIo ??= createNodeInteractiveIo();
  return approvalIo;
};
const approvedChoice = (value: string | undefined): boolean =>
  ['y', 'yes', 'approve'].includes(value?.trim().toLowerCase() ?? '');
const approvalConfiguration = (interactiveConsent = true): ProductApprovalConfiguration => {
  if (approvalProfile !== 'review') return { profile: approvalProfile };
  if (!interactiveConsent) return { profile: 'review' };
  return {
    profile: 'review',
    async requestConsent(request, signal) {
      const answer = await interactiveIo().question(
        `[forge] review ${request.call.capabilityId} (${request.call.id}, snapshot=${request.context.basis.snapshotId}) [y/N] `,
        signal,
      );
      const granted = approvedChoice(answer);
      return {
        status: granted ? 'granted' : 'declined',
        source: 'forge.cli.approval-prompt',
        reason: granted
          ? 'Developer granted this exact model-requested capability call.'
          : 'Developer declined this exact model-requested capability call.',
      };
    },
  };
};
const productServiceOptions = (interactiveConsent = true): ForgeWorkspaceServiceOptions => ({
  runtime: {
    kind: 'rust_kernel',
    kernel: {
      binaryPath: requireKernel(),
      runStoreRoot: join(engineRoot(), 'runs', 'v1'),
    },
  },
  approval: approvalConfiguration(interactiveConsent),
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
  executionBudget: ExecutionBudget,
  timeoutMs: number,
  presenter?: LiveCliPresenter,
  governedChange?: GovernedChangeCapabilityOptions,
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
      tools: governedChange === undefined ? developerEvidenceTools : developerGovernedChangeTools,
      ...(presenter === undefined || governedChange !== undefined
        ? {}
        : { onInferenceEvent: (observation) => presenter.onInferenceEvent(observation) }),
    });
    const taskOptions = {
      maxTurns,
      executionBudget,
      ...(presenter === undefined
        ? {}
        : { onEvent: (event: RunArtifact['events'][number]) => presenter.onRunEvent(event) }),
    };
    const artifact = governedChange === undefined
      ? await workspaceService().executeTask(
        task,
        planner,
        taskOptions,
        cancellation.signal,
      )
      : await workspaceService().executeGovernedChangeTask(
        task,
        planner,
        governedChange,
        taskOptions,
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

const pathIsWithin = (parent: string, candidate: string): boolean => {
  const fromParent = relative(parent, candidate);
  return fromParent === ''
    || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent));
};

const changeStateSeparation = (repositoryRoot: string, stateRoot: string): {
  readonly valid: boolean;
  readonly message: string;
} => {
  const valid = !pathIsWithin(repositoryRoot, stateRoot) && !pathIsWithin(stateRoot, repositoryRoot);
  return {
    valid,
    message: valid
      ? 'Forge state is lexically disjoint from the governed workspace; Rust revalidates canonical paths.'
      : 'Forge engine root must be outside and must not contain the governed workspace.',
  };
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

const executionBudgetOption = (): ExecutionBudget => ({
  schemaVersion: 1,
  maxCapabilityCalls: integerOption(
    values['max-capability-calls'],
    defaultExecutionBudget.maxCapabilityCalls,
    '--max-capability-calls',
  ),
  maxReportedInputTokens: integerOption(
    values['max-input-tokens'],
    defaultExecutionBudget.maxReportedInputTokens,
    '--max-input-tokens',
  ),
  maxReportedOutputTokens: integerOption(
    values['max-output-tokens'],
    defaultExecutionBudget.maxReportedOutputTokens,
    '--max-output-tokens',
  ),
});

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
  return parseTrustedVerificationPolicy(await readJson(path, 'verification policy'));
};

const selectedChecks = (
  checks: readonly TrustedVerificationCheckConfiguration[],
): readonly string[] => {
  return selectVerificationCheckIds(checks, values.check);
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
  if (Array.isArray(value?.transactions)) {
    const transactions = value.transactions.map(asRecord).filter((entry) => entry !== undefined);
    console.log(`Forge transaction audit: ${transactions.length}${value.truncated === true ? '+' : ''}`);
    console.log(`Unpublished staging removed: ${String(value.orphanStagingRemoved ?? 0)}`);
    if (transactions.length === 0) console.log('No durable ChangeSet transactions found.');
    for (const transaction of transactions) {
      const review = transaction.reviewDue === true ? '; review due' : '';
      console.log(
        `${String(transaction.state ?? 'unknown')} ${String(transaction.transactionId ?? 'unknown')}`
        + `; candidate retained=${String(transaction.candidateRetained ?? false)}`
        + `; recommendation=${String(transaction.recommendation ?? 'unknown')}${review}`,
      );
    }
    return;
  }
  const transaction = asRecord(value?.transaction) ?? value;
  console.log(`Forge change: ${String(value?.status ?? transaction?.state ?? 'unknown')}`);
  if (typeof transaction?.transactionId === 'string') console.log(`Transaction: ${transaction.transactionId}`);
  if (typeof transaction?.changeSetId === 'string') console.log(`ChangeSet: ${transaction.changeSetId}`);
  if (typeof transaction?.candidateRetained === 'boolean') console.log(`Candidate retained: ${transaction.candidateRetained}`);
  if (Array.isArray(transaction?.verification)) console.log(`Verification checks: ${transaction.verification.length}`);
  const outcome = asRecord(value?.outcome);
  if (typeof outcome?.status === 'string') console.log(`Outcome: ${outcome.status}`);
  if (typeof value?.failure === 'string') console.log(`Failure: ${value.failure}`);
  if (typeof transaction?.failure === 'string') console.log(`Failure: ${transaction.failure}`);
};

const printArtifact = (artifact: RunArtifact): void => {
  if (artifact.status !== 'completed' || artifact.outcome.status === 'unmet') process.exitCode = 1;
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
  if (values.json && approvalProfile === 'review' && command !== 'doctor' && command !== 'help') {
    throw new Error('--json cannot be combined with --approval-profile review because consent prompts require human-mode output.');
  }
  if (command === 'doctor') {
    const configuredEngineRoot = engineRoot();
    const stateSeparation = changeStateSeparation(workspaceRoot, configuredEngineRoot);
    const isolationCandidateSummary = (kernelProbe?.isolationCandidates ?? [])
      .map((candidate) => `${candidate.providerId}:${candidate.availability}:restricted-ready=${candidate.restrictedReady}`)
      .join(', ') || 'none';
    const report = {
      ok: kernelProbe?.ready === true && stateSeparation.valid,
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
          runStore: kernelProbe?.runStoreProtocolVersion ?? null,
          transaction: kernelProbe?.transactionProtocolVersion ?? null,
          candidate: kernelProbe?.candidateProtocolVersion ?? null,
          sovereignChange: kernelProbe?.sovereignChangeProtocolVersion ?? null,
        },
        message: kernelProbe?.message ?? kernelResolution.message,
      },
      mcp: 'stdio',
      workspaceRoot,
      engineRoot: configuredEngineRoot,
      configuration: {
        engineRootOutsideWorkspace: stateSeparation.valid,
        message: stateSeparation.message,
      },
      runStore: {
        root: join(configuredEngineRoot, 'runs', 'v1'),
        durability: 'append-before-notify; terminal-before-result',
        recovery: 'terminal-return; validated same-runtime continuation; unsafe frontiers blocked',
      },
      executionDefaults: defaultExecutionBudget,
      approval: {
        profile: approvalProfile,
        source: approvalProfileSource,
        decisionAuthority: 'rust-kernel',
        scope: 'registered capabilities; governed mutations retain exact-change approval',
      },
      readOnlyFeatures: ['summary', 'search', 'read', 'symbols', 'typescript-diagnostics', 'git-status', 'git-diff'],
      changeFlow: kernelProbe?.ready === true ? 'forge.kernel.changeset.v4' : 'unavailable',
      isolation: {
        providerId: kernelProbe?.isolationProvider?.providerId ?? null,
        providerClass: kernelProbe?.isolationProvider?.providerClass ?? null,
        availability: kernelProbe?.isolationProvider?.availability ?? 'unsupported',
        supportedProfiles: kernelProbe?.isolationProvider?.supportedProfiles ?? [],
        restrictedControls: kernelProbe?.isolationProvider?.restrictedControls ?? [],
        restrictedReady: kernelProbe?.isolationProvider?.restrictedReady ?? false,
        limitations: kernelProbe?.isolationProvider?.limitations ?? ['Kernel isolation status is unavailable.'],
        candidates: kernelProbe?.isolationCandidates ?? [],
        lifecycleOwnership: 'forge-owned',
        posture: kernelProbe?.isolationProvider?.restrictedReady === true
          ? 'Forge native restricted execution is available and all five controls are advertised.'
          : 'trusted verification; process lifecycle owned; no accepted Forge-enforced OS sandbox',
      },
    };
    if (!report.ok) process.exitCode = 1;
    console.log(values.json
      ? JSON.stringify(report)
      : `ForgeEngine doctor: ${report.ok ? 'OK' : 'NOT READY'}\nNode: ${report.node}\nRuntime: ${report.runtime}\nKernel: ${report.kernel.path ?? report.kernel.message}\nMCP: ${report.mcp}\nRun store: ${report.runStore.root} (${report.runStore.recovery})\nState separation: ${report.configuration.message}\nExecution defaults: calls=${report.executionDefaults.maxCapabilityCalls}, input=${report.executionDefaults.maxReportedInputTokens}, output=${report.executionDefaults.maxReportedOutputTokens}\nApproval profile: ${report.approval.profile} (${report.approval.source}); authority=${report.approval.decisionAuthority}\nChange flow: ${report.changeFlow}\nIsolation: ${report.isolation.posture}; provider=${report.isolation.providerId ?? 'unavailable'}; class=${report.isolation.providerClass ?? 'unknown'}; availability=${report.isolation.availability}; restricted-ready=${report.isolation.restrictedReady}\nIsolation candidates: ${isolationCandidateSummary}\nFeatures: ${report.readOnlyFeatures.join(', ')}`);
  } else if (command === 'runs') {
    const operation = positionals[1];
    const runId = positionals[2]?.trim() ?? '';
    if (!['inspect', 'resume'].includes(operation ?? '') || runId.length === 0) {
      throw new Error('Usage: forge runs <inspect|resume> <run-id> [--json] [--engine-root <path>]');
    }
    const store = new RustRunStoreRuntime({
      kernelPath: requireKernel(),
      runStoreRoot: join(engineRoot(), 'runs', 'v1'),
    });
    const inspection = await store.inspect(runId);
    if (operation === 'inspect') {
      if (values.json) {
        console.log(JSON.stringify(inspection, null, 2));
      } else {
        console.log(`Forge run ${inspection.runId}`);
        console.log(`State: ${inspection.state}`);
        console.log(`Recovery: ${inspection.resumeDisposition}`);
        console.log(`Durable events: ${inspection.eventCount}`);
        if (inspection.continuation !== undefined) {
          console.log(`Continuation: ${inspection.continuation.disposition}`);
        }
        console.log(`Reason: ${inspection.reason}`);
        if (inspection.artifact !== undefined) {
          console.log(`Terminal status: ${inspection.artifact.status}`);
        }
      }
      if (inspection.state === 'repair_required') process.exitCode = 1;
    } else if (inspection.artifact !== undefined) {
      if (values.json) printArtifact(inspection.artifact);
      else {
        const presenter = new LiveCliPresenter();
        if (inspection.artifact.output !== undefined) {
          presenter.printAssistantOutput(inspection.artifact.output);
        }
        presenter.printSummary(inspection.artifact);
      }
    } else {
      const route = resolveInferenceRoute(values.provider, values.model);
      const verificationPolicyPath = values.policy ?? process.env.FORGE_VERIFICATION_POLICY;
      if (values.check !== undefined && verificationPolicyPath === undefined) {
        throw new Error('--check requires --policy or FORGE_VERIFICATION_POLICY when resuming.');
      }
      const verificationChecks = verificationPolicyPath === undefined
        ? []
        : await loadVerificationPolicy(verificationPolicyPath);
      const checkIds = verificationChecks.length === 0 ? [] : selectedChecks(verificationChecks);
      const governedChanges = verificationChecks.length > 0;
      const presenter = values.json ? undefined : new LiveCliPresenter();
      const planner = new ProviderTaskPlanner({
        provider: createInferenceProvider(route),
        route,
        tools: governedChanges ? developerGovernedChangeTools : developerEvidenceTools,
        ...(presenter === undefined || governedChanges
          ? {}
          : { onInferenceEvent: (observation) => presenter.onInferenceEvent(observation) }),
      });
      const cancellation = createRunCancellation(
        integerOption(values['timeout-ms'], 120_000, '--timeout-ms'),
      );
      try {
        const artifact = await workspaceService().resumeTask(runId, planner, {
          allowRetryableCapabilityRetry: values['retry-evidence'],
          ...(presenter === undefined
            ? {}
            : { onEvent: (event: RunArtifact['events'][number]) => presenter.onRunEvent(event) }),
          ...(governedChanges
            ? {
                governedChange: {
                  checkIds,
                  runtime: sovereignChangeRuntime(verificationChecks),
                  io: interactiveIo(),
                },
              }
            : {}),
        }, cancellation.signal);
        if (presenter === undefined) printArtifact(artifact);
        else presenter.printSummary(artifact);
        if (artifact.status !== 'completed' || artifact.outcome.status === 'unmet') {
          process.exitCode = 1;
        }
      } finally {
        cancellation.dispose();
      }
    }  } else if (command === 'inspect') {
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
    if (action === 'audit') {
      printChangeArtifact(await sovereignChangeRuntime().audit());
    } else if (action === 'propose') {
      const proposalPath = positionals[2];
      if (proposalPath === undefined || values.policy === undefined) {
        throw new Error('Usage: forge change propose <proposal.json> --policy <verification-policy.json> --approve [--check <id,id>]');
      }
      const proposal = await loadProposal(proposalPath);
      const checks = await loadVerificationPolicy(values.policy);
      const checkIds = selectedChecks(checks);
      const runtime = sovereignChangeRuntime(checks);
      const prepared = await runtime.prepare(proposal);
      if (!values.approve) {
        throw new Error(
          `forge change propose prepared ${prepared.changeSetId}; rerun with --approve only after reviewing this exact proposal.`,
        );
      }
      const input = { changeSetId: prepared.changeSetId, selectedCheckIds: checkIds };
      const exact = mutationApproval('workspace.change.propose', input);
      printChangeArtifact(await runtime.propose(
        proposal,
        prepared.changeSetId,
        checkIds,
        exact.call,
        exact.approvalFacts,
      ));
    } else {
      const transactionId = positionals[2]?.trim();
      if (transactionId === undefined || transactionId.length === 0) {
        throw new Error('Usage: forge change <audit|inspect|accept|discard> [transaction-id] [--approve]');
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
        throw new Error('Usage: forge change <audit|propose|inspect|accept|discard> ...');
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
    const verificationPolicyPath = values.policy ?? process.env.FORGE_VERIFICATION_POLICY;
    if (values.check !== undefined && verificationPolicyPath === undefined) {
      throw new Error('--check requires --policy or FORGE_VERIFICATION_POLICY in interactive mode.');
    }
    const verificationChecks = verificationPolicyPath === undefined
      ? []
      : await loadVerificationPolicy(verificationPolicyPath);
    const checkIds = verificationChecks.length === 0 ? [] : selectedChecks(verificationChecks);
    const governedChanges = verificationChecks.length > 0;
    const io = interactiveIo();
    await runInteractiveSession({
      workspaceRoot,
      initialRoute: selection,
      approvalProfile,
      io,
      notices: [governedChanges
        ? `changes: governed inside the Rust run; verification=${checkIds.join(', ')}`
        : 'changes: disabled; start with --policy <file> or set FORGE_VERIFICATION_POLICY to enable verified edits'],
      validateRoute: (route) => { createInferenceProvider(route); },
      runTask: async (task, route) => {
        const presenter = new LiveCliPresenter();
        const { artifact } = await executeProviderTask(
          task,
          route,
          maxTurns,
          executionBudgetOption(),
          timeoutMs,
          presenter,
          governedChanges
            ? {
                checkIds,
                runtime: sovereignChangeRuntime(verificationChecks),
                io,
              }
            : undefined,
        );
        if (artifact.output !== undefined) presenter.printAssistantOutput(artifact.output);
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
      executionBudgetOption(),
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
    await startForgeMcpServer(workspaceRoot, productServiceOptions(false));
  } else if (command === 'help') {
    console.log([
      'ForgeEngine V1 — sovereign evidence runtime',
      '',
      'Interactive:',
      '  forge [--provider <ollama|openai> --model <model>] [--workspace <path>]',
      '    With no route flags, Forge auto-discovers an installed local Ollama model.',
      '    Add --policy <verification-policy.json> (or FORGE_VERIFICATION_POLICY) to enable reviewed, verified edits.',
      '    Select --approval-profile <developer|review|locked> (or FORGE_APPROVAL_PROFILE).',
      '    Slash controls: /help, /status, /permissions, /model, /clear, /exit.',
      '',
      'Core change flow:',
      '  forge change audit [--json]',
      '  forge change propose <proposal.json> --policy <policy.json> --approve [--check <id,id>] [--json]',
      '  forge change inspect <transaction-id> [--json]',
      '  forge change accept <transaction-id> --approve [--json]',
      '  forge change discard <transaction-id> --approve [--json]',
      '',
      'Evidence commands:',
      '  forge doctor [--json] [--workspace <path>]',
      '  forge runs inspect <run-id> [--json] [--engine-root <path>]',
      '  forge runs resume <run-id> --provider <ollama|openai> --model <model> [--retry-evidence] [--json]',
      '    Resume replays validated completions through the same Rust runtime; ambiguous provider, approval, and mutation work stays blocked.',
      '    --retry-evidence deliberately retries one unresolved capability explicitly classified read-only; it is accepted only once.',
      '  forge inspect [--json] [--max-files <count>]',
      '  forge search <literal query> [--json] [--max-matches <count>]',
      '  forge read <path> [--json] [--start-line <line>] [--max-lines <count>]',
      '  forge symbols [name query] [--json] [--max-symbols <count>]',
      '  forge diagnostics [--config <tsconfig>] [--json] [--max-diagnostics <count>]',
      '  forge git-status [--json]',
      '  forge git-diff [--staged] [--json] [--max-bytes <count>]',
      '  forge run <task> --provider <ollama|openai> --model <model> [--max-turns <count>] [--timeout-ms <ms>] [--json]',
      '    Optional controls: --approval-profile <developer|review|locked>, --max-capability-calls, --max-input-tokens, --max-output-tokens.',
      '    Token ceilings stop continuation after cumulative provider-reported usage crosses the limit.',
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
  approvalIo?.close();
}
