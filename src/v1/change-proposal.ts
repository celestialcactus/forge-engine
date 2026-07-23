import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import type { Capability, CapabilityCall, CapabilityResult, WorkspaceSnapshot } from '../slice0/contracts.js';
import { canonicalSnapshotFilePath, selectSnapshotFile } from './workspace-path.js';

const maximumTextBytes = 1_048_576;
const maximumChanges = 20;
const digestPattern = /^[0-9a-f]{64}$/u;

export interface TextChangeRequest {
  readonly path: string;
  readonly expectedSha256: string;
  readonly replacementText: string;
}

export interface ChangeProposalOptions {
  readonly maxDiffBytes?: number;
}

export interface ProposedTextChange {
  readonly path: string;
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly diff: string;
  readonly diffBytes: number;
  readonly truncated: boolean;
}

export interface ChangeConflict {
  readonly path: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly reason: 'base_digest_mismatch';
}

export interface ChangeProposalArtifact {
  readonly schemaVersion: 1;
  readonly proposalId: string;
  readonly snapshotId: string;
  readonly status: 'ready' | 'conflicted' | 'no_changes';
  readonly mutatesWorkspace: false;
  readonly approvalRequiredBeforeApply: true;
  readonly changes: readonly ProposedTextChange[];
  readonly conflicts: readonly ChangeConflict[];
}

type PreparedChange = {
  readonly path: string;
  readonly expectedSha256: string;
  readonly replacementText: string;
  readonly before: Buffer;
  readonly beforeSha256: string;
  readonly after: Buffer;
  readonly afterSha256: string;
};

const objectInput = (call: CapabilityCall): Readonly<Record<string, unknown>> => {
  if (call.input === undefined || call.input === null || typeof call.input !== 'object' || Array.isArray(call.input)) {
    throw new Error('workspace.change.propose input must be an object.');
  }
  return call.input as Readonly<Record<string, unknown>>;
};

const sha256 = (content: Uint8Array): string => createHash('sha256').update(content).digest('hex');

const boundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number, name: string): number => {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || Number(selected) < minimum || Number(selected) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(selected);
};

const parseRequests = (input: Readonly<Record<string, unknown>>): readonly TextChangeRequest[] => {
  if (!Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > maximumChanges) {
    throw new Error(`changes must contain from 1 to ${maximumChanges} text replacements.`);
  }
  const seen = new Set<string>();
  return input.changes.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`changes[${index}] must be an object.`);
    }
    const change = candidate as Readonly<Record<string, unknown>>;
    if (typeof change.path !== 'string') throw new Error(`changes[${index}].path must be a string.`);
    if (seen.has(change.path)) throw new Error(`Duplicate change target: ${change.path}`);
    seen.add(change.path);
    if (typeof change.expectedSha256 !== 'string' || !digestPattern.test(change.expectedSha256)) {
      throw new Error(`changes[${index}].expectedSha256 must be a lowercase SHA-256 digest.`);
    }
    if (typeof change.replacementText !== 'string') {
      throw new Error(`changes[${index}].replacementText must be a string.`);
    }
    const replacementBytes = Buffer.byteLength(change.replacementText, 'utf8');
    if (replacementBytes > maximumTextBytes) {
      throw new Error(`changes[${index}].replacementText exceeds the 1 MiB proposal limit.`);
    }
    if (change.replacementText.includes('\0')) {
      throw new Error(`changes[${index}].replacementText must not contain NUL bytes.`);
    }
    return {
      path: change.path,
      expectedSha256: change.expectedSha256,
      replacementText: change.replacementText,
    };
  });
};

const lines = (text: string): readonly string[] => text.replaceAll('\r\n', '\n').split('\n');

const unifiedDiff = (path: string, beforeText: string, afterText: string): string => {
  const before = lines(beforeText);
  const after = lines(afterText);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix++;

  if (prefix === before.length && prefix === after.length) return '';

  const context = 3;
  const beforeStart = Math.max(0, prefix - context);
  const afterStart = Math.max(0, prefix - context);
  const beforeChangedEnd = before.length - suffix;
  const afterChangedEnd = after.length - suffix;
  const beforeEnd = Math.min(before.length, beforeChangedEnd + context);
  const afterEnd = Math.min(after.length, afterChangedEnd + context);
  const beforeCount = beforeEnd - beforeStart;
  const afterCount = afterEnd - afterStart;
  const body: string[] = [];

  for (const line of before.slice(beforeStart, prefix)) body.push(` ${line}`);
  for (const line of before.slice(prefix, beforeChangedEnd)) body.push(`-${line}`);
  for (const line of after.slice(prefix, afterChangedEnd)) body.push(`+${line}`);
  for (const line of after.slice(afterChangedEnd, afterEnd)) body.push(` ${line}`);

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${beforeStart + 1},${beforeCount} +${afterStart + 1},${afterCount} @@`,
    ...body,
    '',
  ].join('\n');
};

const truncateUtf8 = (value: string, maximumBytes: number): { readonly value: string; readonly truncated: boolean } => {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.byteLength <= maximumBytes) return { value, truncated: false };
  let end = maximumBytes;
  while (end > 0 && (encoded[end] ?? 0) >> 6 === 0b10) end--;
  return { value: encoded.subarray(0, end).toString('utf8'), truncated: true };
};

const prepareChanges = async (
  workspaceRoot: string,
  snapshot: WorkspaceSnapshot,
  requests: readonly TextChangeRequest[],
  signal: AbortSignal,
): Promise<readonly PreparedChange[]> => {
  const prepared: PreparedChange[] = [];
  const canonicalPaths = new Set<string>();
  for (const request of requests) {
    signal.throwIfAborted();
    const file = selectSnapshotFile(request.path, snapshot);
    if (canonicalPaths.has(file.path)) throw new Error(`Duplicate canonical change target: ${file.path}`);
    canonicalPaths.add(file.path);
    if (file.bytes > maximumTextBytes) throw new Error(`Proposal target exceeds 1 MiB: ${file.path}`);
    const absolute = await canonicalSnapshotFilePath(workspaceRoot, file);
    const before = await readFile(absolute);
    if (before.includes(0) || !isUtf8(before)) throw new Error(`Proposal target must be UTF-8 text: ${file.path}`);
    const after = Buffer.from(request.replacementText, 'utf8');
    prepared.push({
      path: file.path,
      expectedSha256: request.expectedSha256,
      replacementText: request.replacementText,
      before,
      beforeSha256: sha256(before),
      after,
      afterSha256: sha256(after),
    });
  }
  return prepared.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
};

const proposalId = (
  snapshotId: string,
  status: ChangeProposalArtifact['status'],
  changes: readonly ProposedTextChange[],
  conflicts: readonly ChangeConflict[],
): string => {
  const changeIdentity = changes.map((change) => ({
    path: change.path,
    beforeSha256: change.beforeSha256,
    afterSha256: change.afterSha256,
  }));
  const digest = createHash('sha256')
    .update(JSON.stringify({ snapshotId, status, changes: changeIdentity, conflicts }))
    .digest('hex')
    .slice(0, 20);
  return `change:${digest}`;
};

export function createChangeProposalCapability(workspaceRoot: string): Capability {
  return {
    id: 'workspace.change.propose',
    async invoke(call, snapshot, signal): Promise<CapabilityResult> {
      const input = objectInput(call);
      const requests = parseRequests(input);
      const maxDiffBytes = boundedInteger(input.maxDiffBytes, 100_000, 1_000, 500_000, 'maxDiffBytes');
      const prepared = await prepareChanges(workspaceRoot, snapshot, requests, signal);
      const conflicts = prepared
        .filter((change) => change.beforeSha256 !== change.expectedSha256)
        .map((change): ChangeConflict => ({
          path: change.path,
          expectedSha256: change.expectedSha256,
          actualSha256: change.beforeSha256,
          reason: 'base_digest_mismatch',
        }));

      let status: ChangeProposalArtifact['status'];
      let changes: readonly ProposedTextChange[];
      if (conflicts.length > 0) {
        status = 'conflicted';
        changes = [];
      } else {
        let remainingDiffBytes = maxDiffBytes;
        changes = prepared.flatMap((change): readonly ProposedTextChange[] => {
          if (change.beforeSha256 === change.afterSha256) return [];
          const completeDiff = unifiedDiff(
            change.path,
            change.before.toString('utf8'),
            change.replacementText,
          );
          const bounded = truncateUtf8(completeDiff, remainingDiffBytes);
          remainingDiffBytes -= Buffer.byteLength(bounded.value, 'utf8');
          return [{
            path: change.path,
            beforeSha256: change.beforeSha256,
            afterSha256: change.afterSha256,
            beforeBytes: change.before.byteLength,
            afterBytes: change.after.byteLength,
            diff: bounded.value,
            diffBytes: Buffer.byteLength(completeDiff, 'utf8'),
            truncated: bounded.truncated,
          }];
        });
        status = changes.length === 0 ? 'no_changes' : 'ready';
      }

      const artifact: ChangeProposalArtifact = {
        schemaVersion: 1,
        proposalId: proposalId(snapshot.id, status, changes, conflicts),
        snapshotId: snapshot.id,
        status,
        mutatesWorkspace: false,
        approvalRequiredBeforeApply: true,
        changes,
        conflicts,
      };
      return { callId: call.id, success: status !== 'conflicted', content: JSON.stringify(artifact) };
    },
  };
}
