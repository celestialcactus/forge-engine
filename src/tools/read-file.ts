import { defineTool } from '../core/tools/native.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

export const readFileTool = defineTool({
  name: 'read_file',
  description: 'Reads the contents of a file from the workspace.',
  category: 'read',
  parameters: z.object({
    filePath: z.string().describe('The path to the file to read, relative to the workspace root.'),
  }),
  execute: async (input, context) => {
    // In a real execution, we would resolve against context.cwd
    // and enforce path containment. For Phase 5 scaffolding:
    const targetPath = path.resolve(context.cwd || process.cwd(), input.filePath);
    
    context.span?.addEvent('file.reading', { path: targetPath });
    
    const content = await fs.readFile(targetPath, 'utf-8');
    
    context.span?.addEvent('file.read.complete', { 
      bytes: content.length,
      lines: content.split('\n').length
    });
    
    return content;
  }
});
