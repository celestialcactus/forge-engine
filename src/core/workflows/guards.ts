import { AgentResult } from '../agents/types.js';
import { WorkflowState } from './types.js';

export const guards = {
  analysisCompleted: (state: WorkflowState, result: AgentResult) => {
    return result.status === 'completed' && !result.findings.some(f => f.severity === 'blocker');
  },
  
  noBlockerFindings: (state: WorkflowState, result: AgentResult) => {
    return !result.findings.some(f => f.severity === 'blocker');
  },
  
  hasBlockerFindings: (state: WorkflowState, result: AgentResult) => {
    return result.findings.some(f => f.severity === 'blocker');
  },
  
  lastAgentSucceeded: (state: WorkflowState, result: AgentResult) => {
    return result.status === 'completed';
  },
  
  lastAgentFailed: (state: WorkflowState, result: AgentResult) => {
    return result.status === 'failed';
  },
  
  withinStepLimit: (limit: number) => (state: WorkflowState, result: AgentResult) => {
    const totalSteps = Object.values(state.edgeTraversalCounts).reduce((a: number, b: number) => a + b, 0);
    return totalSteps < limit;
  }
};
