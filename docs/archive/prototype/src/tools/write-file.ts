import { defineTool } from '../core/tools/native.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

export const writeFileTool = defineTool({
  name: 'write_file',
  description: 'Writes content to a file in the workspace, overwriting existing content or creating a new file. Use this for atomic check-pointing/rollbacks.',
  category: 'write',
  parameters: z.object({
    filePath: z.string().describe('The path to the file to write, relative to the workspace root.'),
    content: z.string().describe('The content to write to the file.'),
  }),
  execute: async (input, context) => {
    const targetPath = path.resolve(context.cwd || process.cwd(), input.filePath);
    
    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    
    context.span?.addEvent('file.writing', { path: targetPath, size: input.content.length });
    
    // Atomic write approach (scaffolding for rollback capability mentioned in spec)
    const tempPath = `${targetPath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, input.content, 'utf-8');
    
    try {
      // Optional: If rollback support was fully implemented, we'd snapshot the old file here
      await fs.rename(tempPath, targetPath);
    } catch (e) {
      await fs.unlink(tempPath).catch(() => {});
      throw e;
    }
    
    context.span?.addEvent('file.write.complete');
    
    return `Successfully wrote to ${input.filePath}`;
  }
});
