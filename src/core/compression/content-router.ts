import { CompressionContext } from './types.js';

export type SupportedContentType = 'json_array' | 'log_output' | 'code' | 'text' | 'short';

export class ContentRouter {
  /**
   * Classifies content to determine the optimal compression strategy.
   * Content under 200 chars automatically passes through as 'short'.
   */
  classify(content: string, context: CompressionContext): SupportedContentType {
    if (!content || content.length < 200) {
      return 'short';
    }

    const trimmed = content.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 2) {
          return 'json_array';
        }
      } catch {
        // Not valid JSON array
      }
    }

    if (context.toolName === 'bash' || trimmed.includes('npm ERR!') || trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
      return 'log_output';
    }

    if (trimmed.startsWith('```') || trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
      return 'code';
    }

    return 'text';
  }
}
