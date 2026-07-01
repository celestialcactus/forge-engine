import { Tool } from './types.js';
import { AgentRole, ROLE_TOOL_ACCESS } from '../types.js';
import { DlpFilter, ConstraintEngine, EgressPolicyEnforcer } from '../../safety/index.js';

export interface ToolRegistryConfig {
  dlpFilter?: DlpFilter;
  constraintEngine?: ConstraintEngine;
  egressEnforcer?: EgressPolicyEnforcer;
  mode?: 'strict' | 'trusted';
}

/**
 * Registry for managing and filtering tools based on agent roles.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private config: ToolRegistryConfig;

  constructor(config: ToolRegistryConfig = { mode: 'strict' }) {
    this.config = config;
  }

  /**
   * Registers a single tool in the registry.
   */
  register(tool: Tool) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    
    // In strict mode, we could wrap the tool execute function with safety middleware here,
    // but the actual execution happens via AgentDispatcher.
    // However, the cleanest way is to wrap it here so that ANY caller of the tool gets the safety checks.
    
    const originalExecute = tool.execute;
    const mode = this.config.mode ?? 'strict';
    
    tool.execute = async (input: any, context) => {
      // 1. Constraint Engine (Pre-execution)
      if (mode === 'strict' && this.config.constraintEngine) {
        // Assume ConstraintEngine validates input paths (simplified for registry integration)
        // A full implementation would introspect input for paths/commands.
      }
      
      // 2. Egress Policy (Pre-execution)
      if (mode === 'strict' && this.config.egressEnforcer && tool.category === 'web') {
        // Assume input has url
        if (input.url) {
          const violation = this.config.egressEnforcer.validateUrl(input.url);
          if (violation) {
            return { success: false, error: violation.message };
          }
        }
      }

      // Execute actual tool
      const result = await originalExecute(input, context);

      // 3. DLP Filter (Post-execution)
      if (mode === 'strict' && this.config.dlpFilter && result.success && typeof result.data === 'string') {
        const redacted = this.config.dlpFilter.redact(result.data);
        result.data = redacted as any;
      }

      return result;
    };

    this.tools.set(tool.name, tool);
  }

  /**
   * Registers an array of tools.
   */
  registerAll(tools: Tool[]) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Gets a tool by name.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Lists all registered tools.
   */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns only the tools that the specified role is permitted to use.
   */
  getToolsForRole(role: AgentRole): Tool[] {
    const allowedCategories = ROLE_TOOL_ACCESS[role];
    return this.list().filter(tool => allowedCategories.includes(tool.category));
  }
}
