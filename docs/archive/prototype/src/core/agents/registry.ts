import { AgentDefinition, AgentDefinitionSchema } from './types.js';

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(definition: AgentDefinition) {
    // Validate schema
    const parsed = AgentDefinitionSchema.parse(definition);
    if (this.agents.has(parsed.name)) {
      throw new Error(`Agent already registered: ${parsed.name}`);
    }
    this.agents.set(parsed.name, parsed);
  }

  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}
