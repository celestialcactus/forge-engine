import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { WorkspaceSnapshot } from '../slice0/contracts.js';
import { isIgnoredWorkspaceDirectory } from './workspace-ignore.js';

export type WorkspaceSnapshotProvider = (workspaceRoot: string) => Promise<WorkspaceSnapshot>;

export interface WorkspaceChangeSubscription {
  close(): void;
}

export type WorkspaceChangeObserver = (
  workspaceRoot: string,
  onChange: () => void,
  onUnavailable: () => void,
) => WorkspaceChangeSubscription | undefined;

const portablePath = (path: string): string => path.replaceAll('\\', '/');

/**
 * Observe only paths that participate in a Forge workspace snapshot. A watcher is
 * an invalidation signal, not a source of repository truth; refresh still performs
 * the canonical scan.
 */
export const observeWorkspaceChanges: WorkspaceChangeObserver = (workspaceRoot, onChange, onUnavailable) => {
  let watcher: FSWatcher;
  try {
    watcher = watch(resolve(workspaceRoot), { recursive: true, persistent: false }, (_event, filename) => {
      if (filename === null) {
        onChange();
        return;
      }
      const firstSegment = portablePath(String(filename)).split('/')[0];
      if (firstSegment === undefined || !isIgnoredWorkspaceDirectory(firstSegment)) onChange();
    });
  } catch {
    return undefined;
  }
  watcher.once('error', () => {
    watcher.close();
    onUnavailable();
  });
  return watcher;
};

export interface WorkspaceSnapshotCacheOptions {
  readonly provider: WorkspaceSnapshotProvider;
  readonly observer?: WorkspaceChangeObserver;
  readonly maxReuseMs?: number;
  readonly now?: () => number;
}

export interface WorkspaceSnapshotCacheMetrics {
  readonly scans: number;
  readonly reuses: number;
  readonly invalidations: number;
  readonly freshnessMode: 'observed-with-rescan' | 'scan-per-call';
}

/** Connection-scoped reuse with change observation and a bounded rescan ceiling. */
export class WorkspaceSnapshotCache {
  readonly #provider: WorkspaceSnapshotProvider;
  readonly #maxReuseMs: number;
  readonly #now: () => number;
  #subscription: WorkspaceChangeSubscription | undefined;
  #generation = 0;
  #settled: { readonly generation: number; readonly createdAt: number; readonly snapshot: WorkspaceSnapshot } | undefined;
  #inFlight: { readonly generation: number; readonly promise: Promise<WorkspaceSnapshot> } | undefined;
  #scans = 0;
  #reuses = 0;
  #invalidations = 0;

  constructor(
    private readonly workspaceRoot: string,
    options: WorkspaceSnapshotCacheOptions,
  ) {
    this.#provider = options.provider;
    this.#maxReuseMs = options.maxReuseMs ?? 5_000;
    if (!Number.isInteger(this.#maxReuseMs) || this.#maxReuseMs < 0 || this.#maxReuseMs > 60_000) {
      throw new Error('maxReuseMs must be an integer from 0 to 60000.');
    }
    this.#now = options.now ?? (() => performance.now());
    this.#subscription = (options.observer ?? observeWorkspaceChanges)(
      workspaceRoot,
      () => this.invalidate(),
      () => {
        this.#subscription = undefined;
        this.invalidate();
      },
    );
  }

  async get(): Promise<WorkspaceSnapshot> {
    const reusable = this.#settled;
    const withinRescanCeiling = reusable !== undefined && this.#now() - reusable.createdAt < this.#maxReuseMs;
    if (this.#subscription !== undefined && reusable?.generation === this.#generation && withinRescanCeiling) {
      this.#reuses++;
      return reusable.snapshot;
    }

    const active = this.#inFlight;
    if (active?.generation === this.#generation) {
      this.#reuses++;
      return active.promise;
    }

    const scanGeneration = this.#generation;
    this.#scans++;
    const pending = this.#provider(this.workspaceRoot);
    this.#inFlight = { generation: scanGeneration, promise: pending };
    try {
      const snapshot = await pending;
      if (this.#subscription !== undefined && scanGeneration === this.#generation) {
        this.#settled = { generation: scanGeneration, createdAt: this.#now(), snapshot };
      }
      return snapshot;
    } finally {
      if (this.#inFlight?.promise === pending) this.#inFlight = undefined;
    }
  }

  invalidate(): void {
    this.#generation++;
    this.#settled = undefined;
    this.#invalidations++;
  }

  metrics(): WorkspaceSnapshotCacheMetrics {
    return {
      scans: this.#scans,
      reuses: this.#reuses,
      invalidations: this.#invalidations,
      freshnessMode: this.#subscription === undefined ? 'scan-per-call' : 'observed-with-rescan',
    };
  }

  close(): void {
    this.#subscription?.close();
    this.#subscription = undefined;
    this.#settled = undefined;
  }
}
