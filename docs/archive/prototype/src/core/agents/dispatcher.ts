import { generateText, LanguageModelV1, tool as aiTool } from 'ai';
import { AgentDefinition, AgentResult } from './types.js';
import { ModelRouter } from './model-router.js';
import { ToolRegistry } from '../tools/index.js';
import { CompressionPipeline } from '../compression/types.js';
import { createCcrRetrieveTool } from '../compression/tool.js';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('forge-engine.dispatcher');

export interface DispatcherConfig {
  maxSteps?: number;
  providerResolver: (modelId: string) => LanguageModelV1;
  compression?: CompressionPipeline;
}

export class AgentDispatcher {
  constructor(
    private router: ModelRouter,
    private toolRegistry: ToolRegistry,
    private config: DispatcherConfig
  ) {}

  /**
   * Dispatches a task to an agent, executing the LLM tool-use loop.
   */
  async dispatch(
    agent: AgentDefinition,
    task: string,
    context: Record<string, any> = {}
  ): Promise<AgentResult> {
    return tracer.startActiveSpan(`agent.dispatch.${agent.name}`, async (span) => {
      try {
        // 1. Route to determine the best model
        const routingDecision = await this.router.classify(task, context);
        const model = this.config.providerResolver(routingDecision.targetModel);

        span.setAttribute('gen_ai.system', 'forge');
        span.setAttribute('gen_ai.request.model', routingDecision.targetModel);

        const allowedTools = this.toolRegistry.getToolsForRole(agent.role);
        
        // Map Forge tools to Vercel AI SDK tools
        const aiTools = allowedTools.reduce((acc, t) => {
          acc[t.name] = aiTool({
            description: t.description,
            parameters: t.parameters as any, // AI SDK accepts Zod schemas
            execute: async (args) => {
              const result = await t.execute(args, { span, cwd: process.cwd() });
              if (!result.success) {
                return { error: result.error };
              }
              
              let payload = result.data;
              if (this.config.compression) {
                const cResult = await this.config.compression.compress(
                  typeof payload === 'string' ? payload : JSON.stringify(payload),
                  { toolName: t.name, role: agent.role, contentType: 'tool_result' }
                );
                payload = cResult.content;
              }
              
              return payload;
            }
          });
          return acc;
        }, {} as Record<string, any>);

        // Inject CCR retrieve tool if compression is active
        if (this.config.compression) {
          const ccrTool = createCcrRetrieveTool(this.config.compression as any); // Cast as any since it needs ForgeCompressionPipeline but types.js doesn't expose retrieve
          aiTools[ccrTool.name] = aiTool({
            description: ccrTool.description,
            parameters: ccrTool.parameters as any,
            execute: async (args) => {
              const res = await ccrTool.execute(args, { span, cwd: process.cwd() });
              if (!res.success) return { error: res.error };
              return res.data;
            }
          });
        }

        // 3. Construct prompt with Hermes tiered caching pattern
        // Stable Tier: System Identity, Role, Tools
        let systemPrompt = `You are ${agent.name}, acting in the role of ${agent.role}.
${agent.instructions}

Output Format: ${agent.outputFormat ?? 'text/markdown'}`;

        // Context Tier: Memory hits, files
        if (context.memories || context.files) {
          systemPrompt += `\n\n<context>\n${JSON.stringify(context)}\n</context>`;
        }

        // 4. Execute the loop
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt: task,
          tools: aiTools,
          maxSteps: agent.maxIterations || this.config.maxSteps || 10,
        });

        // 5. Construct result
        const agentResult: AgentResult = {
          status: result.steps.length >= (agent.maxIterations || this.config.maxSteps || 10) ? 'max_iterations' : 'completed',
          output: result.text,
          findings: [], // Extracted in a later phase or via specific tools
          tokenUsage: {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens
          },
          routingDecision
        };

        span.setStatus({ code: 1 });
        return agentResult;
      } catch (error: any) {
        span.setStatus({ code: 2, message: error.message });
        span.recordException(error);
        const errorResult: AgentResult = {
          status: 'failed',
          output: '',
          findings: [{ severity: 'blocker', message: error.message }]
        };
        return errorResult;
      } finally {
        span.end();
      }
    });
  }
}
