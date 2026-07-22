/**
 * Branded types for type-safe ID passing
 */
export type Brand<K, T> = K & { __brand: T };

export type AgentId = Brand<string, 'AgentId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type ToolId = Brand<string, 'ToolId'>;
export type ThreadId = Brand<string, 'ThreadId'>;

/**
 * Agent Roles define the scope of capabilities and expected behavior.
 */
export type AgentRole =
  | 'analysis'
  | 'planning'
  | 'implementation'
  | 'review'
  | 'orchestration';

/**
 * Tool Categories define what a tool does, used for role-based access control.
 */
export type ToolCategory =
  | 'read'
  | 'write'
  | 'execute'
  | 'search'
  | 'web'
  | 'agent';

/**
 * Finding Severity for task gating.
 */
export type FindingSeverity = 'blocker' | 'warning' | 'info';

/**
 * Defines which tool categories are available to which agent roles.
 */
export const ROLE_TOOL_ACCESS: Record<AgentRole, ToolCategory[]> = {
  analysis: ['read', 'search'],
  planning: ['read', 'search', 'agent'],
  implementation: ['read', 'write', 'execute', 'search', 'web'],
  review: ['read', 'search', 'execute'],
  orchestration: ['read', 'agent'],
};

/**
 * Defines the runtime mode of the execution engine.
 */
export type RuntimeMode = 'sovereign' | 'copilot' | 'hybrid';

/**
 * Global engine configuration.
 */
export interface ForgeEngineConfig {
  mode: RuntimeMode;
  trustedMode?: boolean; // Disables DLP and Egress policy guardrails for autonomous looping
}
