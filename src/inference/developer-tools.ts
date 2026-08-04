import type { InferenceToolDefinition } from './contracts.js';

const objectSchema = (
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
): Readonly<Record<string, unknown>> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const developerEvidenceTools: readonly InferenceToolDefinition[] = [
  {
    name: 'forge_workspace_summary',
    capabilityId: 'workspace.inventory',
    description: 'Return a bounded inventory of workspace-relative paths. Use only when broad orientation is required.',
    inputSchema: objectSchema({ maxFiles: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }),
  },
  {
    name: 'forge_workspace_search',
    capabilityId: 'workspace.search',
    description: 'Search workspace text for one literal substring and return path and line evidence.',
    inputSchema: objectSchema({
      query: { type: 'string', minLength: 1, maxLength: 500 },
      maxMatches: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      caseSensitive: { type: 'boolean', default: false },
    }, ['query']),
  },
  {
    name: 'forge_workspace_read',
    capabilityId: 'workspace.read',
    description: 'Read one smallest-useful bounded line range from a workspace-relative UTF-8 file.',
    inputSchema: objectSchema({
      path: { type: 'string', minLength: 1, maxLength: 1_000 },
      startLine: { type: 'integer', minimum: 1, maximum: 1_000_000, default: 1 },
      maxLines: { type: 'integer', minimum: 1, maximum: 200, default: 120 },
    }, ['path']),
  },
  {
    name: 'forge_workspace_symbols',
    capabilityId: 'workspace.symbols',
    description: 'List bounded TypeScript or JavaScript declarations with complete workspace-relative paths and lines.',
    inputSchema: objectSchema({
      query: { type: 'string', maxLength: 500 },
      maxFiles: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      maxSymbols: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
    }),
  },
  {
    name: 'forge_typescript_diagnostics',
    capabilityId: 'typescript.diagnostics',
    description: 'Run bounded no-emit TypeScript diagnostics for a workspace-relative config.',
    inputSchema: objectSchema({
      configPath: { type: 'string', minLength: 1, maxLength: 1_000 },
      maxDiagnostics: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    }),
  },
  {
    name: 'forge_git_status',
    capabilityId: 'git.status',
    description: 'Return read-only Git branch and bounded working-tree status evidence.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'forge_git_diff',
    capabilityId: 'git.diff',
    description: 'Return a bounded read-only Git diff for the opened repository.',
    inputSchema: objectSchema({
      staged: { type: 'boolean', default: false },
      maxBytes: { type: 'integer', minimum: 1, maximum: 100_000, default: 20_000 },
    }),
  },
];

export const developerChangePlanTool: InferenceToolDefinition = {
  name: 'forge_workspace_change_plan',
  capabilityId: 'workspace.change.plan',
  description: 'Create a non-mutating digest-bound review plan for complete UTF-8 file replacements. Read each complete target first, then provide its path and complete desired UTF-8 content. Forge owns digest and diff bounds. This only proposes a diff; it never applies or verifies a change.',
  inputSchema: objectSchema({
    changes: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: objectSchema({
        path: { type: 'string', minLength: 1, maxLength: 1_000 },
        content: { type: 'string', maxLength: 1_048_576 },
      }, ['path', 'content']),
    },
  }, ['changes']),
};

export const developerChangePlanningTools: readonly InferenceToolDefinition[] = [
  ...developerEvidenceTools,
  developerChangePlanTool,
];
