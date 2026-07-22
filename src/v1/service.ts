import { randomUUID } from 'node:crypto';
import type {
  ApprovalPolicy,
  Capability,
  CapabilityCall,
  CapabilityResult,
  PlannerRequest,
  PlannerTurn,
  RunArtifact,
  TaskPlanner,
  WorkspaceSnapshot,
} from '../slice0/contracts.js';
import { Slice0Runtime } from '../slice0/runtime.js';
import {
  createChangeProposalCapability,
  type ChangeProposalOptions,
  type TextChangeRequest,
} from './change-proposal.js';
import { createWorkspaceReadCapability, createWorkspaceSymbolsCapability } from './files.js';
import { createGitDiffCapability, createGitStatusCapability } from './git-evidence.js';
import { createTypeScriptDiagnosticsCapability } from './typescript-evidence.js';
import { createWorkspaceSearchCapability, createWorkspaceSnapshot, workspaceInventoryCapability } from './workspace.js';
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

const readOnlyPolicy: ApprovalPolicy = {
  async decide() {
    return { outcome: 'allow', reason: 'Developer Test Milestone A exposes only registered read-only evidence.' };
  },
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

export interface ForgeWorkspaceServiceOptions {
  readonly snapshotProvider?: WorkspaceSnapshotProvider;
  readonly snapshotObserver?: WorkspaceChangeObserver;
  readonly snapshotMaxReuseMs?: number;
  readonly runIdFactory?: () => string;
}

export class ForgeWorkspaceService {
  readonly #snapshots: WorkspaceSnapshotCache;
  readonly #runIdFactory: () => string;

  constructor(
    private readonly workspaceRoot: string,
    options: ForgeWorkspaceServiceOptions = {},
  ) {
    this.#snapshots = new WorkspaceSnapshotCache(workspaceRoot, {
      provider: options.snapshotProvider ?? createWorkspaceSnapshot,
      ...(options.snapshotObserver === undefined ? {} : { observer: options.snapshotObserver }),
      ...(options.snapshotMaxReuseMs === undefined ? {} : { maxReuseMs: options.snapshotMaxReuseMs }),
    });
    this.#runIdFactory = options.runIdFactory ?? (() => `run:${randomUUID()}`);
  }

  async run(task: string, maxFiles = 200, signal?: AbortSignal): Promise<RunArtifact> {
    if (task.trim().length === 0) throw new Error('A Forge task must not be empty.');
    return this.#runCapability(task, workspaceInventoryCapability, { maxFiles }, signal);
  }

  async inspect(maxFiles = 200, signal?: AbortSignal): Promise<RunArtifact> {
    return this.run('Inspect the opened workspace.', maxFiles, signal);
  }

  async search(query: string, options: SearchWorkspaceOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      `Search the opened workspace for: ${query}`,
      createWorkspaceSearchCapability(this.workspaceRoot),
      { query, maxMatches: options.maxMatches ?? 50, caseSensitive: options.caseSensitive ?? false },
      signal,
    );
  }

  async read(path: string, options: ReadWorkspaceOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      `Read bounded workspace evidence from: ${path}`,
      createWorkspaceReadCapability(this.workspaceRoot),
      { path, startLine: options.startLine ?? 1, maxLines: options.maxLines ?? 200 },
      signal,
    );
  }

  async symbols(options: SymbolOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      options.query === undefined ? 'List workspace declarations.' : `Find workspace declarations matching: ${options.query}`,
      createWorkspaceSymbolsCapability(this.workspaceRoot),
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
      createTypeScriptDiagnosticsCapability(this.workspaceRoot),
      { configPath: options.configPath, maxDiagnostics: options.maxDiagnostics ?? 200 },
      signal,
    );
  }

  async gitStatus(signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability('Inspect read-only Git status.', createGitStatusCapability(this.workspaceRoot), {}, signal);
  }

  async gitDiff(options: GitDiffOptions = {}, signal?: AbortSignal): Promise<RunArtifact> {
    return this.#runCapability(
      options.staged === true ? 'Inspect the staged Git diff.' : 'Inspect the unstaged Git diff.',
      createGitDiffCapability(this.workspaceRoot),
      { staged: options.staged ?? false, maxBytes: options.maxBytes ?? 100_000 },
      signal,
    );
  }

  async #runCapability(task: string, capability: Capability, input: unknown, signal?: AbortSignal): Promise<RunArtifact> {
    signal?.throwIfAborted();
    const snapshot = await this.#workspaceSnapshot();
    signal?.throwIfAborted();
    const call: CapabilityCall = { id: 'call-1', capabilityId: capability.id, input };
    return new Slice0Runtime({
      planner: new SingleCapabilityPlanner(call),
      approvalPolicy: readOnlyPolicy,
      capabilities: [capability],
    }).run({
      runId: this.#runIdFactory(),
      task,
      snapshot,
      contextBudgetBytes: 65_536,
      maxTurns: 2,
      ...(signal === undefined ? {} : { signal }),
    });
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
    status: artifact.status,
    capability: result === undefined ? null : { callId: result.callId, success: result.success },
    workspace: { id: artifact.snapshot.id, rootLabel: artifact.snapshot.rootLabel },
    context: {
      budgetBytes: artifact.contextPlan?.budgetBytes,
      selectedItems: artifact.contextPlan?.selected.length ?? 0,
      omittedItems: artifact.contextPlan?.omitted.length ?? 0,
    },
    evidence,
    events: artifact.events,
  };
}
