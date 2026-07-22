import { realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve } from 'node:path';
import type { WorkspaceFile, WorkspaceSnapshot } from '../slice0/contracts.js';

const portablePath = (path: string): string => path.replaceAll('\\', '/');

export const selectSnapshotFile = (inputPath: unknown, snapshot: WorkspaceSnapshot): WorkspaceFile => {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.length > 1_000) {
    throw new Error('path must be a non-empty workspace-relative string of at most 1000 characters.');
  }
  const portable = portablePath(inputPath);
  if (isAbsolute(inputPath) || /^[A-Za-z]:/u.test(portable)) throw new Error('path must be workspace-relative.');
  const normalized = posix.normalize(portable).replace(/^\.\//u, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('path traversal outside the workspace is not allowed.');
  }
  const file = snapshot.files.find((candidate) => candidate.path === normalized);
  if (file === undefined) throw new Error(`File is not present in the workspace snapshot: ${normalized}`);
  return file;
};

export async function canonicalSnapshotFilePath(workspaceRoot: string, file: WorkspaceFile): Promise<string> {
  const root = await realpath(resolve(workspaceRoot));
  const target = await realpath(resolve(root, file.path));
  const fromRoot = relative(root, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..\\`) || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
    throw new Error(`Resolved file escapes the workspace boundary: ${file.path}`);
  }
  return target;
}
