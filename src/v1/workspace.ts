import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import type { Capability, CapabilityCall, CapabilityResult, WorkspaceFile, WorkspaceSnapshot } from '../slice0/contracts.js';
import { canonicalSnapshotFilePath } from './workspace-path.js';
import { isIgnoredWorkspaceDirectory } from './workspace-ignore.js';
const comparePaths = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const portablePath = (path: string): string => path.replaceAll('\\', '/');

export interface WorkspaceSnapshotOptions {
  readonly maxFiles?: number;
}

export async function createWorkspaceSnapshot(
  workspaceRoot: string,
  options: WorkspaceSnapshotOptions = {},
): Promise<WorkspaceSnapshot> {
  const root = await realpath(resolve(workspaceRoot));
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`Workspace root is not a directory: ${workspaceRoot}`);

  const maxFiles = options.maxFiles ?? 10_000;
  const files: WorkspaceFile[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.shift();
    if (directory === undefined) break;
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredWorkspaceDirectory(entry.name)) pending.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maxFiles) {
        throw new Error(`Workspace contains more than the Slice 1 limit of ${maxFiles} files.`);
      }
      const fileStat = await stat(absolute);
      files.push({ path: portablePath(relative(root, absolute)), bytes: fileStat.size });
    }
    pending.sort(comparePaths);
  }

  files.sort((left, right) => comparePaths(left.path, right.path));
  const digest = createHash('sha256');
  for (const file of files) digest.update(`${file.path}\0${file.bytes}\n`);
  return {
    id: `workspace:${digest.digest('hex').slice(0, 16)}`,
    rootLabel: basename(root),
    files,
  };
}

const objectInput = (call: CapabilityCall): Readonly<Record<string, unknown>> => {
  if (call.input === undefined || call.input === null) return {};
  if (typeof call.input !== 'object' || Array.isArray(call.input)) throw new Error(`${call.capabilityId} input must be an object.`);
  return call.input as Readonly<Record<string, unknown>>;
};

const boundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number, name: string): number => {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || Number(selected) < minimum || Number(selected) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(selected);
};

export const workspaceInventoryCapability: Capability = {
  id: 'workspace.inventory',
  async invoke(call, snapshot, signal): Promise<CapabilityResult> {
    signal.throwIfAborted();
    const input = objectInput(call);
    const maxFiles = boundedInteger(input.maxFiles, 200, 1, 500, 'maxFiles');
    return {
      callId: call.id,
      success: true,
      content: JSON.stringify({
        snapshotId: snapshot.id,
        rootLabel: snapshot.rootLabel,
        totalFiles: snapshot.files.length,
        files: snapshot.files.slice(0, maxFiles),
        truncated: snapshot.files.length > maxFiles,
      }),
    };
  },
};

export function createWorkspaceSearchCapability(workspaceRoot: string): Capability {
  return {
    id: 'workspace.search',
    async invoke(call, snapshot, signal): Promise<CapabilityResult> {
      const input = objectInput(call);
      if (typeof input.query !== 'string' || input.query.length === 0 || input.query.length > 500) {
        throw new Error('query must be a non-empty string of at most 500 characters.');
      }
      const maxMatches = boundedInteger(input.maxMatches, 50, 1, 200, 'maxMatches');
      const caseSensitive = input.caseSensitive === true;
      const needle = caseSensitive ? input.query : input.query.toLocaleLowerCase('en-US');
      const matches: Array<{ readonly path: string; readonly line: number; readonly preview: string }> = [];
      let skippedLargeOrBinary = 0;

      for (const file of snapshot.files) {
        signal.throwIfAborted();
        if (file.bytes > 1_048_576) {
          skippedLargeOrBinary++;
          continue;
        }
        const absolute = await canonicalSnapshotFilePath(workspaceRoot, file);
        const content = await readFile(absolute);
        if (content.includes(0) || !isUtf8(content)) {
          skippedLargeOrBinary++;
          continue;
        }
        const lines = content.toString('utf8').split(/\r?\n/u);
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index] ?? '';
          const comparable = caseSensitive ? line : line.toLocaleLowerCase('en-US');
          if (!comparable.includes(needle)) continue;
          matches.push({ path: file.path, line: index + 1, preview: line.slice(0, 300) });
          if (matches.length >= maxMatches) break;
        }
        if (matches.length >= maxMatches) break;
      }

      return {
        callId: call.id,
        success: true,
        content: JSON.stringify({
          snapshotId: snapshot.id,
          query: input.query,
          caseSensitive,
          matches,
          truncated: matches.length >= maxMatches,
          skippedLargeOrBinary,
        }),
      };
    },
  };
}
