import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import type { RunArtifact } from '../slice0/contracts.js';
import { artifactPayload } from '../v1/service.js';

export type ForgeMcpToolKind = 'summary' | 'search' | 'read' | 'symbols' | 'diagnostics' | 'gitStatus' | 'gitDiff';

export const forgeMcpEvidenceGuidance =
  ' Use the returned evidence directly; do not repeat an equivalent call to recover fields. Preserve its Forge run ID and complete workspace-relative paths.';

const lineSchema = z.object({ line: z.number().int(), text: z.string() });
const matchSchema = z.object({ path: z.string(), line: z.number().int(), preview: z.string() });
const symbolSchema = z.object({
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  line: z.number().int(),
  column: z.number().int(),
});
const diagnosticSchema = z.object({
  code: z.number().int(),
  category: z.string(),
  message: z.string(),
  path: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
});
const evidenceOrError = (schema: z.ZodType) => z.union([schema, z.string()]);
const artifactOutputSchema = (evidence: z.ZodType) => z.object({
  invocationId: z.string().describe('Unique identifier for this MCP tool invocation, including cache replays.'),
  runId: z.string().describe('Stable Forge run identifier. Preserve this in the final answer.'),
  snapshotId: z.string().describe('Stable workspace snapshot identifier for this Forge run.'),
  capability: z.object({ success: z.boolean() }).nullable(),
  evidence: evidence.optional(),
  workspace: z.object({ id: z.string(), rootLabel: z.string() }),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'budget_exhausted']),
  events: z.array(z.object({ sequence: z.number().int(), type: z.string() })),
  cache: z.object({
    hit: z.literal(true),
    sourceRunId: z.string(),
    path: z.string(),
    requestedStartLine: z.number().int(),
    requestedEndLine: z.number().int(),
    coveredStartLine: z.number().int(),
    coveredEndLine: z.number().int(),
  }).optional(),
});

export const forgeMcpOutputSchemas = {
  summary: artifactOutputSchema(evidenceOrError(z.object({
    totalFiles: z.number().int(),
    files: z.array(z.string()).describe('Complete workspace-relative paths returned by this bounded inventory.'),
    truncated: z.boolean(),
  }))),
  search: artifactOutputSchema(evidenceOrError(z.object({
    query: z.string(),
    caseSensitive: z.boolean(),
    matches: z.array(matchSchema),
    truncated: z.boolean(),
    skippedLargeOrBinary: z.number().int(),
  }))),
  read: artifactOutputSchema(evidenceOrError(z.object({
    path: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    lines: z.array(lineSchema).describe('Citation-ready line-numbered file evidence.'),
    startLine: z.number().int(),
    endLine: z.number().int(),
    totalLines: z.number().int(),
    truncated: z.boolean(),
  }))),
  symbols: artifactOutputSchema(evidenceOrError(z.object({
    query: z.string().nullable(),
    filesScanned: z.number().int(),
    candidateFiles: z.number().int(),
    symbols: z.array(symbolSchema),
    truncated: z.boolean(),
  }))),
  diagnostics: artifactOutputSchema(evidenceOrError(z.object({
    configPath: z.string(),
    projectFiles: z.number().int(),
    excludedExternalRoots: z.number().int(),
    diagnosticCount: z.number().int(),
    diagnostics: z.array(diagnosticSchema),
    truncated: z.boolean(),
    emitted: z.boolean(),
  }))),
  gitStatus: artifactOutputSchema(evidenceOrError(z.object({
    branch: z.string().nullable(),
    clean: z.boolean(),
    changeCount: z.number().int(),
    changes: z.array(z.string()),
    truncated: z.boolean(),
  }))),
  gitDiff: artifactOutputSchema(evidenceOrError(z.object({
    staged: z.boolean(),
    bytes: z.number().int(),
    diff: z.string(),
    truncated: z.boolean(),
  }))),
} as const;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;

const projectedEvidence = (kind: ForgeMcpToolKind, value: unknown): unknown => {
  const evidence = asRecord(value);
  if (evidence === undefined) return value;

  if (kind === 'summary') {
    const files = Array.isArray(evidence.files)
      ? evidence.files.flatMap((file) => {
        const record = asRecord(file);
        return typeof record?.path === 'string' ? [record.path] : [];
      })
      : [];
    return { totalFiles: evidence.totalFiles, files, truncated: evidence.truncated };
  }

  if (kind === 'read') {
    return {
      path: evidence.path,
      sha256: evidence.sha256,
      lines: evidence.lines,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      totalLines: evidence.totalLines,
      truncated: evidence.truncated,
    };
  }

  if (kind === 'search') {
    return {
      query: evidence.query,
      caseSensitive: evidence.caseSensitive,
      matches: evidence.matches,
      truncated: evidence.truncated,
      skippedLargeOrBinary: evidence.skippedLargeOrBinary,
    };
  }

  if (kind === 'symbols') {
    return {
      query: evidence.query,
      filesScanned: evidence.filesScanned,
      candidateFiles: evidence.candidateFiles,
      symbols: evidence.symbols,
      truncated: evidence.truncated,
    };
  }

  if (kind === 'diagnostics') {
    return {
      configPath: evidence.configPath,
      projectFiles: evidence.projectFiles,
      excludedExternalRoots: evidence.excludedExternalRoots,
      diagnosticCount: evidence.diagnosticCount,
      diagnostics: evidence.diagnostics,
      truncated: evidence.truncated,
      emitted: evidence.emitted,
    };
  }

  if (kind === 'gitStatus') {
    return {
      branch: evidence.branch,
      clean: evidence.clean,
      changeCount: evidence.changeCount,
      changes: evidence.changes,
      truncated: evidence.truncated,
    };
  }

  return {
    staged: evidence.staged,
    bytes: evidence.bytes,
    diff: evidence.diff,
    truncated: evidence.truncated,
  };
};

const boolText = (value: unknown): string => value === true ? 'true' : 'false';
const newInvocationId = (): string => `mcp:${randomUUID()}`;
const arrayValue = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

const evidenceText = (kind: ForgeMcpToolKind, value: unknown): readonly string[] => {
  if (typeof value === 'string') return [`Error: ${value}`];
  const evidence = asRecord(value);
  if (evidence === undefined) return ['Evidence: unavailable'];

  if (kind === 'summary') {
    return [
      `Files: total=${String(evidence.totalFiles)}, returned=${arrayValue(evidence.files).length}, truncated=${boolText(evidence.truncated)}`,
      'Paths:',
      ...arrayValue(evidence.files).map(String),
    ];
  }

  if (kind === 'read') {
    return [
      `File: ${String(evidence.path)}`,
      `SHA-256: ${String(evidence.sha256)}`,
      `Range: ${String(evidence.startLine)}-${String(evidence.endLine)} of ${String(evidence.totalLines)}; truncated=${boolText(evidence.truncated)}`,
      'Line evidence:',
      ...arrayValue(evidence.lines).map((line) => {
        const record = asRecord(line);
        return `${String(record?.line)} | ${String(record?.text ?? '')}`;
      }),
    ];
  }

  if (kind === 'search') {
    return [
      `Literal query: ${String(evidence.query)}; matches=${arrayValue(evidence.matches).length}; truncated=${boolText(evidence.truncated)}`,
      ...arrayValue(evidence.matches).map((match) => {
        const record = asRecord(match);
        return `${String(record?.path)}:${String(record?.line)} | ${String(record?.preview ?? '')}`;
      }),
    ];
  }

  if (kind === 'symbols') {
    return [
      `Declaration query: ${String(evidence.query)}; filesScanned=${String(evidence.filesScanned)}; truncated=${boolText(evidence.truncated)}`,
      ...arrayValue(evidence.symbols).map((symbol) => {
        const record = asRecord(symbol);
        return `${String(record?.path)}:${String(record?.line)}:${String(record?.column)} | ${String(record?.kind)} ${String(record?.name)}`;
      }),
    ];
  }

  if (kind === 'diagnostics') {
    return [
      `Config: ${String(evidence.configPath)}; projectFiles=${String(evidence.projectFiles)}; diagnostics=${String(evidence.diagnosticCount)}; emitted=${boolText(evidence.emitted)}; truncated=${boolText(evidence.truncated)}`,
      ...arrayValue(evidence.diagnostics).map((diagnostic) => {
        const record = asRecord(diagnostic);
        const location = typeof record?.path === 'string'
          ? `${record.path}:${String(record.line)}:${String(record.column)} | `
          : '';
        return `${location}${String(record?.category)} TS${String(record?.code)}: ${String(record?.message)}`;
      }),
    ];
  }

  if (kind === 'gitStatus') {
    return [
      `Branch: ${String(evidence.branch)}; clean=${boolText(evidence.clean)}; changes=${String(evidence.changeCount)}; truncated=${boolText(evidence.truncated)}`,
      ...arrayValue(evidence.changes).map(String),
    ];
  }

  return [
    `Diff: staged=${boolText(evidence.staged)}; bytes=${String(evidence.bytes)}; truncated=${boolText(evidence.truncated)}`,
    String(evidence.diff ?? ''),
  ];
};

export const forgeMcpArtifactPayload = (artifact: RunArtifact, kind: ForgeMcpToolKind) => {
  const payload = artifactPayload(artifact);
  const capability = asRecord(payload.capability);
  const workspace = asRecord(payload.workspace);
  const started = artifact.events.find((event) => event.type === 'run.started');
  return {
    runId: payload.runId,
    snapshotId: started?.snapshotId ?? '',
    capability: payload.capability === null ? null : { success: capability?.success === true },
    evidence: projectedEvidence(kind, payload.evidence),
    workspace: { id: workspace?.id, rootLabel: workspace?.rootLabel },
    status: payload.status,
    events: artifact.events.map((event) => ({ sequence: event.sequence, type: event.type })),
  };
};

export const forgeMcpArtifactResult = (artifact: RunArtifact, kind: ForgeMcpToolKind) => {
  const payload = { invocationId: newInvocationId(), ...forgeMcpArtifactPayload(artifact, kind) };
  const failed = artifact.capabilityResults.at(-1)?.success === false;
  const content = [
    `Forge run ID: ${String(payload.runId)}`,
    `Forge invocation ID: ${payload.invocationId}`,
    `Snapshot ID: ${String(payload.snapshotId)}`,
    `Capability success: ${boolText(payload.capability?.success)}`,
    `Workspace: ${String(payload.workspace.rootLabel)} (${String(payload.workspace.id)})`,
    ...evidenceText(kind, payload.evidence),
  ].join('\n');
  const base = { content: [{ type: 'text' as const, text: content }], structuredContent: payload };
  return failed ? { ...base, isError: true } : base;
};

export const forgeMcpReadReplayResult = (
  payload: ReturnType<typeof forgeMcpArtifactPayload>,
  request: {
    readonly path: string;
    readonly requestedStartLine: number;
    readonly requestedEndLine: number;
    readonly coveredStartLine: number;
    readonly coveredEndLine: number;
  },
) => {
  const cachedEvidence = asRecord(payload.evidence);
  const requestedLines = arrayValue(cachedEvidence?.lines).filter((line) => {
    const record = asRecord(line);
    return typeof record?.line === 'number'
      && record.line >= request.requestedStartLine
      && record.line <= request.requestedEndLine;
  });
  const lastLine = asRecord(requestedLines.at(-1))?.line;
  const totalLines = typeof cachedEvidence?.totalLines === 'number' ? cachedEvidence.totalLines : 0;
  const replayEvidence = {
    path: typeof cachedEvidence?.path === 'string' ? cachedEvidence.path : request.path,
    sha256: cachedEvidence?.sha256,
    lines: requestedLines,
    startLine: request.requestedStartLine,
    endLine: typeof lastLine === 'number' ? lastLine : request.requestedStartLine - 1,
    totalLines,
    truncated: typeof lastLine === 'number' ? lastLine < totalLines : request.requestedStartLine <= totalLines,
  };
  const invocationId = newInvocationId();
  return {
    content: [{
      type: 'text' as const,
      text: [
        `Forge invocation ID: ${invocationId}`,
        `Forge cache hit: ${request.path}:${request.requestedStartLine}-${request.requestedEndLine} is covered by run ${String(payload.runId)} at lines ${request.coveredStartLine}-${request.coveredEndLine}.`,
        'No filesystem read or new Forge run occurred. The requested line evidence is replayed below; do not call this read again.',
        ...evidenceText('read', replayEvidence),
      ].join('\n'),
    }],
    structuredContent: {
      invocationId,
      ...payload,
      evidence: replayEvidence,
      cache: {
        hit: true as const, sourceRunId: payload.runId, path: request.path,
        requestedStartLine: request.requestedStartLine,
        requestedEndLine: request.requestedEndLine,
        coveredStartLine: request.coveredStartLine,
        coveredEndLine: request.coveredEndLine,
      },
    },
  };
};
