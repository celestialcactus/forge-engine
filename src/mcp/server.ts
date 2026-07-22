import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { ForgeWorkspaceService } from '../v1/service.js';
import {
  forgeMcpArtifactPayload,
  forgeMcpArtifactResult,
  forgeMcpEvidenceGuidance,
  forgeMcpOutputSchemas,
  forgeMcpReadReplayResult,
} from './presentation.js';

const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const toolError = (error: unknown) => ({
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

type ReadEvidence = {
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
};
type ReadCacheStamp = {
  readonly absolutePath: string;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
};
type ReadCacheEntry = {
  readonly payload: ReturnType<typeof forgeMcpArtifactPayload>;
  readonly evidence: ReadEvidence;
  readonly stamp: ReadCacheStamp;
};
export const forgeMcpReadCacheKey = (path: string): string =>
  path.replaceAll('\\', '/').replace(/^\.\//u, '');

const withinRoot = (root: string, target: string): boolean => {
  const fromRoot = relative(root, target);
  return fromRoot !== '..' && !fromRoot.startsWith('..\\') && !fromRoot.startsWith('../') && !isAbsolute(fromRoot);
};

const readCacheStamp = async (canonicalRoot: Promise<string>, path: string): Promise<ReadCacheStamp> => {
  const root = await canonicalRoot;
  const absolutePath = await realpath(resolve(root, path));
  if (!withinRoot(root, absolutePath)) throw new Error('Resolved file escapes the workspace boundary: ' + path);
  const fileStat = await stat(absolutePath, { bigint: true });
  if (!fileStat.isFile()) throw new Error('Cached workspace path is no longer a regular file: ' + path);
  return {
    absolutePath,
    size: fileStat.size,
    mtimeNs: fileStat.mtimeNs,
    ctimeNs: fileStat.ctimeNs,
  };
};

const readCacheEntryIsCurrent = async (entry: ReadCacheEntry): Promise<boolean> => {
  try {
    const current = await stat(entry.stamp.absolutePath, { bigint: true });
    return current.isFile()
      && current.size === entry.stamp.size
      && current.mtimeNs === entry.stamp.mtimeNs
      && current.ctimeNs === entry.stamp.ctimeNs;
  } catch {
    return false;
  }
};

class ForgeMcpServer extends McpServer {
  constructor(private readonly cleanup: () => void) {
    super({ name: 'forge-engine', version: '0.1.0' });
  }

  override async close(): Promise<void> {
    this.cleanup();
    await super.close();
  }
}

export function createForgeMcpServer(workspaceRoot: string): McpServer {
  const service = new ForgeWorkspaceService(workspaceRoot);
  const server = new ForgeMcpServer(() => service.close());
  const readCache = new Map<string, ReadCacheEntry>();
  const canonicalRoot = realpath(resolve(workspaceRoot));

  server.registerTool('forge_workspace_summary', {
    title: 'Forge Workspace Summary',
    description: `Return a compact bounded workspace inventory. Default 50 paths; maximum 100. If truncated, narrow with search or declarations instead of repeating the summary.${forgeMcpEvidenceGuidance}`,
    inputSchema: {
      maxFiles: z.number().int().min(1).max(100).optional()
        .describe('Number of paths to return. Prefer the default 50; do not request the maximum reflexively.'),
    },
    outputSchema: forgeMcpOutputSchemas.summary,
    annotations: readOnlyAnnotations,
  }, async ({ maxFiles }, extra) => {
    try { return forgeMcpArtifactResult(await service.inspect(maxFiles ?? 50, extra.signal), 'summary'); }
    catch (error) { return toolError(error); }
  });

  server.registerTool('forge_workspace_search', {
    title: 'Forge Workspace Search',
    description: `Perform a case-configurable literal substring search. Regex and operators are not interpreted. Matches already include complete paths and line numbers; follow with at most one smallest-useful bounded read.${forgeMcpEvidenceGuidance}`,
    inputSchema: {
      query: z.string().min(1).max(500)
        .describe('One exact literal substring. Do not use regex syntax, alternation, or multiple unrelated terms.'),
      maxMatches: z.number().int().min(1).max(100).optional()
        .describe('Maximum matches; default 20.'),
      caseSensitive: z.boolean().optional(),
    },
    outputSchema: forgeMcpOutputSchemas.search,
    annotations: readOnlyAnnotations,
  }, async ({ query, maxMatches, caseSensitive }, extra) => {
    try {
      return forgeMcpArtifactResult(await service.search(query, {
        maxMatches: maxMatches ?? 20,
        caseSensitive: caseSensitive ?? false,
      }, extra.signal), 'search');
    } catch (error) { return toolError(error); }
  });

  server.registerTool('forge_workspace_read', {
    title: 'Forge Read Workspace File',
    description: `Read one smallest-useful bounded line range from a snapshotted workspace file. The result is already citation-ready and line-numbered; do not search again for line numbers or split a successful range into overlapping reads. Covered repeats replay the requested evidence from memory under the original Forge run ID; they do not reread the filesystem or create a run. Default 120 lines; maximum 200.${forgeMcpEvidenceGuidance}`,
    inputSchema: {
      path: z.string().min(1).max(1_000)
        .describe('Complete workspace-relative path from Forge evidence.'),
      startLine: z.number().int().min(1).max(1_000_000).optional(),
      maxLines: z.number().int().min(1).max(200).optional()
        .describe('Smallest useful line count; default 120 and maximum 200.'),
    },
    outputSchema: forgeMcpOutputSchemas.read,
    annotations: readOnlyAnnotations,
  }, async ({ path, startLine, maxLines }, extra) => {
    try {
      const requestedStartLine = startLine ?? 1;
      const requestedMaxLines = maxLines ?? 120;
      const requestedEndLine = requestedStartLine + requestedMaxLines - 1;
      const cacheKey = forgeMcpReadCacheKey(path);
      const cached = readCache.get(cacheKey);
      const covered = cached !== undefined
        && requestedStartLine >= cached.evidence.startLine
        && (requestedEndLine <= cached.evidence.endLine
          || cached.evidence.endLine >= cached.evidence.totalLines);
      if (cached !== undefined && covered) {
        if (await readCacheEntryIsCurrent(cached)) {
          return forgeMcpReadReplayResult(cached.payload, {
            path,
            requestedStartLine,
            requestedEndLine,
            coveredStartLine: cached.evidence.startLine,
            coveredEndLine: cached.evidence.endLine,
          });
        }
        readCache.delete(cacheKey);
      }

      const artifact = await service.read(path, {
        startLine: requestedStartLine,
        maxLines: requestedMaxLines,
      }, extra.signal);
      const payload = forgeMcpArtifactPayload(artifact, 'read');
      const evidence = payload.evidence as Partial<ReadEvidence> | undefined;
      if (artifact.capabilityResults.at(-1)?.success !== false
        && typeof evidence?.startLine === 'number'
        && typeof evidence.endLine === 'number'
        && typeof evidence.totalLines === 'number'
      ) {
        if (!readCache.has(cacheKey) && readCache.size >= 32) {
          const oldestKey = readCache.keys().next().value;
          if (oldestKey !== undefined) readCache.delete(oldestKey);
        }
        try {
          const evidencePath = typeof (payload.evidence as { readonly path?: unknown } | undefined)?.path === 'string'
            ? (payload.evidence as { readonly path: string }).path
            : path;
          readCache.set(forgeMcpReadCacheKey(evidencePath), {
            payload,
            evidence: evidence as ReadEvidence,
            stamp: await readCacheStamp(canonicalRoot, evidencePath),
          });
        } catch {
          readCache.delete(cacheKey);
        }
      }
      return forgeMcpArtifactResult(artifact, 'read');
    } catch (error) { return toolError(error); }
  });

  server.registerTool('forge_workspace_symbols', {
    title: 'Forge Workspace Declarations',
    description: `Extract bounded TypeScript/JavaScript declarations by case-insensitive name substring. Use one identifier fragment such as Runtime, not multiple keywords or regex syntax.${forgeMcpEvidenceGuidance}`,
    inputSchema: {
      query: z.string().max(500).optional()
        .describe('One declaration-name substring. Omit to list bounded declarations.'),
      maxFiles: z.number().int().min(1).max(500).optional()
        .describe('Maximum source files scanned; default 100.'),
      maxSymbols: z.number().int().min(1).max(500).optional()
        .describe('Maximum declarations returned; default 200.'),
    },
    outputSchema: forgeMcpOutputSchemas.symbols,
    annotations: readOnlyAnnotations,
  }, async ({ query, maxFiles, maxSymbols }, extra) => {
    try {
      return forgeMcpArtifactResult(await service.symbols({
        ...(query === undefined ? {} : { query }),
        maxFiles: maxFiles ?? 100,
        maxSymbols: maxSymbols ?? 200,
      }, extra.signal), 'symbols');
    } catch (error) { return toolError(error); }
  });

  server.registerTool('forge_typescript_diagnostics', {
    title: 'Forge TypeScript Diagnostics',
    description: `Run bounded no-emit TypeScript diagnostics. Prefer an explicit configPath; for a V1 task use tsconfig.v1.json when that path is present.${forgeMcpEvidenceGuidance}`,
    inputSchema: {
      configPath: z.string().min(1).max(1_000).optional()
        .describe('Exact workspace-relative TypeScript config path.'),
      maxDiagnostics: z.number().int().min(1).max(200).optional()
        .describe('Maximum diagnostics returned; default 50.'),
    },
    outputSchema: forgeMcpOutputSchemas.diagnostics,
    annotations: readOnlyAnnotations,
  }, async ({ configPath, maxDiagnostics }, extra) => {
    try {
      return forgeMcpArtifactResult(await service.diagnostics({
        ...(configPath === undefined ? {} : { configPath }),
        maxDiagnostics: maxDiagnostics ?? 50,
      }, extra.signal), 'diagnostics');
    } catch (error) { return toolError(error); }
  });

  server.registerTool('forge_git_status', {
    title: 'Forge Git Status',
    description: `Inspect bounded Git branch and worktree status without optional locks or repository mutation.${forgeMcpEvidenceGuidance}`,
    outputSchema: forgeMcpOutputSchemas.gitStatus,
    annotations: readOnlyAnnotations,
  }, async (extra) => {
    try { return forgeMcpArtifactResult(await service.gitStatus(extra.signal), 'gitStatus'); }
    catch (error) { return toolError(error); }
  });

  server.registerTool('forge_git_diff', {
    title: 'Forge Git Diff',
    description: `Inspect a bounded staged or unstaged Git diff with external diff and text conversion disabled. Request the smallest useful byte bound.${forgeMcpEvidenceGuidance}`,
    inputSchema: {
      staged: z.boolean().optional(),
      maxBytes: z.number().int().min(1_000).max(100_000).optional()
        .describe('Maximum returned diff bytes; default 20,000 and maximum 100,000.'),
    },
    outputSchema: forgeMcpOutputSchemas.gitDiff,
    annotations: readOnlyAnnotations,
  }, async ({ staged, maxBytes }, extra) => {
    try {
      return forgeMcpArtifactResult(await service.gitDiff({
        staged: staged ?? false,
        maxBytes: maxBytes ?? 20_000,
      }, extra.signal), 'gitDiff');
    } catch (error) { return toolError(error); }
  });

  return server;
}

export async function startForgeMcpServer(workspaceRoot: string): Promise<void> {
  const server = createForgeMcpServer(workspaceRoot);
  const transport = new StdioServerTransport();
  process.once('SIGINT', () => {
    void server.close().finally(() => process.exit(0));
  });
  await server.connect(transport);
}
