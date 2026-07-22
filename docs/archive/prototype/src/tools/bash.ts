import { defineTool } from '../core/tools/native.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const bashTool = defineTool({
  name: 'bash',
  description: 'Executes a bash command. Note: In production, this executes within a Docker sandbox.',
  category: 'execute',
  parameters: z.object({
    command: z.string().describe('The bash command to execute.'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds.'),
  }),
  execute: async (input, context) => {
    context.span?.addEvent('bash.execute.start', { command: input.command });
    
    // In Phase 5 scaffolding, we emulate the Docker sandbox by just running it locally 
    // for testing, but real implementation would wrap this in a docker API call
    // e.g. docker run --rm -v ${context.cwd}:/workspace alpine sh -c "${input.command}"
    
    try {
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: context.cwd,
        timeout: input.timeout,
        maxBuffer: 1024 * 1024 * 10 // 10MB
      });
      
      context.span?.addEvent('bash.execute.complete', { 
        stdoutLength: stdout.length,
        stderrLength: stderr.length 
      });
      
      if (stderr && !stdout) {
         return `STDERR:\n${stderr}`;
      }
      return `${stdout}${stderr ? `\nSTDERR:\n${stderr}` : ''}`;
    } catch (error: any) {
      context.span?.recordException(error);
      throw new Error(`Command failed: ${error.message}\nSTDOUT: ${error.stdout}\nSTDERR: ${error.stderr}`);
    }
  }
});
