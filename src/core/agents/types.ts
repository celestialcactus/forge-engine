import { z } from 'zod';
import { AgentRole, FindingSeverity } from '../types.js';

export const AgentDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  role: z.custom<AgentRole>(),
  instructions: z.string(),
  maxIterations: z.number().optional().default(10),
  outputFormat: z.string().optional(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const FindingSchema = z.object({
  severity: z.custom<FindingSeverity>(),
  message: z.string(),
  evidence: z.string().optional(),
  verifiableCommand: z.string().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

export interface AgentResult {
  status: 'completed' | 'failed' | 'max_iterations';
  output: string;
  findings: Finding[];
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  routingDecision?: RoutingDecision;
}

export interface RoutingDecision {
  targetModel: string;
  confidenceScore: number;
  complexitySignals: {
    estimatedFiles: number;
    tokenBudget: number;
    taskType: string;
    crossCutting: boolean;
  };
}
