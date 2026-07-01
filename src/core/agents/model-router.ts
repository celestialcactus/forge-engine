import { RuntimeMode } from '../types.js';
import { RoutingDecision } from './types.js';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('forge-engine.router');

export interface RouterConfig {
  localModel: string;
  cloudModel: string;
  complexityThreshold: number; // 0.0 to 1.0
  alwaysLocal?: string[]; // Task types that must be local
  alwaysCloud?: string[]; // Task types that must be cloud
}

export class ModelRouter {
  constructor(
    private mode: RuntimeMode,
    private config: RouterConfig
  ) {}

  /**
   * Evaluates the task and context to decide which model to use.
   */
  async classify(task: string, context: Record<string, any> = {}): Promise<RoutingDecision> {
    return tracer.startActiveSpan('model.route', async (span) => {
      try {
        // Fast paths for non-hybrid modes
        if (this.mode === 'sovereign') {
          const decision = this.createDecision(this.config.localModel, 1.0, { taskType: 'any' });
          this.recordDecision(span, decision);
          return decision;
        }

        if (this.mode === 'copilot') {
          const decision = this.createDecision(this.config.cloudModel, 1.0, { taskType: 'any' });
          this.recordDecision(span, decision);
          return decision;
        }

        // Hybrid mode complexity classification
        // In a real implementation, this might call a small local LLM or use heuristics.
        // For Phase 2 scaffolding, we use heuristics based on the input task length and context.
        
        const estimatedFiles = context.files ? context.files.length : 1;
        const tokenBudget = task.length / 4; // Rough estimate
        const crossCutting = estimatedFiles > 3 || task.toLowerCase().includes('refactor');
        
        let score = 0.2; // Base complexity
        if (crossCutting) score += 0.4;
        if (tokenBudget > 2000) score += 0.3;

        const targetModel = score >= this.config.complexityThreshold 
          ? this.config.cloudModel 
          : this.config.localModel;

        const decision: RoutingDecision = {
          targetModel,
          confidenceScore: score,
          complexitySignals: {
            estimatedFiles,
            tokenBudget,
            taskType: 'heuristic',
            crossCutting
          }
        };

        this.recordDecision(span, decision);
        return decision;
      } finally {
        span.end();
      }
    });
  }

  private createDecision(targetModel: string, confidenceScore: number, signals: Partial<RoutingDecision['complexitySignals']>): RoutingDecision {
    return {
      targetModel,
      confidenceScore,
      complexitySignals: {
        estimatedFiles: 1,
        tokenBudget: 0,
        taskType: 'override',
        crossCutting: false,
        ...signals
      }
    };
  }

  private recordDecision(span: any, decision: RoutingDecision) {
    span.setAttribute('routing.decision', decision.targetModel);
    span.setAttribute('routing.confidence', decision.confidenceScore);
  }
}
