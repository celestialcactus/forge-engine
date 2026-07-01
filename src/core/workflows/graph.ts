import { WorkflowId } from '../types.js';
import { WorkflowGraph, WorkflowNode, WorkflowEdge, GuardFunction } from './types.js';

export class WorkflowBuilder {
  private nodes = new Map<string, WorkflowNode>();
  private edges: WorkflowEdge[] = [];
  
  constructor(
    private id: WorkflowId,
    private description: string
  ) {}

  node(id: string, agentName: string): this {
    if (this.nodes.has(id)) {
      throw new Error(`Node ${id} already exists in workflow ${this.id}`);
    }
    this.nodes.set(id, { id, agentName });
    return this;
  }

  edge(source: string, target: string, options?: { guard?: GuardFunction; maxTraversals?: number }): this {
    this.edges.push({
      source,
      target,
      guard: options?.guard,
      maxTraversals: options?.maxTraversals
    });
    return this;
  }

  build(): WorkflowGraph {
    this.validate();
    return {
      id: this.id,
      description: this.description,
      nodes: this.nodes,
      edges: this.edges
    };
  }

  private validate() {
    if (!this.nodes.has('__start__')) {
      throw new Error(`Workflow ${this.id} must have a '__start__' node`);
    }
    if (!this.nodes.has('__end__')) {
      throw new Error(`Workflow ${this.id} must have an '__end__' node`);
    }
    
    // Ensure all edges reference valid nodes
    for (const edge of this.edges) {
      if (!this.nodes.has(edge.source)) {
        throw new Error(`Edge source ${edge.source} does not exist`);
      }
      if (!this.nodes.has(edge.target)) {
        throw new Error(`Edge target ${edge.target} does not exist`);
      }
    }
    
    // Basic cycle detection (ignores edges with maxTraversals since they can loop safely)
    const visited = new Set<string>();
    const stack = new Set<string>();

    const checkCycle = (nodeId: string) => {
      visited.add(nodeId);
      stack.add(nodeId);

      const outgoing = this.edges.filter(e => e.source === nodeId && e.maxTraversals === undefined);
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          checkCycle(edge.target);
        } else if (stack.has(edge.target)) {
          throw new Error(`Unbounded cycle detected in workflow ${this.id} at edge ${edge.source} -> ${edge.target}. Use maxTraversals to bound loops.`);
        }
      }
      stack.delete(nodeId);
    };

    checkCycle('__start__');
  }
}

export function defineWorkflow(id: WorkflowId, description: string): WorkflowBuilder {
  return new WorkflowBuilder(id, description);
}
