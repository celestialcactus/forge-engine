import { z } from 'zod';

// ─── Integration Modes ──────────────────────────────────────────────
export const IntegrationMode = z.enum([
  'copilot-assisted',
  'managed-model',
  'local-model',
]);
export type IntegrationMode = z.infer<typeof IntegrationMode>;

// ─── State Storage Modes ────────────────────────────────────────────
export const StateStorageMode = z.enum(['external', 'local', 'branch']);
export type StateStorageMode = z.infer<typeof StateStorageMode>;

// ─── On-Merge Behavior ─────────────────────────────────────────────
export const OnMergeBehavior = z.enum(['archive', 'strip', 'keep']);
export type OnMergeBehavior = z.infer<typeof OnMergeBehavior>;

// ─── Permission Levels ──────────────────────────────────────────────
export const PermissionLevel = z.enum([
  'auto',
  'approve',
  'approve-once',
  'always-approve',
  'blocked',
]);
export type PermissionLevel = z.infer<typeof PermissionLevel>;

// ─── Model Access Configuration ─────────────────────────────────────
export const ModelAccessSchema = z.object({
  mode: IntegrationMode.default('copilot-assisted'),
  allow_user_defined_endpoints: z.boolean().default(false),
  allow_user_api_keys: z.boolean().default(false),
  require_managed_credentials: z.boolean().default(true),
  approved_gateways: z.array(z.string().url()).default([]),
  network_default: z.enum(['deny', 'allow']).default('deny'),
});
export type ModelAccessConfig = z.infer<typeof ModelAccessSchema>;

// ─── Execution Limits ───────────────────────────────────────────────
export const ExecutionLimitsSchema = z.object({
  max_iterations: z.number().int().positive().default(10),
  max_runtime_minutes: z.number().positive().default(20),
  max_tool_calls: z.number().int().positive().default(50),
});
export type ExecutionLimits = z.infer<typeof ExecutionLimitsSchema>;

// ─── Permission Policy ─────────────────────────────────────────────
export const PermissionPolicySchema = z.object({
  read: PermissionLevel.default('auto'),
  write: PermissionLevel.default('approve'),
  terminal_safe: PermissionLevel.default('approve-once'),
  terminal_destructive: PermissionLevel.default('always-approve'),
  network: PermissionLevel.default('blocked'),
});
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;

// ─── Egress Policy ─────────────────────────────────────────────────
export const EgressPolicySchema = z.object({
  allowed_model_providers: z.array(z.string()).default(['copilot']),
  allowed_base_urls: z.array(z.string().url()).default([]),
  blocked_domains: z
    .array(z.string())
    .default(['api.openai.com', 'api.anthropic.com']),
  network_default: z.enum(['deny', 'allow']).default('deny'),
  require_managed_credentials: z.boolean().default(true),
  disallow_user_api_keys: z.boolean().default(true),
  log_all_external_requests: z.boolean().default(true),
});
export type EgressPolicy = z.infer<typeof EgressPolicySchema>;

// ─── Branch State Configuration ─────────────────────────────────────
export const BranchStateSchema = z.object({
  on_merge: OnMergeBehavior.default('archive'),
  protected_branches: z.array(z.string()).default(['main', 'develop']),
});
export type BranchStateConfig = z.infer<typeof BranchStateSchema>;

// ─── Local Model Configuration ──────────────────────────────────────
export const LocalModelSchema = z.object({
  provider: z.string().default('ollama'),
  model: z.string().default('codellama:13b'),
  endpoint: z.string().url().default('http://localhost:11434'),
});
export type LocalModelConfig = z.infer<typeof LocalModelSchema>;

// ─── Full Agent Config (repo-level .agent/config.yaml) ──────────────
export const AgentConfigSchema = z.object({
  model_access: ModelAccessSchema.default(() => ModelAccessSchema.parse({})),
  execution_limits: ExecutionLimitsSchema.default(() => ExecutionLimitsSchema.parse({})),
  permissions: PermissionPolicySchema.default(() => PermissionPolicySchema.parse({})),
  egress_policy: EgressPolicySchema.default(() => EgressPolicySchema.parse({})),
  state_storage: StateStorageMode.default('external'),
  branch_state: BranchStateSchema.default(() => BranchStateSchema.parse({})),
  local_model: LocalModelSchema.optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ─── Global Config (~/.agent-engine/config.yaml) ────────────────────
export const GlobalConfigSchema = z.object({
  identity: z
    .object({
      org: z.string().optional(),
      team: z.string().optional(),
    })
    .default(() => ({})),
  model_access: ModelAccessSchema.default(() => ModelAccessSchema.parse({})),
  execution_limits: ExecutionLimitsSchema.default(() => ExecutionLimitsSchema.parse({})),
  permissions: PermissionPolicySchema.default(() => PermissionPolicySchema.parse({})),
  egress_policy: EgressPolicySchema.default(() => EgressPolicySchema.parse({})),
  local_model: LocalModelSchema.optional(),
});
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

// ─── Task Lifecycle Statuses ────────────────────────────────────────
export const TaskStatus = z.enum([
  'draft_spec',
  'awaiting_approval',
  'running',
  'blocked',
  'validating',
  'complete',
  'failed',
  'archived',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// ─── Valid Task Status Transitions ──────────────────────────────────
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft_spec: ['awaiting_approval'],
  awaiting_approval: ['running', 'draft_spec', 'archived'],
  running: ['blocked', 'validating', 'failed'],
  blocked: ['running', 'failed', 'archived'],
  validating: ['complete', 'failed', 'blocked'],
  complete: ['archived'],
  failed: ['running', 'archived'],
  archived: [],
};

// ─── Task Meta (meta.json) ─────────────────────────────────────────
export const TaskMetaSchema = z.object({
  task_id: z.string(),
  run_id: z.string(),
  iteration_id: z.number().int().default(0),
  status: TaskStatus.default('draft_spec'),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  active_owner: z
    .object({
      user: z.string(),
      machine: z.string(),
      claimed_at: z.string().datetime(),
      heartbeat: z.string().datetime(),
    })
    .optional(),
  validation: z
    .object({
      tests_passed: z.boolean().nullable().default(null),
      build_passed: z.boolean().nullable().default(null),
      constraint_checks_passed: z.boolean().nullable().default(null),
      lint_passed: z.boolean().nullable().default(null),
      human_review_required: z.boolean().default(false),
    })
    .default(() => ({ tests_passed: null, build_passed: null, constraint_checks_passed: null, lint_passed: null, human_review_required: false })),
});
export type TaskMeta = z.infer<typeof TaskMetaSchema>;
