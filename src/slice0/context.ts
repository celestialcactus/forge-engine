import type { ContextItem, ContextPlan, WorkspaceSnapshot } from './contracts.js';

const taskItem = (task: string): ContextItem => ({
  id: 'task',
  kind: 'user.task',
  locator: 'run://task',
  bytes: Buffer.byteLength(task, 'utf8'),
  reason: 'The developer task is authoritative context.',
});

const fileItem = (path: string, bytes: number): ContextItem => ({
  id: `file:${path}`,
  kind: 'workspace.file',
  locator: `workspace://${path}`,
  bytes,
  reason: 'Deterministic workspace inventory selected this file.',
});

const comparePaths = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Slice 0 is intentionally a transparent selector, not a compressor. The
 * explicit code-unit comparator avoids host locale differences in golden traces.
 */
export function compileContext(task: string, snapshot: WorkspaceSnapshot, budgetBytes: number): ContextPlan {
  if (!Number.isInteger(budgetBytes) || budgetBytes < 1) throw new Error('Context budget must be a positive integer.');
  const candidates = [
    taskItem(task),
    ...[...snapshot.files].sort((left, right) => comparePaths(left.path, right.path)).map((file) => fileItem(file.path, file.bytes)),
  ];
  const selected: ContextItem[] = [];
  const omitted: ContextItem[] = [];
  let consumed = 0;
  for (const candidate of candidates) {
    if (consumed + candidate.bytes <= budgetBytes) {
      selected.push(candidate);
      consumed += candidate.bytes;
    } else {
      omitted.push(candidate);
    }
  }
  return { id: `context:${snapshot.id}`, budgetBytes, selected, omitted };
}

export const requiredContextBytes = (task: string, snapshot: WorkspaceSnapshot): number =>
  Buffer.byteLength(task, 'utf8') + snapshot.files.reduce((total, file) => total + file.bytes, 0);
