import type { Capability } from '../slice0/contracts.js';
import { createWorkspaceReadCapability, createWorkspaceSymbolsCapability } from './files.js';
import { createGitDiffCapability, createGitStatusCapability } from './git-evidence.js';
import { createTypeScriptDiagnosticsCapability } from './typescript-evidence.js';
import { createWorkspaceSearchCapability, workspaceInventoryCapability } from './workspace.js';

export const developerEvidenceCapabilityIds = [
  'workspace.inventory',
  'workspace.search',
  'workspace.read',
  'workspace.symbols',
  'typescript.diagnostics',
  'git.status',
  'git.diff',
] as const;

export function createDeveloperEvidenceCapabilities(workspaceRoot: string): readonly Capability[] {
  return [
    workspaceInventoryCapability,
    createWorkspaceSearchCapability(workspaceRoot),
    createWorkspaceReadCapability(workspaceRoot),
    createWorkspaceSymbolsCapability(workspaceRoot),
    createTypeScriptDiagnosticsCapability(workspaceRoot),
    createGitStatusCapability(workspaceRoot),
    createGitDiffCapability(workspaceRoot),
  ].map((capability) => ({ ...capability, replaySafety: 'read_only_retryable' as const }));
}
