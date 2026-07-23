import { AgentResult, Finding } from '../agents/types.js';
import { WorkflowId, ThreadId } from '../types.js';

export interface WorkflowNode {
  id: string;
  agentName: string;
}

export type GuardFunction = (state: WorkflowState, result: AgentResult) => boolean | Promise<boolean>;

export interface WorkflowEdge {
  source: string;
  target: string;
  guard?: GuardFunction;
  maxTraversals?: number;
}

export interface WorkflowGraph {
  id: WorkflowId;
  description: string;
  nodes: Map<string, WorkflowNode>;
  edges: WorkflowEdge[];
}

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface WorkflowState {
  threadId: ThreadId;
  currentNodeId: string;
  visitedNodes: string[];
  edgeTraversalCounts: Record<string, number>;
  agentResults: Record<string, AgentResult[]>;
  status: WorkflowStatus;
  input: string;
  context: Record<string, any>;
  globalFindings: Finding[];
}

export interface WorkflowRunRecord {
  threadId: ThreadId;
  workflowId: WorkflowId;
  startTime: number;
  endTime?: number;
  status: WorkflowStatus;
  finalState: WorkflowState;
}
