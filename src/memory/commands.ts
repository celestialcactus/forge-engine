import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type {
  MemoryCorrectionDisposition,
  MemoryInspection,
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
  readonly matches: readonly ProjectedMemory[];
}

export class MemoryCommands {
  readonly #runtime: MemoryRuntime;

  constructor(runtime: MemoryRuntime) {
    this.#runtime = runtime;
  }

  remember(statement: string): Promise<MemoryOperationResult> {
    const normalized = statement.trim();
    if (normalized.length === 0) throw new Error('Tell Forge what to remember.');
    return this.#runtime.remember(normalized);
  }

  async find(query = ''): Promise<MemoryFindResult> {
    const inspection = await this.#runtime.inspect(false);
    const matches = filterEntries(inspection.active, query);
    return { inspection, matches };
  }

  async show(selection: string): Promise<ProjectedMemory> {
    return selectOne((await this.#runtime.inspect(false)).active, selection, 'active memory');
  }

  explain(selection: string): Promise<ProjectedMemory> {
    return this.show(selection);
  }

  async correct(
    selection: string,
    replacement: string,
    disposition: MemoryCorrectionDisposition,
  ): Promise<MemoryOperationResult> {
    const target = await this.show(selection);
    const normalized = replacement.trim();
    if (normalized.length === 0) throw new Error('Supply the corrected memory text.');
    return this.#runtime.correct(
      target.observation.observationId,
      normalized,
      disposition,
    );
  }

  async history(query = ''): Promise<{
    readonly inspection: MemoryInspection;
    readonly matches: readonly RecoveryMemory[];
  }> {
    const inspection = await this.#runtime.inspect(true);
    return {
      inspection,
      matches: filterEntries(inspection.recovery ?? [], query),
    };
  }

  async restore(selection: string): Promise<MemoryOperationResult> {
    const history = await this.#runtime.inspect(true);
    const target = selectOne(history.recovery ?? [], selection, 'recoverable memory');
    return this.#runtime.restore(target.observation.observationId);
  }

  status(): Promise<MemoryInspection> {
    return this.#runtime.inspect(false);
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
