import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type {
  MemoryCorrectionDisposition,
  MemoryInspection,
  MemoryObservation,
  MemoryOperationResult,
  MemoryRuntime,
  ProjectedMemory,
  RecoveryMemory,
  RepositoryMemoryScope,
} from './contracts.js';

export class MemorySelectionError extends Error {
  readonly code: 'memory_selector_absent' | 'memory_selector_ambiguous';

  constructor(code: 'memory_selector_absent' | 'memory_selector_ambiguous', message: string) {
    super(message);
    this.name = 'MemorySelectionError';
    this.code = code;
  }
}

export const repositoryMemoryScope = async (workspaceRoot: string): Promise<RepositoryMemoryScope> => {
  const canonical = await realpath(workspaceRoot);
  const normalized = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return {
    kind: 'repository',
    workspaceId: `workspace:v1:sha256:${digest}`,
    repositoryId: `repository:v1:sha256:${digest}`,
  };
};

export interface MemoryFindResult {
  readonly inspection: MemoryInspection;
  readonly inspections: readonly MemoryInspection[];
  readonly matches: readonly ProjectedMemory[];
}

export class MemoryCommands {
  readonly #runtime: MemoryRuntime;
  readonly #runtimes: readonly MemoryRuntime[];

  constructor(runtime: MemoryRuntime, additionalRuntimes: readonly MemoryRuntime[] = []) {
    this.#runtime = runtime;
    this.#runtimes = [runtime, ...additionalRuntimes];
  }

  remember(statement: string): Promise<MemoryOperationResult> {
    const normalized = statement.trim();
    if (normalized.length === 0) throw new Error('Tell Forge what to remember.');
    return this.#runtime.remember(normalized);
  }

  async find(query = ''): Promise<MemoryFindResult> {
    const inspections = await this.#inspectAll(false);
    const inspection = inspections[0] as MemoryInspection;
    const matches = filterEntries(inspections.flatMap((candidate) => candidate.active), query);
    return { inspection, inspections, matches };
  }

  async show(selection: string): Promise<ProjectedMemory> {
    return (await this.#activeTarget(selection)).entry;
  }

  explain(selection: string): Promise<ProjectedMemory> {
    return this.show(selection);
  }

  async correct(
    selection: string,
    replacement: string,
    disposition: MemoryCorrectionDisposition,
  ): Promise<MemoryOperationResult> {
    const target = await this.#activeTarget(selection);
    const normalized = replacement.trim();
    if (normalized.length === 0) throw new Error('Supply the corrected memory text.');
    return target.runtime.correct(
      target.entry.observation.observationId,
      normalized,
      disposition,
    );
  }

  async history(query = ''): Promise<{
    readonly inspection: MemoryInspection;
    readonly inspections: readonly MemoryInspection[];
    readonly matches: readonly RecoveryMemory[];
  }> {
    const inspections = await this.#inspectAll(true);
    const inspection = inspections[0] as MemoryInspection;
    return {
      inspection,
      inspections,
      matches: filterEntries(inspections.flatMap((candidate) => candidate.recovery ?? []), query),
    };
  }

  async restore(selection: string): Promise<MemoryOperationResult> {
    const candidates = await Promise.all(this.#runtimes.map(async (runtime) => ({
      runtime,
      inspection: await runtime.inspect(true),
    })));
    const target = selectOne(
      candidates.flatMap((candidate) => candidate.inspection.recovery ?? []),
      selection,
      'recoverable memory',
    );
    const owner = candidates.find((candidate) => sameScope(candidate.inspection.scope, target.observation.scope));
    if (owner === undefined) throw new Error('Selected recoverable memory has no exact-scope runtime.');
    return owner.runtime.restore(target.observation.observationId);
  }

  async forget(selection: string): Promise<MemoryOperationResult> {
    const target = await this.#activeTarget(selection);
    return target.runtime.forget(target.entry.observation.observationId);
  }

  async purge(
    selection: string,
    authorize?: (entry: ProjectedMemory | RecoveryMemory) => Promise<void>,
  ): Promise<MemoryOperationResult> {
    const candidates = await Promise.all(this.#runtimes.map(async (runtime) => ({
      runtime,
      inspection: await runtime.inspect(true),
    })));
    const target = selectOne(
      candidates.flatMap((candidate) => [
        ...candidate.inspection.active,
        ...(candidate.inspection.recovery ?? []),
      ]),
      selection,
      'memory',
    );
    const owner = candidates.find((candidate) => sameScope(candidate.inspection.scope, target.observation.scope));
    if (owner === undefined) throw new Error('Selected memory has no exact-scope runtime.');
    await authorize?.(target);
    return owner.runtime.purge(target.observation.observationId);
  }

  async clearRecoveryHistory(
    authorize?: (recordCount: number, scopeCount: number) => Promise<void>,
  ): Promise<readonly MemoryOperationResult[]> {
    const candidates = await Promise.all(this.#runtimes.map(async (runtime) => ({
      runtime,
      inspection: await runtime.inspect(true),
    })));
    const withRecovery = candidates.filter((candidate) => candidate.inspection.recoveryCount > 0);
    await authorize?.(
      withRecovery.reduce((sum, candidate) => sum + candidate.inspection.recoveryCount, 0),
      withRecovery.length,
    );
    return Promise.all(withRecovery.map((candidate) => candidate.runtime.clearRecoveryHistory()));
  }

  status(): Promise<MemoryInspection> {
    return this.#runtime.inspect(false);
  }

  statuses(): Promise<MemoryInspection[]> {
    return this.#inspectAll(false);
  }

  async #activeTarget(selection: string): Promise<{ readonly entry: ProjectedMemory; readonly runtime: MemoryRuntime }> {
    const candidates = await Promise.all(this.#runtimes.map(async (runtime) => ({
      runtime,
      inspection: await runtime.inspect(false),
    })));
    const entry = selectOne(
      candidates.flatMap((candidate) => candidate.inspection.active),
      selection,
      'active memory',
    );
    const owner = candidates.find((candidate) => sameScope(candidate.inspection.scope, entry.observation.scope));
    if (owner === undefined) throw new Error('Selected active memory has no exact-scope runtime.');
    return { entry, runtime: owner.runtime };
  }

  #inspectAll(includeRecovery: boolean): Promise<MemoryInspection[]> {
    return Promise.all(this.#runtimes.map((runtime) => runtime.inspect(includeRecovery)));
  }
}

type SelectableEntry = ProjectedMemory | RecoveryMemory;

export const filterEntries = <Entry extends SelectableEntry>(
  entries: readonly Entry[],
  query: string,
): readonly Entry[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return entries;
  return entries.filter((entry) => searchable(entry).some((value) =>
    value.toLocaleLowerCase().includes(needle)));
};

export const selectOne = <Entry extends SelectableEntry>(
  entries: readonly Entry[],
  selection: string,
  label: string,
): Entry => {
  const needle = selection.trim().toLocaleLowerCase();
  if (needle.length === 0) {
    throw new MemorySelectionError(
      'memory_selector_absent',
      `Choose ${article(label)} ${label} by words from its text.`,
    );
  }
  const exactId = entries.filter((entry) =>
    entry.observation.observationId.toLocaleLowerCase() === needle);
  const matches = exactId.length === 1
    ? exactId
    : entries.filter((entry) => searchable(entry).some((value) =>
      value.toLocaleLowerCase().includes(needle)));
  if (matches.length === 0) {
    throw new MemorySelectionError(
      'memory_selector_absent',
      `No ${label} matches “${selection}”. Run forge memory ${label === 'recoverable memory' ? 'history' : 'find'} to see available choices.`,
    );
  }
  if (matches.length > 1) {
    throw new MemorySelectionError(
      'memory_selector_ambiguous',
      `${matches.length} ${label} entries match “${selection}”. Use a few more words to choose one without copying an internal ID.`,
    );
  }
  return matches[0] as Entry;
};

const searchable = (entry: SelectableEntry): readonly string[] => [
  entry.observation.statement,
  entry.observation.subject,
  entry.observation.observationId,
  entry.observation.claimId,
];

const article = (value: string): string => /^[aeiou]/iu.test(value) ? 'an' : 'a';

const sameScope = (
  left: MemoryObservation['scope'],
  right: MemoryObservation['scope'],
): boolean => {
  if (left.kind !== right.kind) return false;
  return left.kind === 'repository' && right.kind === 'repository'
    ? left.workspaceId === right.workspaceId && left.repositoryId === right.repositoryId
    : left.kind === 'developer' && right.kind === 'developer' && left.actorId === right.actorId;
};
