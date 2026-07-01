import { Tool, NativeToolConfig, ToolResult } from './types.js';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('forge-engine.tools');

/**
 * Factory function to define a native tool with proper type inference and OTel tracing.
 */
export function defineTool<TInput, TOutput>(
  config: NativeToolConfig<TInput, TOutput>
): Tool<TInput, TOutput> {
  return {
    name: config.name,
    description: config.description,
    category: config.category,
    parameters: config.parameters,
    execute: async (input, context): Promise<ToolResult<TOutput>> => {
      return tracer.startActiveSpan(`tool.${config.name}`, async (span) => {
        try {
          span.setAttribute('tool.category', config.category);
          
          // Execute the actual native logic
          const data = await config.execute(input, {
            ...context,
            span,
          });
          
          span.setStatus({ code: 1 }); // OK
          return { success: true, data };
        } catch (error: any) {
          span.setStatus({ code: 2, message: error.message }); // Error
          span.recordException(error);
          return { success: false, error: error.message };
        } finally {
          span.end();
        }
      });
    },
  };
}
