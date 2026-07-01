import { defineTool } from '../tools/native.js';
import { z } from 'zod';
import { ForgeCompressionPipeline } from './pipeline.js';

export function createCcrRetrieveTool(pipeline: ForgeCompressionPipeline) {
  return defineTool({
    name: 'ccr_retrieve',
    description: 'Retrieves the full, uncompressed content of a payload that was truncated. Use the ccrHash provided in the truncated output.',
    category: 'agent',
    parameters: z.object({
      ccrHash: z.string().describe('The 16-character hash identifying the original content.')
    }),
    execute: async (input, context) => {
      const content = await pipeline.retrieve(input.ccrHash);
      if (!content) {
        throw new Error(`Hash ${input.ccrHash} not found in Compress-Cache-Retrieve store.`);
      }
      return content;
    }
  });
}
