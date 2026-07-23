import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Tool, ToolResult } from './types.js';
import { z } from 'zod';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('forge-engine.mcp');

export interface McpConnectionConfig {
  serverName: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConnection {
  client: Client;
  tools: Tool[];
}

/**
 * Connects to an external MCP server and maps its tools to the Forge Tool interface.
 */
export async function connectMcpServer(config: McpConnectionConfig): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: { ...process.env, ...config.env } as Record<string, string>,
  });

  const client = new Client(
    { name: 'forge-engine', version: '0.1.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  const toolsList = await client.listTools();
  
  const forgeTools: Tool[] = toolsList.tools.map(mcpTool => {
    // Map MCP JSON Schema to Zod
    // Note: In a real implementation, we would use a library like json-schema-to-zod
    // or just pass the schema through if Vercel AI SDK accepts raw JSON schema.
    // For now, we use a pass-through dynamic schema.
    const parameters = z.any(); 

    return {
      name: `${config.serverName}_${mcpTool.name}`,
      description: mcpTool.description ?? '',
      category: 'execute', // MCP tools default to execute unless overridden
      parameters,
      execute: async (input, context): Promise<ToolResult<any>> => {
        return tracer.startActiveSpan(`mcp.tool.${mcpTool.name}`, async (span) => {
          try {
            span.setAttribute('mcp.server', config.serverName);
            
            const result = await client.callTool({
              name: mcpTool.name,
              arguments: input as any,
            });
            
            span.setStatus({ code: 1 });
            return { success: true, data: result.content };
          } catch (error: any) {
            span.setStatus({ code: 2, message: error.message });
            return { success: false, error: error.message };
          } finally {
            span.end();
          }
        });
      }
    };
  });

  return { client, tools: forgeTools };
}
