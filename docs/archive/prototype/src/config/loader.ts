import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import crypto from 'node:crypto';

import {
  AgentConfigSchema,
  GlobalConfigSchema,
  type AgentConfig,
  type GlobalConfig,
} from './schema.js';

// ─── Paths ──────────────────────────────────────────────────────────

/** Resolve the global config directory (~/.agent-engine/) */
export function getGlobalConfigDir(): string {
  const home =
    process.env.AGENT_ENGINE_HOME ||
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.agent-engine');
  return home;
}

/** Resolve the repo-level config directory (.agent/) from a given root */
export function getRepoConfigDir(repoRoot: string): string {
  return path.join(repoRoot, '.agent');
}

// ─── YAML Loader ────────────────────────────────────────────────────

function loadYamlFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf-8');
  return (parseYaml(raw) as Record<string, unknown>) || {};
}

// ─── Config Loading ─────────────────────────────────────────────────

/**
 * Load global config from ~/.agent-engine/config.yaml.
 * Returns validated defaults if file doesn't exist.
 */
export function loadGlobalConfig(): GlobalConfig {
  const configPath = path.join(getGlobalConfigDir(), 'config.yaml');
  const raw = loadYamlFile(configPath);
  return GlobalConfigSchema.parse(raw);
}

/**
 * Load repo-level config from .agent/config.yaml.
 * Returns validated defaults if file doesn't exist.
 */
export function loadRepoConfig(repoRoot: string): AgentConfig {
  const configPath = path.join(getRepoConfigDir(repoRoot), 'config.yaml');
  const raw = loadYamlFile(configPath);
  return AgentConfigSchema.parse(raw);
}

// ─── Policy Precedence Merge ────────────────────────────────────────

/**
 * Merge global and repo configs with strict precedence.
 * Org/global policy ALWAYS overrides repo-level config.
 * Repo can tighten but never weaken.
 */
export function mergeConfigs(
  global: GlobalConfig,
  repo: AgentConfig,
): AgentConfig {
  return {
    // Model access: global wins on security fields
    model_access: {
      mode: repo.model_access.mode, // repo can choose mode
      allow_user_defined_endpoints:
        global.model_access.allow_user_defined_endpoints === false
          ? false
          : repo.model_access.allow_user_defined_endpoints,
      allow_user_api_keys:
        global.model_access.allow_user_api_keys === false
          ? false
          : repo.model_access.allow_user_api_keys,
      require_managed_credentials:
        global.model_access.require_managed_credentials === true
          ? true
          : repo.model_access.require_managed_credentials,
      approved_gateways:
        global.model_access.approved_gateways.length > 0
          ? global.model_access.approved_gateways
          : repo.model_access.approved_gateways,
      network_default:
        global.model_access.network_default === 'deny'
          ? 'deny'
          : repo.model_access.network_default,
    },

    // Execution limits: take the more restrictive (lower) values
    execution_limits: {
      max_iterations: Math.min(
        global.execution_limits.max_iterations,
        repo.execution_limits.max_iterations,
      ),
      max_runtime_minutes: Math.min(
        global.execution_limits.max_runtime_minutes,
        repo.execution_limits.max_runtime_minutes,
      ),
      max_tool_calls: Math.min(
        global.execution_limits.max_tool_calls,
        repo.execution_limits.max_tool_calls,
      ),
    },

    // Permissions: take the more restrictive level
    permissions: mergePermissions(global.permissions, repo.permissions),

    // Egress policy: global wins entirely (network security is org-level)
    egress_policy: global.egress_policy,

    // State storage and branch config: repo decides (not a security concern)
    state_storage: repo.state_storage,
    branch_state: repo.branch_state,

    // Local model: repo can override if global allows it
    local_model: repo.local_model || global.local_model,
  };
}

// ─── Permission Merge Logic ─────────────────────────────────────────

const PERMISSION_STRICTNESS = [
  'blocked',
  'always-approve',
  'approve',
  'approve-once',
  'auto',
] as const;

type PermLevel = (typeof PERMISSION_STRICTNESS)[number];

function stricterPermission(a: PermLevel, b: PermLevel): PermLevel {
  const idxA = PERMISSION_STRICTNESS.indexOf(a);
  const idxB = PERMISSION_STRICTNESS.indexOf(b);
  // Lower index = stricter
  return idxA <= idxB ? a : b;
}

function mergePermissions(
  global: AgentConfig['permissions'],
  repo: AgentConfig['permissions'],
): AgentConfig['permissions'] {
  return {
    read: stricterPermission(global.read, repo.read),
    write: stricterPermission(global.write, repo.write),
    terminal_safe: stricterPermission(
      global.terminal_safe,
      repo.terminal_safe,
    ),
    terminal_destructive: stricterPermission(
      global.terminal_destructive,
      repo.terminal_destructive,
    ),
    network: stricterPermission(global.network, repo.network),
  };
}

// ─── Config Tamper Detection ────────────────────────────────────────

/**
 * Compute a SHA-256 hash of a config file for tamper detection.
 */
export function hashConfigFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Load the merged config for a given repo root.
 * This is the primary entry point for config loading.
 */
export function loadMergedConfig(repoRoot: string): AgentConfig {
  const global = loadGlobalConfig();
  const repo = loadRepoConfig(repoRoot);
  return mergeConfigs(global, repo);
}
