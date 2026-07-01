import { WorkflowGraph, WorkflowState, WorkflowRunRecord } from './types.js';
import { AgentDispatcher } from '../agents/dispatcher.js';
import { AgentRegistry } from '../agents/registry.js';
import { ForgeStore } from '../../persistence/store.js';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('forge-engine.executor');

export interface ExecutorOptions {
  threadId: string;
  input: string;
  context?: Record<string, any>;
  resume?: boolean;
}

export class WorkflowExecutor {
  constructor(
    private dispatcher: AgentDispatcher,
    private registry: AgentRegistry,
    private store: ForgeStore
  ) {}

  async execute(graph: WorkflowGraph, options: ExecutorOptions): Promise<WorkflowRunRecord> {
    return tracer.startActiveSpan(`workflow.execute.${graph.id}`, async (span) => {
      try {
        span.setAttribute('workflow.id', graph.id);
        span.setAttribute('workflow.threadId', options.threadId);
        
        let state: WorkflowState;
        const startTime = Date.now();

        // 1. Resume or Initialize State
        if (options.resume) {
          const checkpoint = await this.store.resume(options.threadId);
          if (checkpoint && checkpoint.status === 'running') {
            state = checkpoint;
            span.addEvent('workflow.resumed', { nodeId: state.currentNodeId });
          } else {
            state = this.createInitialState(options);
            span.addEvent('workflow.initialized');
          }
        } else {
          state = this.createInitialState(options);
          span.addEvent('workflow.initialized');
        }

        // 2. Traversal Loop
        while (state.status === 'running') {
          const node = graph.nodes.get(state.currentNodeId);
          if (!node) {
            throw new Error(`Node ${state.currentNodeId} not found in graph`);
          }

          if (node.id === '__end__') {
            state.status = 'completed';
            break;
          }

          // Fetch Agent
          const agent = this.registry.get(node.agentName);
          if (!agent && node.id !== '__start__') {
            throw new Error(`Agent ${node.agentName} not found in registry`);
          }

          let result;
          if (node.id === '__start__') {
            // Start node is a passthrough
            result = { status: 'completed' as const, output: 'Started', findings: [] };
          } else {
            // Dispatch to Agent
            result = await this.dispatcher.dispatch(agent!, state.input, { ...state.context, ...options.context });
            
            const resultsForNode = state.agentResults[node.id] || [];
            resultsForNode.push(result);
            state.agentResults[node.id] = resultsForNode;
            state.globalFindings.push(...(result.findings || []));

            // Save agent result to DB
            await this.store.saveAgentResult(state.threadId, node.id, node.agentName, result);
          }

          // Evaluate Edges
          const outgoingEdges = graph.edges.filter(e => e.source === node.id);
          let nextNodeId = '__end__'; // Default to end if no edges

          for (const edge of outgoingEdges) {
            // Guard check
            const guardPasses = edge.guard ? await edge.guard(state, result) : true;
            
            if (guardPasses) {
              const edgeKey = `${edge.source}->${edge.target}`;
              const traversals = state.edgeTraversalCounts[edgeKey] || 0;
              
              if (edge.maxTraversals !== undefined && traversals >= edge.maxTraversals) {
                span.addEvent('workflow.edge_limit_reached', { edge: edgeKey });
                continue; // Try next edge
              }

              state.edgeTraversalCounts[edgeKey] = traversals + 1;
              nextNodeId = edge.target;
              break; // Take the first passing edge
            }
          }

          state.visitedNodes.push(state.currentNodeId);
          state.currentNodeId = nextNodeId;

          if (result.status === 'failed') {
            state.status = 'failed';
          } else if (result.status === 'max_iterations') {
            state.status = 'blocked';
          }

          // 3. Checkpoint State
          await this.store.checkpoint(state.threadId, state.currentNodeId, state);
        }

        span.setStatus({ code: state.status === 'completed' ? 1 : 2 });
        
        return {
          threadId: state.threadId as any,
          workflowId: graph.id,
          startTime,
          endTime: Date.now(),
          status: state.status,
          finalState: state
        };
      } catch (error: any) {
        span.setStatus({ code: 2, message: error.message });
        span.recordException(error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private createInitialState(options: ExecutorOptions): WorkflowState {
    return {
      threadId: options.threadId as any,
      currentNodeId: '__start__',
      visitedNodes: [],
      edgeTraversalCounts: {},
      agentResults: {},
      status: 'running',
      input: options.input,
      context: options.context || {},
      globalFindings: []
    };
  }
}
