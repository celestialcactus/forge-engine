#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import type { ApprovalFacts, CapabilityCall, ExecutionBudget, RunArtifact } from './slice0/contracts.js';
import { developerEvidenceTools, developerGovernedChangeTools } from './inference/developer-tools.js';
import { ProviderTaskPlanner } from './inference/planner.js';
import { createInferenceProvider } from './inference/routing.js';
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
import { artifactPayload, ForgeWorkspaceService, type ForgeWorkspaceServiceOptions } from './v1/service.js';
import { parseTrustedVerificationPolicy, selectVerificationCheckIds } from './verification-policy.js';
import {
  type ProductApprovalConfiguration,
} from './approval-profile.js';
import { compileProductConfiguration, type CompiledProductConfiguration } from './config/compile.js';
import {
  configurationPathReport,
  ConfigurationCommandError,
  initializeProductConfiguration,
  productConfigurationPaths,
  renderEffectiveConfiguration,
  type ConfigurationFileScope,
} from './config/commands.js';
import { ConfigurationIssueError } from './config/schema.js';
import { ConfigurationResolutionError } from './config/resolve.js';
import { MemoryCommands, MemorySelectionError, repositoryMemoryScope } from './memory/commands.js';
import {
  MemoryAutoSaveController,
  type AutoSaveReceipt,
  type MemoryCaptureOutcome,
} from './memory/autosave.js';
import {
  memoryStatusReport,
  renderMemoryExplanation,
  renderMemoryList,
  renderMemoryOperation,
  memoryPrivacyBoundary,
  renderMemoryContextPreview,
  renderMemoryPrivacyOperation,
} from './memory/presentation.js';
import { MemoryRuntimeError, RustMemoryRuntime } from './memory/runtime.js';

const parseCliArguments = () => {
  try {
    return parseArgs({
      allowPositionals: true,
      tokens: true,
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
    replacement: { type: 'string' },
    'erase-previous': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
      } as const,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.argv.includes('--json')) {
      console.error(JSON.stringify({
        ok: false,
        error: { code: 'cli_arguments_invalid', message },
      }));
    } else {
      console.error(`[forge] ${message}`);
    }
    process.exit(1);
  }
};

const { positionals, tokens, values } = parseCliArguments();

const requireExactCommandOptions = (
  allowedNames: readonly string[],
  usage: string,
): void => {
  const allowed = new Set(allowedNames);
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (!allowed.has(token.name)) {
      throw new Error(`${token.rawName} is not available for this command. Usage: ${usage}`);
    }
    if (seen.has(token.name)) {
      throw new Error(`${token.rawName} may be provided only once. Usage: ${usage}`);
    }
    seen.add(token.name);
  }
};

const command = values.help ? 'help' : positionals[0] ?? 'interactive';
const workspaceRoot = resolve(values.workspace ?? process.cwd());
let compiledConfiguration: CompiledProductConfiguration | undefined;
const effectiveConfiguration = () => {
  if (compiledConfiguration === undefined) throw new Error('Product configuration has not been compiled.');
  return compiledConfiguration.effective;
};
const approvalProfile = () => effectiveConfiguration().approvalProfile.value;
const kernelResolution = resolveForgeKernelBinary();
let kernelProbe: Awaited<ReturnType<typeof probeForgeKernelBinary>> | undefined;
const requireKernel = (): string => requireForgeKernelBinary(kernelResolution);
let approvalIo: InteractiveSessionIo | undefined;
const interactiveIo = (): InteractiveSessionIo => {
  approvalIo ??= createNodeInteractiveIo();
  return approvalIo;
};
const approvedChoice = (value: string | undefined): boolean =>
  ['y', 'yes', 'approve'].includes(value?.trim().toLowerCase() ?? '');
const approvalConfiguration = (interactiveConsent = true): ProductApprovalConfiguration => {
  const profile = approvalProfile();
  if (profile !== 'review') return { profile };
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
      runStoreRoot: join(effectiveConfiguration().engineRoot.value, 'runs', 'v1'),
    },
  },
  approval: approvalConfiguration(interactiveConsent),
  configuration: effectiveConfiguration(),
});
let service: ForgeWorkspaceService | undefined;

const workspaceService = (): ForgeWorkspaceService => {
  service ??= new ForgeWorkspaceService(workspaceRoot, productServiceOptions());
  return service;
};

const memoryCommands = async (): Promise<MemoryCommands> => {
  const repositoryScope = await repositoryMemoryScope(workspaceRoot);
  const shared = {
    kernelPath: requireKernel(),
    engineRoot: effectiveConfiguration().engineRoot.value,
    workspaceRoot,
    actorId: 'developer:local',
  } as const;
  return new MemoryCommands(
    new RustMemoryRuntime({ ...shared, scope: repositoryScope }),
    [new RustMemoryRuntime({ ...shared, scope: { kind: 'developer', actorId: 'developer:local' } })],
  );
};

const memoryActorId = 'developer:local';
const confirmMemoryDeletion = async (message: string): Promise<void> => {
  if (values.yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY || values.json) {
    throw new Error(`${message} Re-run with --yes to confirm without an interactive prompt.`);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    const answer = (await prompt.question(`${message} Type “yes” to continue: `)).trim().toLocaleLowerCase();
    if (answer !== 'yes') throw new Error('Memory deletion cancelled; nothing was changed.');
  } finally {
    prompt.close();
  }
};

const memoryAutoSave = async (): Promise<MemoryAutoSaveController> => {
  const grantScope = await repositoryMemoryScope(workspaceRoot);
  return new MemoryAutoSaveController(
    new RustMemoryRuntime({
      kernelPath: requireKernel(),
      engineRoot: effectiveConfiguration().engineRoot.value,
      workspaceRoot,
      scope: { kind: 'developer', actorId: memoryActorId },
      actorId: memoryActorId,
    }),
    grantScope,
  );
};

const executeProviderTask = async (
  task: string,
  route: InferenceRoute,
  presenter?: LiveCliPresenter,
  governedChange?: GovernedChangeCapabilityOptions,
): Promise<{
  readonly artifact: RunArtifact;
  readonly cancellationSource: ReturnType<typeof createRunCancellation>['source'];
}> => {
  const timeoutMs = effectiveConfiguration().execution.timeoutMs.value;
  if (timeoutMs < 1 || timeoutMs > 900_000) {
    throw new Error('--timeout-ms must be from 1 to 900000.');
  }
  const cancellation = createRunCancellation(timeoutMs);
  try {
    const planner = new ProviderTaskPlanner({
      provider: createInferenceProvider(route, { configuration: effectiveConfiguration() }),
      route,
      tools: governedChange === undefined ? developerEvidenceTools : developerGovernedChangeTools,
      ...(presenter === undefined || governedChange !== undefined
        ? {}
        : { onInferenceEvent: (observation) => presenter.onInferenceEvent(observation) }),
    });
    const taskOptions = {
      maxTurns: effectiveConfiguration().execution.maxTurns.value,
      executionBudget: executionBudgetOption(),
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
  engineRoot: effectiveConfiguration().engineRoot.value,
  verificationChecks,
});

const integerOption = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined) return fallback;
  const normalized = raw.trim();
  if (!/^[+-]?\d+$/u.test(normalized)) {
    throw new Error(`${name} must be a base-10 integer.`);
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe base-10 integer.`);
  return value;
};

const executionBudgetOption = (): ExecutionBudget => ({
  schemaVersion: 1,
  maxCapabilityCalls: effectiveConfiguration().execution.maxCapabilityCalls.value,
  maxReportedInputTokens: effectiveConfiguration().execution.maxReportedInputTokens.value,
  maxReportedOutputTokens: effectiveConfiguration().execution.maxReportedOutputTokens.value,
});

const compileConfiguration = async (): Promise<CompiledProductConfiguration> => compileProductConfiguration({
  workspaceRoot,
  currentWorkingDirectory: process.cwd(),
  homeDirectory: homedir(),
  environment: process.env,
  commandLine: {
    ...(values.provider === undefined ? {} : { provider: values.provider }),
    ...(values.model === undefined ? {} : { model: values.model }),
    ...(values['engine-root'] === undefined ? {} : { engineRoot: values['engine-root'] }),
    ...(values['approval-profile'] === undefined ? {} : { approvalProfile: values['approval-profile'] }),
    ...(values['max-turns'] === undefined ? {} : { maxTurns: values['max-turns'] }),
    ...(values['max-capability-calls'] === undefined
      ? {}
      : { maxCapabilityCalls: values['max-capability-calls'] }),
    ...(values['max-input-tokens'] === undefined
      ? {}
      : { maxReportedInputTokens: values['max-input-tokens'] }),
    ...(values['max-output-tokens'] === undefined
      ? {}
      : { maxReportedOutputTokens: values['max-output-tokens'] }),
    ...(values['timeout-ms'] === undefined ? {} : { timeoutMs: values['timeout-ms'] }),
  },
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
  const configurationAction = command === 'config' ? positionals[1] : undefined;
  const configurationScope = positionals[2] as ConfigurationFileScope | undefined;
  const configurationPaths = productConfigurationPaths({ workspaceRoot, homeDirectory: homedir() });
  const hasExplicitConfigurationOption = values.provider !== undefined
    || values.model !== undefined
    || values['engine-root'] !== undefined
    || values['approval-profile'] !== undefined
    || values['max-turns'] !== undefined
    || values['max-capability-calls'] !== undefined
    || values['max-input-tokens'] !== undefined
    || values['max-output-tokens'] !== undefined
    || values['timeout-ms'] !== undefined;
  const configurationBypassesCompilation = (command === 'help' && !hasExplicitConfigurationOption)
    || (command === 'config' && (configurationAction === 'path' || configurationAction === 'init'));
  if (command === 'config' && values.config !== undefined) {
    throw new Error('--config belongs only to forge diagnostics; product configuration uses fixed paths.');
  }
  if (command === 'config'
    && (configurationAction === 'path' || configurationAction === 'init')
    && hasExplicitConfigurationOption) {
    throw new Error(`forge config ${configurationAction} does not accept effective-configuration overrides.`);
  }
  if (!configurationBypassesCompilation) compiledConfiguration = await compileConfiguration();
  if (command === 'doctor' || command === 'onboard') {
    kernelProbe = await probeForgeKernelBinary(kernelResolution);
  }
  if (values.json
    && compiledConfiguration !== undefined
    && approvalProfile() === 'review'
    && command !== 'doctor'
    && command !== 'onboard'
    && command !== 'config'
    && command !== 'memory'
    && command !== 'help') {
    throw new Error('--json cannot be used while the effective approval profile is review because consent prompts require human-mode output. Run forge config show to inspect its source.');
  }
  if (command === 'config' && configurationAction === 'path') {
    if (positionals.length > 3) throw new Error('Usage: forge config path [workspace|user] [--json]');
    const selectedScope = configurationScope;
    if (selectedScope !== undefined && selectedScope !== 'workspace' && selectedScope !== 'user') {
      throw new Error('Usage: forge config path [workspace|user] [--json]');
    }
    const report = configurationPathReport(configurationPaths);
    const selected = selectedScope === undefined ? report : { [selectedScope]: report[selectedScope] };
    if (values.json) console.log(JSON.stringify(selected, null, 2));
    else {
      if (selectedScope === undefined || selectedScope === 'workspace') {
        console.log(`Workspace configuration: ${report.workspace.path}`);
      }
      if (selectedScope === undefined || selectedScope === 'user') {
        console.log(`User configuration: ${report.user.path}`);
      }
    }
  } else if (command === 'config' && configurationAction === 'init') {
    if (positionals.length !== 3 || (configurationScope !== 'workspace' && configurationScope !== 'user')) {
      throw new Error('Usage: forge config init <workspace|user> [--json]');
    }
    const initialized = await initializeProductConfiguration({
      scope: configurationScope,
      workspaceRoot,
      homeDirectory: homedir(),
    });
    const report = {
      ok: true,
      action: 'initialized',
      scope: initialized.scope,
      path: initialized.path,
      next: 'forge config validate',
    } as const;
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Created ${initialized.scope} configuration: ${initialized.path}`);
      console.log('Next: forge config validate');
    }
  } else if (command === 'config' && (configurationAction === 'validate' || configurationAction === 'show')) {
    if (positionals.length !== 2) throw new Error(`Usage: forge config ${configurationAction} [--json]`);
    const report = {
      ok: true,
      contractVersion: effectiveConfiguration().contractVersion,
      paths: configurationPathReport(configurationPaths, compiledConfiguration?.files),
      ...(configurationAction === 'show' ? { configuration: effectiveConfiguration().diagnostics } : {}),
    } as const;
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else if (configurationAction === 'validate') {
      console.log('Forge configuration is valid.');
      console.log(`Workspace configuration: ${report.paths.workspace.status}`);
      console.log(`User configuration: ${report.paths.user.status}`);
    } else {
      console.log('Forge effective configuration');
      for (const line of renderEffectiveConfiguration(effectiveConfiguration())) console.log(line);
    }
  } else if (command === 'config') {
    throw new Error('Usage: forge config <path [workspace|user]|init <workspace|user>|validate|show> [--json]');
  } else if (command === 'doctor') {
    const configuredEngineRoot = effectiveConfiguration().engineRoot.value;
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
        effective: effectiveConfiguration().diagnostics,
      },
      runStore: {
        root: join(configuredEngineRoot, 'runs', 'v1'),
        durability: 'append-before-notify; terminal-before-result',
        recovery: 'terminal-return; validated same-runtime continuation; unsafe frontiers blocked',
      },
      executionDefaults: executionBudgetOption(),
      approval: {
        profile: approvalProfile(),
        sources: effectiveConfiguration().approvalProfile.sources,
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
    if (values.json) console.log(JSON.stringify(report));
    else {
      console.log(`ForgeEngine doctor: ${report.ok ? 'OK' : 'NOT READY'}`);
      console.log(`Node: ${report.node}`);
      console.log(`Runtime: ${report.runtime}`);
      console.log(`Kernel: ${report.kernel.path ?? report.kernel.message}`);
      console.log(`MCP: ${report.mcp}`);
      console.log(`Run store: ${report.runStore.root} (${report.runStore.recovery})`);
      console.log(`State separation: ${report.configuration.message}`);
      console.log(`Approval authority: ${report.approval.decisionAuthority}`);
      console.log('Effective configuration:');
      for (const line of renderEffectiveConfiguration(effectiveConfiguration(), { includeDigest: true })) console.log(`  ${line}`);
      console.log(`Change flow: ${report.changeFlow}`);
      console.log(`Isolation: ${report.isolation.posture}; provider=${report.isolation.providerId ?? 'unavailable'}; class=${report.isolation.providerClass ?? 'unknown'}; availability=${report.isolation.availability}; restricted-ready=${report.isolation.restrictedReady}`);
      console.log(`Isolation candidates: ${isolationCandidateSummary}`);
      console.log(`Features: ${report.readOnlyFeatures.join(', ')}`);
    }
  } else if (command === 'onboard') {
    const configuredEngineRoot = effectiveConfiguration().engineRoot.value;
    const stateSeparation = changeStateSeparation(workspaceRoot, configuredEngineRoot);
    const runtimeReady = kernelProbe?.ready === true && stateSeparation.valid;
    const report = {
      ok: runtimeReady,
      profile: 'trusted-developer-alpha',
      runtimeReady,
      releaseReady: false,
      workspaceRoot,
      engineRoot: configuredEngineRoot,
      kernel: {
        ready: kernelProbe?.ready === true,
        path: kernelResolution.path ?? null,
        source: kernelResolution.source ?? null,
        message: kernelProbe?.message ?? kernelResolution.message,
      },
      approval: {
        profile: approvalProfile(),
        sources: effectiveConfiguration().approvalProfile.sources,
        authority: 'rust-kernel',
      },
      containment: {
        profile: 'trusted',
        enforced: false,
        disclosure: 'Trusted execution inherits the developer account permissions; Forge owns process lifecycle but does not enforce an accepted OS sandbox.',
      },
      configuration: {
        stateSeparation: stateSeparation.message,
        precedenceStatus: 'conformant',
        disclosure: 'Effective configuration is compiled once from managed ceilings, explicit CLI, environment/secret references, workspace, user, then built-ins; policy values may only tighten. Diagnostics expose stable provenance and digests while credential values remain redacted.',
        effective: effectiveConfiguration().diagnostics,
      },
      nextCommands: [
        'forge doctor --json',
        'forge inspect --json --max-files 1',
        'forge --provider ollama --model <installed-model>',
      ],
      releaseBlockers: [
        'Rights attestation for existing contributions',
        'Public artifact signing and provenance',
      ],
    } as const;
    if (!runtimeReady) process.exitCode = 1;
    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('ForgeEngine trusted developer alpha onboarding');
      console.log(`Runtime: ${report.runtimeReady ? 'ready' : 'not ready'}`);
      console.log(`Kernel: ${report.kernel.path ?? report.kernel.message}`);
      console.log(`State: ${report.configuration.stateSeparation}`);
      console.log(`Trust disclosure: ${report.containment.disclosure}`);
      console.log(`Release status: private acceptance candidate; ${report.releaseBlockers.join('; ')}`);
      for (const next of report.nextCommands) console.log(`Next: ${next}`);
    }
  } else if (command === 'memory') {
    const action = positionals[1] ?? 'find';
    if (action === 'autosave') {
      const autosave = await memoryAutoSave();
      const requestedMode = positionals[2];
      if (requestedMode === undefined || requestedMode === 'status') {
        const state = await autosave.state();
        if (values.json) printJsonArtifact({ ok: true, operation: 'autosave', ...state });
        else {
          console.log(`Memory autosave for this repository: ${state.mode}.`);
          console.log(state.mode === 'auto'
            ? 'Eligible direct preferences are saved without pausing; use /memory undo in the same interactive session.'
            : state.mode === 'ask'
              ? 'Forge asks before saving an eligible direct preference.'
              : 'Automatic capture is off; forge memory remember still works.');
        }
      } else if (requestedMode === 'off' || requestedMode === 'ask' || requestedMode === 'auto') {
        const result = await autosave.setMode(requestedMode);
        const state = await autosave.state();
        if (values.json) printJsonArtifact({ ok: true, operation: 'autosave', result, ...state });
        else {
          console.log(`Memory autosave for this repository is now ${state.mode}.`);
          console.log(state.mode === 'auto'
            ? 'Next: state a clear preference such as “I prefer concise test output.” in interactive Forge.'
            : state.mode === 'ask'
              ? 'Forge will ask before saving a clear preference.'
              : 'Explicit forge memory remember commands remain available.');
        }
      } else {
        throw new Error('Usage: forge memory autosave [off|ask|auto|status] [--json]');
      }
    } else {
      let previewBudget: number | undefined;
      if (action === 'preview') {
        const usage = 'forge memory preview [--max-bytes <1..262144>] [--json]';
        requireExactCommandOptions(['engine-root', 'json', 'max-bytes', 'workspace'], usage);
        if (positionals.length !== 2) throw new Error(`Usage: ${usage}`);
        previewBudget = integerOption(values['max-bytes'], 65_536, '--max-bytes');
        if (previewBudget < 1 || previewBudget > 262_144) {
          throw new Error('--max-bytes must be a base-10 integer from 1 through 262144.');
        }
      }
      const memory = await memoryCommands();
      if (action === 'remember') {
        const statement = positionals.slice(2).join(' ').trim();
        const result = await memory.remember(statement);
        if (values.json) printJsonArtifact({ ok: true, operation: action, result });
        else for (const line of renderMemoryOperation(result)) console.log(line);
      } else if (action === 'find') {
        const found = await memory.find(positionals.slice(2).join(' '));
        if (values.json) printJsonArtifact({ ok: true, operation: action, ...found });
        else for (const line of renderMemoryList(found.matches, 'No active memories match.')) console.log(line);
      } else if (action === 'show') {
        const entry = await memory.show(positionals.slice(2).join(' '));
        if (values.json) printJsonArtifact({ ok: true, operation: action, entry });
        else for (const line of renderMemoryList([entry], 'No matching active memory.')) console.log(line);
      } else if (action === 'explain') {
        const entry = await memory.explain(positionals.slice(2).join(' '));
        if (values.json) {
          printJsonArtifact({ ok: true, operation: action, entry, retrievalActive: false });
        } else {
          for (const line of renderMemoryExplanation(entry)) console.log(line);
        }
      } else if (action === 'preview') {
        const preview = await memory.preview(previewBudget);
        if (values.json) printJsonArtifact({ ok: true, operation: action, preview });
        else for (const line of renderMemoryContextPreview(preview)) console.log(line);
      } else if (action === 'correct') {
        const selection = positionals.slice(2).join(' ').trim();
        if (values.replacement === undefined) {
          throw new Error('Usage: forge memory correct <words from memory> --replacement <corrected text> [--erase-previous] [--json]');
        }
        const result = await memory.correct(
          selection,
          values.replacement,
          values['erase-previous'] ? 'erase_previous' : 'keep_bounded',
        );
        if (values.json) printJsonArtifact({ ok: true, operation: action, result });
        else for (const line of renderMemoryOperation(result)) console.log(line);
      } else if (action === 'history') {
        if (positionals[2] === 'clear') {
          const results = await memory.clearRecoveryHistory(async (recordCount, scopeCount) => {
            if (recordCount === 0) return;
            await confirmMemoryDeletion(
              `Permanently clear ${String(recordCount)} recoverable memory record(s) across ${String(scopeCount)} exact scope(s)? Active memory stays available.`,
            );
          });
          if (values.json) {
            printJsonArtifact({
              ok: true,
              operation: 'history_clear',
              clearedRecordCount: results.reduce((sum, result) => sum + (result.receipt?.removedRecordCount ?? 0), 0),
              results,
              disclosure: memoryPrivacyBoundary,
            });
          } else if (results.length === 0) {
            console.log('Recovery history is already empty; nothing changed.');
            console.log(memoryPrivacyBoundary);
          } else {
            for (const result of results) {
              for (const line of renderMemoryPrivacyOperation(result)) console.log(line);
            }
          }
        } else {
          const history = await memory.history(positionals.slice(2).join(' '));
          if (values.json) printJsonArtifact({ ok: true, operation: action, ...history });
          else for (const line of renderMemoryList(history.matches, 'No recoverable memory history matches.')) console.log(line);
        }
      } else if (action === 'restore') {
        const result = await memory.restore(positionals.slice(2).join(' '));
        if (values.json) printJsonArtifact({ ok: true, operation: action, result });
        else for (const line of renderMemoryOperation(result)) console.log(line);
      } else if (action === 'forget') {
        const result = await memory.forget(positionals.slice(2).join(' '));
        if (values.json) printJsonArtifact({ ok: true, operation: action, result, disclosure: memoryPrivacyBoundary });
        else for (const line of renderMemoryPrivacyOperation(result)) console.log(line);
      } else if (action === 'purge') {
        const selection = positionals.slice(2).join(' ');
        const result = await memory.purge(selection, async (entry) => {
          await confirmMemoryDeletion(
            `Permanently purge the selected memory lineage (“${entry.observation.statement}”) from active and recovery memory?`,
          );
        });
        if (values.json) printJsonArtifact({ ok: true, operation: action, result, disclosure: memoryPrivacyBoundary });
        else for (const line of renderMemoryPrivacyOperation(result)) console.log(line);
      } else if (action === 'status') {
        const statuses = await memory.statuses();
        const report = {
          ...memoryStatusReport(statuses[0] as (typeof statuses)[number]),
          activeCount: statuses.reduce((sum, inspection) => sum + inspection.activeCount, 0),
          recoveryCount: statuses.reduce((sum, inspection) => sum + inspection.recoveryCount, 0),
          scopes: statuses.map((inspection) => inspection.scope),
        };
        const capture = await (await memoryAutoSave()).state();
        if (values.json) printJsonArtifact({ ...report, autosave: capture });
        else {
          console.log(`Forge memory: ${String(report.activeCount)} active; ${String(report.recoveryCount)} recoverable.`);
          console.log(`Autosave: ${capture.mode} for this repository.`);
          console.log('Retrieval: inactive until CLI8B evaluation.');
        }
      } else {
        throw new Error('Usage: forge memory <remember|find|show|explain|preview|correct|forget|history|restore|purge|autosave|status> ...');
      }
    }
  } else if (command === 'runs') {
    const operation = positionals[1];
    const runId = positionals[2]?.trim() ?? '';
    if (!['inspect', 'resume'].includes(operation ?? '') || runId.length === 0) {
      throw new Error('Usage: forge runs <inspect|resume> <run-id> [--json] [--engine-root <path>]');
    }
    const store = new RustRunStoreRuntime({
      kernelPath: requireKernel(),
      runStoreRoot: join(effectiveConfiguration().engineRoot.value, 'runs', 'v1'),
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
      const route = effectiveConfiguration().route?.value;
      if (route === undefined) {
        throw new Error('No inference route is configured. Set provider and model together, then run this command again.');
      }
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
        provider: createInferenceProvider(route, { configuration: effectiveConfiguration() }),
        route,
        tools: governedChanges ? developerGovernedChangeTools : developerEvidenceTools,
        ...(presenter === undefined || governedChanges
          ? {}
          : { onInferenceEvent: (observation) => presenter.onInferenceEvent(observation) }),
      });
      const cancellation = createRunCancellation(
        effectiveConfiguration().execution.timeoutMs.value,
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
    const configuredRoute = effectiveConfiguration().route;
    const selection = await resolveInteractiveRoute({
      ...(configuredRoute === undefined
        ? {}
        : {
            configured: {
              route: configuredRoute.value,
              source: configuredRoute.sources[0] ?? 'built_in',
            },
          }),
      ollamaBaseUrl: effectiveConfiguration().providers.ollama.baseUrl.value,
    });
    createInferenceProvider(selection.route, { configuration: effectiveConfiguration() });
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
    const autosave = await memoryAutoSave();
    let latestAutoSave: AutoSaveReceipt | undefined;
    const memoryCaptureLines = (outcome: MemoryCaptureOutcome): readonly string[] => {
      if (outcome.kind !== 'remembered') return [];
      if (outcome.receipt === undefined) {
        return [`Remembered after your review: ${outcome.result.activeObservation?.statement ?? 'preference'}.`];
      }
      latestAutoSave = outcome.receipt;
      return [`Remembered: ${outcome.receipt.statement} · /memory undo · /memory explain`];
    };
    await runInteractiveSession({
      workspaceRoot,
      initialRoute: selection,
      approvalProfile: approvalProfile(),
      io,
      notices: [governedChanges
        ? `changes: governed inside the Rust run; verification=${checkIds.join(', ')}`
        : 'changes: disabled; start with --policy <file> or set FORGE_VERIFICATION_POLICY to enable verified edits'],
      memory: {
        async capture(input) {
          const outcome = await autosave.captureDirectInput(input, async (statement) =>
            approvedChoice(await io.question(`Remember this preference? “${statement}” [y/N] `)));
          return memoryCaptureLines(outcome);
        },
        async status() {
          const state = await autosave.state();
          return [
            `memory autosave: ${state.mode} for this repository`,
            'memory retrieval: inactive until CLI8B evaluation',
          ];
        },
        async undo() {
          if (latestAutoSave === undefined) return ['Nothing automatically saved in this session is available to undo.'];
          const undone = latestAutoSave;
          await autosave.undo(undone);
          latestAutoSave = undefined;
          return [
            `Undone: ${undone.statement}`,
            'No recovery copy was retained.',
          ];
        },
        async explain() {
          if (latestAutoSave === undefined) return ['No automatic save in this session is available to explain.'];
          return [
            `Remembered from your exact direct input under this repository’s local auto grant: ${latestAutoSave.statement}`,
            'It is developer-scoped, is not injected into prompts, and can be removed now with /memory undo.',
          ];
        },
      },
      validateRoute: (route) => { createInferenceProvider(route, { configuration: effectiveConfiguration() }); },
      runTask: async (task, route) => {
        const presenter = new LiveCliPresenter();
        const { artifact } = await executeProviderTask(
          task,
          route,
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
    if (task.length === 0) throw new Error('Usage: forge run <task> [--provider <ollama|openai> --model <model>] [--workspace <path>] [--json]');
    const route = effectiveConfiguration().route?.value;
    if (route === undefined) {
      throw new Error('No inference route is configured. Set provider and model together, then run this command again.');
    }
    const presenter = values.json ? undefined : new LiveCliPresenter();
    const { artifact, cancellationSource } = await executeProviderTask(
      task,
      route,
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
      '    Forge uses the effective configured route; when none exists, interactive mode can discover a local Ollama model.',
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
      '  forge memory remember <text> [--json]',
      '  forge memory find [query] [--json]',
      '  forge memory show <words from memory> [--json]',
      '  forge memory explain <words from memory> [--json]',
      '  forge memory preview [--max-bytes <1..262144>] [--json]',
      '  forge memory correct <words from memory> --replacement <text> [--erase-previous] [--json]',
      '  forge memory history [query] [--json]',
      '  forge memory history clear [--yes] [--json]',
      '  forge memory restore <words from history> [--json]',
      '  forge memory forget <words from memory> [--json]',
      '  forge memory purge <words from active or history> [--yes] [--json]',
      '  forge memory autosave [off|ask|auto|status] [--json]',
      '  forge memory status [--json]',
      '  forge config path [workspace|user] [--json]',
      '  forge config init <workspace|user> [--json]',
      '  forge config validate [--json]',
      '  forge config show [--json]',
      '  forge doctor [--json] [--workspace <path>]',
      '  forge onboard [--json] [--workspace <path>]',
      '  forge runs inspect <run-id> [--json] [--engine-root <path>]',
      '  forge runs resume <run-id> [--provider <ollama|openai> --model <model>] [--retry-evidence] [--json]',
      '    Resume replays validated completions through the same Rust runtime; ambiguous provider, approval, and mutation work stays blocked.',
      '    --retry-evidence deliberately retries one unresolved capability explicitly classified read-only; it is accepted only once.',
      '  forge inspect [--json] [--max-files <count>]',
      '  forge search <literal query> [--json] [--max-matches <count>]',
      '  forge read <path> [--json] [--start-line <line>] [--max-lines <count>]',
      '  forge symbols [name query] [--json] [--max-symbols <count>]',
      '  forge diagnostics [--config <tsconfig>] [--json] [--max-diagnostics <count>]',
      '  forge git-status [--json]',
      '  forge git-diff [--staged] [--json] [--max-bytes <count>]',
      '  forge run <task> [--provider <ollama|openai> --model <model>] [--max-turns <count>] [--timeout-ms <ms>] [--json]',
      '    Optional controls: --approval-profile <developer|review|locked>, --max-capability-calls, --max-input-tokens, --max-output-tokens.',
      '    Token ceilings stop continuation after cumulative provider-reported usage crosses the limit.',
      '    Human mode streams validated assistant text and canonical run status; --json emits one terminal artifact.',
      '  forge mcp [--workspace <path>]',
      '',
      'Configuration uses <workspace>/.forge/config.json and ~/.forge/config.json with explicit CLI and environment precedence. Config commands are kernel-free. Product execution commands require the Rust kernel; FORGE_KERNEL_BINARY remains a bootstrap override.',
      'Verification is currently trusted local execution; Forge owns process cleanup but does not yet enforce an OS sandbox.',
    ].join('\n'));
  } else {
    throw new Error(`Unknown Forge command: ${command}`);
  }
} catch (error) {
  const configurationIssue = error instanceof ConfigurationIssueError
    || error instanceof ConfigurationResolutionError
    ? error.issue
    : undefined;
  if (configurationIssue !== undefined) {
    if (values.json) {
      console.error(JSON.stringify({ ok: false, error: configurationIssue }));
    } else {
      console.error(`[forge] ${configurationIssue.message}`);
      console.error(`Location: ${configurationIssue.location}`);
      console.error(`Next: ${configurationIssue.hint}`);
    }
  } else if (error instanceof ConfigurationCommandError) {
    if (values.json) {
      console.error(JSON.stringify({
        ok: false,
        error: { code: 'config_command_failed', message: error.message, path: error.path, hint: error.hint },
      }));
    } else {
      console.error(`[forge] ${error.message}`);
      console.error(`Path: ${error.path}`);
      console.error(`Next: ${error.hint}`);
    }
  } else if (values.json && command === 'memory') {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: error instanceof MemorySelectionError || error instanceof MemoryRuntimeError
          ? error.code
          : 'memory_command_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }));
  } else if (values.json && command === 'config') {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      ok: false,
      error: { code: 'config_command_invalid', message },
    }));
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[forge] ' + message);
  }
  if (process.env.FORGE_DEBUG === '1' && error instanceof Error && error.stack !== undefined) {
    console.error(error.stack);
  }
  process.exitCode = 1;
} finally {
  service?.close();
  approvalIo?.close();
}
