import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Capability, CapabilityCall, CapabilityResult } from '../slice0/contracts.js';

const execFileAsync = promisify(execFile);

const objectInput = (call: CapabilityCall): Readonly<Record<string, unknown>> => {
  if (call.input === undefined || call.input === null) return {};
  if (typeof call.input !== 'object' || Array.isArray(call.input)) throw new Error(`${call.capabilityId} input must be an object.`);
  return call.input as Readonly<Record<string, unknown>>;
};

async function runGit(workspaceRoot: string, args: readonly string[], signal: AbortSignal, maxBuffer = 1_048_576): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      maxBuffer,
      signal,
      timeout: 15_000,
      windowsHide: true,
    },
  );
  return stdout;
}

async function requireWorkspaceGitRoot(workspaceRoot: string, signal: AbortSignal): Promise<string> {
  const root = await realpath(resolve(workspaceRoot));
  const reported = (await runGit(root, ['rev-parse', '--show-toplevel'], signal, 16_384)).trim();
  const gitRoot = await realpath(resolve(reported));
  if (gitRoot.toLocaleLowerCase('en-US') !== root.toLocaleLowerCase('en-US')) {
    throw new Error('Git evidence is limited to a workspace opened at the repository root.');
  }
  return root;
}

export function createGitStatusCapability(workspaceRoot: string): Capability {
  return {
    id: 'git.status',
    async invoke(call, snapshot, signal): Promise<CapabilityResult> {
      objectInput(call);
      const root = await requireWorkspaceGitRoot(workspaceRoot, signal);
      const output = await runGit(root, ['status', '--short', '--branch', '--untracked-files=normal'], signal);
      const lines = output.split(/\r?\n/u).filter((line) => line.length > 0);
      const branch = lines[0]?.startsWith('## ') === true ? lines[0].slice(3) : null;
      const changes = branch === null ? lines : lines.slice(1);
      return {
        callId: call.id,
        success: true,
        content: JSON.stringify({
          snapshotId: snapshot.id,
          branch,
          clean: changes.length === 0,
          changeCount: changes.length,
          changes: changes.slice(0, 500),
          truncated: changes.length > 500,
        }),
      };
    },
  };
}

export function createGitDiffCapability(workspaceRoot: string): Capability {
  return {
    id: 'git.diff',
    async invoke(call, snapshot, signal): Promise<CapabilityResult> {
      const input = objectInput(call);
      const staged = input.staged === true;
      const rawMaximum = input.maxBytes ?? 100_000;
      if (!Number.isInteger(rawMaximum) || Number(rawMaximum) < 1_000 || Number(rawMaximum) > 500_000) {
        throw new Error('maxBytes must be an integer from 1000 to 500000.');
      }
      const maxBytes = Number(rawMaximum);
      const root = await requireWorkspaceGitRoot(workspaceRoot, signal);
      const args = ['diff', '--no-ext-diff', '--no-textconv'];
      if (staged) args.push('--cached');
      args.push('--');
      const output = await runGit(root, args, signal, 1_048_576);
      const encoded = Buffer.from(output, 'utf8');
      const truncated = encoded.byteLength > maxBytes;
      const diff = truncated ? encoded.subarray(0, maxBytes).toString('utf8') : output;
      return {
        callId: call.id,
        success: true,
        content: JSON.stringify({ snapshotId: snapshot.id, staged, bytes: encoded.byteLength, diff, truncated }),
      };
    },
  };
}
