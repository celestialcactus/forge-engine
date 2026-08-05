import { randomUUID } from 'node:crypto';
import type {
  ApprovalPolicy,
  Capability,
  CapabilityCall,
  CapabilityResult,
  ExecutionBudget,
  OutcomeContract,
  PlannerRequest,
  PlannerTurn,
  RunArtifact,
  RunEvent,
  TaskPlanner,
  WorkspaceSnapshot,
} from '../slice0/contracts.js';
import { TypeScriptConformanceRuntime } from '../slice0/runtime.js';
import { RustKernelRuntime, type ApprovalFactsProvider } from '../hybrid/rust-kernel-runtime.js';
import {
  createGovernedChangeCapability,
  type GovernedChangeCapabilityOptions,
} from '../governed-change.js';
import {
  createChangeProposalCapability,
  type ChangeProposalOptions,
  type TextChangeRequest,
} from './change-proposal.js';
import { createDeveloperEvidenceCapabilities } from './capability-pack.js';
import { createWorkspaceSnapshot } from './workspace.js';
import {
  WorkspaceSnapshotCache,
  type WorkspaceChangeObserver,
  type WorkspaceSnapshotCacheMetrics,
  type WorkspaceSnapshotProvider,
} from './snapshot-cache.js';

class SingleCapabilityPlanner implements TaskPlanner {
  readonly id = 'single-capability-v1';

  constructor(private readonly call: CapabilityCall) {}

  async next(request: PlannerRequest, signal: AbortSignal): Promise<PlannerTurn> {
    signal.throwIfAborted();
    if (request.capabilityResults.length === 0) return { kind: 'call', call: this.call };
    const result = request.capabilityResults.at(-1);
    if (result === undefined) throw new Error('Capability result was not recorded.');
    return { kind: 'complete', output: result.content };
  }
}

const nonMutatingApprovalFacts = (call: CapabilityCall) => ({
  schemaVersion: 1 as const,
  callId: call.id,
  capabilityId: call.capabilityId,
  hostPolicy: {
    posture: 'allow' as const,
    source: 'forge.v1.read-only-policy',
    reason: 'Forge permits registered non-mutating workspace evidence and change planning.',
  },
  userConsent: {
    status: 'notRequired' as const,
    source: 'forge.v1.read-only-policy',
    reason: 'Registered non-mutating capabilities do not require interactive consent.',
  },
});

const nonMutatingPolicy: ApprovalPolicy = {
  async decide(call) {
    return {
      outcome: 'allow',
      reason: 'Forge permits registered non-mutating workspace evidence and change planning.',
      facts: nonMutatingApprovalFacts(call),
    };
  },
};

const nonMutatingApprovalFactsProvider: ApprovalFactsProvider = {
  async collect(call, signal) {
    signal.throwIfAborted();
    return nonMutatingApprovalFacts(call);
  },
};

const guardedChangeApprovalFacts = (call: CapabilityCall) => call.capabilityId === 'workspace.change.execute'
  ? {
      schemaVersion: 1 as const,
      callId: call.id,
      capabilityId: call.capabilityId,
      hostPolicy: {
        posture: 'allow' as const,
        source: 'forge.cli.guarded-change-entry',
        reason: 'The CLI may enter the registered guarded change workflow; exact mutation and promotion require visible developer decisions.',
      },
      userConsent: {
        status: 'notRequired' as const,
        source: 'forge.cli.guarded-change-entry',
        reason: 'Entry does not itself authorize a mutation; the digest-bound ChangeSet asks before candidate execution and promotion.',
      },
    }
  : nonMutatingApprovalFacts(call);

const guardedChangePolicy: ApprovalPolicy = {
  async decide(call) {
    return {
      outcome: 'allow',
      reason: guardedChangeApprovalFacts(call).hostPolicy.reason,
      facts: guardedChangeApprovalFacts(call),
    };
  },
};

const guardedChangeApprovalFactsProvider: ApprovalFactsProvider = {
  async collect(call, signal) {
    signal.throwIfAborted();
    return guardedChangeApprovalFacts(call);
  },
};

interface RuntimeApprovalBoundary {
  readonly policy: ApprovalPolicy;
  readonly facts: ApprovalFactsProvider;
}

const nonMutatingApprovalBoundary: RuntimeApprovalBoundary = {
  policy: nonMutatingPolicy,
  facts: nonMutatingApprovalFactsProvider,
};

const guardedChangeApprovalBoundary: RuntimeApprovalBoundary = {
  policy: guardedChangePolicy,
  facts: guardedChangeApprovalFactsProvider,
};

export interface SearchWorkspaceOptions {
  readonly maxMatches?: number;
  readonly caseSensitive?: boolean;
}

export interface ReadWorkspaceOptions {
  readonly startLine?: number;
  readonly maxLines?: number;
}

export interface SymbolOptions {
  readonly query?: string;
  readonly maxFiles?: number;
  readonly maxSymbols?: number;
}

export interface DiagnosticOptions {
  readonly configPath?: string;
  readonly maxDiagnostics?: number;
}

export interface GitDiffOptions {
  readonly staged?: boolean;
  readonly maxBytes?: number;
}

export const defaultExecutionBudget = {
  schemaVersion: 1,
  maxCapabilityCalls: 6,
  maxReportedInputTokens: 262_144,
  maxReportedOutputTokens: 32_768,
} as const satisfies ExecutionBudget;

export interface ExecuteTaskOptions {
  readonly contextBudgetBytes?: number;
  readonly maxTurns?: number;
  readonly executionBudget?: ExecutionBudget;
  readonly outcomeContract?: OutcomeContract;
  readonly onEvent?: (event: RunEvent) => void;
}

export interface RustKernelServiceOptions {
  readonly binaryPath: string;
  readonly arguments?: readonly string[];
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
}

export type ForgeWorkspaceRuntimeConfiguration =
  | { readonly kind: 'rust_kernel'; readonly kernel: RustKernelServiceOptions }
  | { readonly kind: 'typescript_conformance_fixture' };

export const typeScriptConformanceFixture = {
  kind: 'typescript_conformance_fixture',
} as const satisfies ForgeWorkspaceRuntimeConfiguration;

const validateRuntimeConfiguration = (
  runtime: ForgeWorkspaceRuntimeConfiguration | undefined,
): ForgeWorkspaceRuntimeConfiguration => {
  if (runtime === undefined) {
    throw new Error('ForgeWorkspaceService requires an explicit runtime authority. Product execution must select the Rust kernel.');
  }
  if (runtime.kind === 'rust_kernel' && runtime.kernel.binaryPath.trim().length === 0) {
    throw new Error('Rust kernel runtime requires a non-empty binary path.');
  }
  return runtime;
};

export interface ForgeWorkspaceServiceOptions {
  readonly snapshotProvider?: WorkspaceSnapshotProvider;
  readonly snapshotObserver?: WorkspaceChangeObserver;
  readonly snapshotMaxReuseMs?: number;
  readonly runIdFactory?: () => string;
  readonly runtime: ForgeWorkspaceRuntimeConfiguration;
}

export class ForgeWorkspaceService {
  readonly #snapshots: WorkspaceSnapshotCache;
  readonly #runIdFactory: () => string;
  readonly #runtime: ForgeWorkspaceRuntimeConfiguration;
  readonly #evidenceCapabilities: ReadonlyMap<string, Capability>;

  constructor(
    private readonly workspaceRoot: string,
    options: ForgeWorkspaceServiceOptions,
  ) {
    const runtime = validateRuntimeConfiguration(options?.runtime);
    this.#snapshots = new WorkspaceSnapshotCache(workspaceRoot, {
      provider: options.snapshotProvider ?? createWorkspaceSnapshot,
      ...(options.snapshotObserver === undefined ? {} : { observer: options.snapshotObserver }),
      ...(options.snapshotMaxReuseMs === undefined ? {} : { maxReuseMs: options.snapshotMaxReuseMs }),
    });
    this.#runIdFactory = options.runIdFactory ?? (() => `run:${randomUUID()}`);
    this.#runtime = runtime;
    const capabilities = createDeveloperEvidenceCapabilities(workspaceRoot);
    this.#evidenceCapabilities = new Map(capabilities.map((capability) => [capability.id, capability]));
    if (this.#evidenceCapabilities.size !== capabilities.length) throw new Error('Developer evidence capability IDs must be unique.');
  }

  async inspect(maxFiles = 200, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      'Inspect the opened workspace.',
      this.#evidenceCapability('workspace.inventory'),
      { maxFiles },
      signal,
    );
  }

  async executeTask(
    task: string,
    planner: TaskPlanner,
    options: ExecuteTaskOptions = {},
    signal?: AbortSignal,
  ): Promise<RunArtifact> {
    return this.#executeTaskWithCapabilities(
      task,
      planner,
      [...this.#evidenceCapabilities.values()],
      options,
      signal,
    );
  }

  async executeGovernedChangeTask(
    task: string,
    planner: TaskPlanner,
    capabilityOptions: GovernedChangeCapabilityOptions,
    options: ExecuteTaskOptions = {},
    signal?: AbortSignal,
  ): Promise<RunArtifact> {
    return this.#executeTaskWithCapabilities(
      task,
      planner,
      [...this.#evidenceCapabilities.values(), createGovernedChangeCapability(this.workspaceRoot, capabilityOptions)],
      options,
      signal,
      guardedChangeApprovalBoundary,
    );
  }

  async search(query: string, options: SearchWorkspaceOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      `Search the opened workspace for: ${query}`,
      this.#evidenceCapability('workspace.search'),
      { query, maxMatches: options.maxMatches ?? 50, caseSensitive: options.caseSensitive ?? false },
      signal,
    );
  }

  async read(path: string, options: ReadWorkspaceOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      `Read bounded workspace evidence from: ${path}`,
      this.#evidenceCapability('workspace.read'),
      { path, startLine: options.startLine ?? 1, maxLines: options.maxLines ?? 200 },
      signal,
    );
  }

  async symbols(options: SymbolOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      options.query === undefined ? 'List workspace declarations.' : `Find workspace declarations matching: ${options.query}`,
      this.#evidenceCapability('workspace.symbols'),
      { query: options.query, maxFiles: options.maxFiles ?? 200, maxSymbols: options.maxSymbols ?? 500 },
      signal,
    );
  }

  async proposeChanges(
    changes: readonly TextChangeRequest[],
    options: ChangeProposalOptions = {},
    signal?: AbortSignal,
  ): Promise<RunArtifact> {
    return this.#runCapability(
      'Propose a digest-bound workspace change.',
      createChangeProposalCapability(this.workspaceRoot),
      { changes, maxDiffBytes: options.maxDiffBytes ?? 100_000 },
      signal,
    );
  }

  async diagnostics(options: DiagnosticOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      'Collect no-emit TypeScript diagnostics.',
      this.#evidenceCapability('typescript.diagnostics'),
      { configPath: options.configPath, maxDiagnostics: options.maxDiagnostics ?? 200 },
      signal,
    );
  }

  async gitStatus(signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability('Inspect read-only Git status.', this.#evidenceCapability('git.status'), {}, signal);
  }

  async gitDiff(options: GitDiffOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      options.staged === true ? 'Inspect the staged Git diff.' : 'Inspect the unstaged Git diff.',
      this.#evidenceCapability('git.diff'),
      { staged: options.staged ?? false, maxBytes: options.maxBytes ?? 100_000 },
      signal,
    );
  }

  async #executeTaskWithCapabilities(
    task: string,
    planner: TaskPlanner,
    capabilities: readonly Capability[],
    options: ExecuteTaskOptions,
    signal?: AbortSignal,
    approvalBoundary: RuntimeApprovalBoundary = nonMutatingApprovalBoundary,
  ): Promise<RunArtifact> {
    if (task.trim().length === 0) throw new Error('A Forge task must not be empty.');
    const contextBudgetBytes = options.contextBudgetBytes ?? 65_536;
    const maxTurns = options.maxTurns ?? 8;
    const executionBudget = options.executionBudget ?? defaultExecutionBudget;
    if (!Number.isInteger(contextBudgetBytes) || contextBudgetBytes < 1 || contextBudgetBytes > 1_048_576) {
      throw new Error('contextBudgetBytes must be an integer from 1 to 1048576.');
    }
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 32) {
      throw new Error('maxTurns must be an integer from 1 to 32.');
    }
    if (executionBudget.schemaVersion !== 1) {
      throw new Error('executionBudget schemaVersion must be 1.');
    }
    if (!Number.isInteger(executionBudget.maxCapabilityCalls)
      || executionBudget.maxCapabilityCalls < 0
      || executionBudget.maxCapabilityCalls > 64
    ) throw new Error('maxCapabilityCalls must be an integer from 0 to 64.');
    for (const [label, value] of [
      ['maxReportedInputTokens', executionBudget.maxReportedInputTokens],
      ['maxReportedOutputTokens', executionBudget.maxReportedOutputTokens],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) {
        throw new Error(`${label} must be an integer from 0 to 1000000000000.`);
      }
    }
    return this.#runPlanner(
      task,
      planner,
      capabilities,
      contextBudgetBytes,
      maxTurns,
      executionBudget,
      options.outcomeContract,
      signal,
      options.onEvent,
      approvalBoundary,
    );
  }

  async #runCapability(task: string, capability: Capability, input: unknown, signal?: AbortSignal): Promise<RunArtifact> {
    const call: CapabilityCall = { id: 'call-1', capabilityId: capability.id, input };
    const planner = new SingleCapabilityPlanner(call);
    const outcomeContract: OutcomeContract = {
      schemaVersion: 1,
      requirements: [
        {
          id: 'capability-succeeded',
          kind: 'capability_succeeded',
          capabilityId: capability.id,
          minimumInvocations: 1,
        },
        { id: 'output-present', kind: 'output_non_empty' },
      ],
    };
    return this.#runPlanner(
      task,
      planner,
      [capability],
      65_536,
      2,
      defaultExecutionBudget,
      outcomeContract,
      signal,
    );
  }

  async #runPlanner(
    task: string,
    planner: TaskPlanner,
    capabilities: readonly Capability[],
    contextBudgetBytes: number,
    maxTurns: number,
    executionBudget: ExecutionBudget,
    outcomeContract?: OutcomeContract,
    signal?: AbortSignal,
    onEvent?: (event: RunEvent) => void,
    approvalBoundary: RuntimeApprovalBoundary = nonMutatingApprovalBoundary,
  ): Promise<RunArtifact> {
    signal?.throwIfAborted();
    const snapshot = await this.#workspaceSnapshot();
    signal?.throwIfAborted();
    const runtime = this.#runtime.kind === 'typescript_conformance_fixture'
      ? new TypeScriptConformanceRuntime({
          planner,
          approvalPolicy: approvalBoundary.policy,
          capabilities,
          ...(onEvent === undefined ? {} : { onEvent }),
        })
      : new RustKernelRuntime({
          planner,
          approvalFacts: approvalBoundary.facts,
          capabilities,
          ...(onEvent === undefined ? {} : { onEvent }),
          kernelPath: this.#runtime.kernel.binaryPath,
          ...(this.#runtime.kernel.arguments === undefined ? {} : { kernelArguments: this.#runtime.kernel.arguments }),
          ...(this.#runtime.kernel.environment === undefined ? {} : { environment: this.#runtime.kernel.environment }),
        });
    return runtime.run({
      runId: this.#runIdFactory(),
      task,
      snapshot,
      contextBudgetBytes,
      maxTurns,
      executionBudget,
      ...(outcomeContract === undefined ? {} : { outcomeContract }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  #evidenceCapability(id: string): Capability {
    const capability = this.#evidenceCapabilities.get(id);
    if (capability === undefined) throw new Error(`Developer evidence capability is not registered: ${id}`);
    return capability;
  }

  async #workspaceSnapshot(): Promise<WorkspaceSnapshot> {
    return this.#snapshots.get();
  }

  invalidateWorkspaceSnapshot(): void {
    this.#snapshots.invalidate();
  }

  snapshotMetrics(): WorkspaceSnapshotCacheMetrics {
    return this.#snapshots.metrics();
  }

  close(): void {
    this.#snapshots.close();
  }
}

export function artifactPayload(artifact: RunArtifact): Readonly<Record<string, unknown>> {
  const result: CapabilityResult | undefined = artifact.capabilityResults.at(-1);
  let evidence: unknown = result?.content;
  if (result?.content !== undefined) {
    try {
      evidence = JSON.parse(result.content) as unknown;
    } catch {
      evidence = result.content;
    }
  }
  return {
    schemaVersion: artifact.schemaVersion,
    runId: artifact.runId,
    task: artifact.task,
    status: artifact.status,
    outcomeContract: artifact.outcomeContract,
    outcome: artifact.outcome,
    capability: result === undefined ? null : { callId: result.callId, success: result.success },
    workspace: { id: artifact.snapshot.id, rootLabel: artifact.snapshot.rootLabel },
    context: {
      budgetBytes: artifact.contextPlan?.budgetBytes,
      selectedItems: artifact.contextPlan?.selected.length ?? 0,
      omittedItems: artifact.contextPlan?.omitted.length ?? 0,
    },
    evidence,
    output: artifact.output,
    inferenceEvidence: artifact.inferenceEvidence ?? [],
    events: artifact.events,
  };
}
