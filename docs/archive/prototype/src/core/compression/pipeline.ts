import { 
  CompressionPipeline, 
  CompressionContext, 
  CompressionResult, 
  CompressionStats 
} from './types.js';
import { ContentRouter } from './content-router.js';
import { SmartCrusher } from './smart-crusher.js';
import { CcrStore } from './ccr-store.js';

export class ForgeCompressionPipeline implements CompressionPipeline {
  private stats: CompressionStats = {
    totalCompressions: 0,
    totalTokensSaved: 0,
    totalRetrievals: 0,
    averageCompressionRatio: 0
  };

  constructor(
    private router: ContentRouter,
    private crusher: SmartCrusher,
    private store: CcrStore
  ) {}

  async compress(content: string, context: CompressionContext): Promise<CompressionResult> {
    const contentType = this.router.classify(content, context);
    
    if (contentType === 'short' || context.tokenBudget && content.length / 4 <= context.tokenBudget) {
      return {
        content,
        compressed: false,
        tokensBefore: Math.ceil(content.length / 4),
        tokensAfter: Math.ceil(content.length / 4)
      };
    }

    let compressedContent = content;
    let isCompressed = false;
    const ccrHash = this.store.hash(content);

    if (contentType === 'json_array') {
      const crushed = this.crusher.crush(content, ccrHash);
      if (crushed) {
        compressedContent = crushed;
        isCompressed = true;
      }
    } else if (contentType === 'log_output' || contentType === 'code' || contentType === 'text') {
      // Truncation strategy (first 10%, last 20%)
      const lines = content.split('\n');
      if (lines.length > 50) {
        const head = lines.slice(0, Math.floor(lines.length * 0.1));
        const tail = lines.slice(-Math.floor(lines.length * 0.2));
        compressedContent = [...head, `\n... [${lines.length - head.length - tail.length} lines omitted. Use ccr_retrieve tool with hash=${ccrHash} to view full content] ...\n`, ...tail].join('\n');
        isCompressed = true;
      }
    }

    const tokensBefore = Math.ceil(content.length / 4);
    const tokensAfter = Math.ceil(compressedContent.length / 4);

    if (isCompressed) {
      await this.store.storeContent(ccrHash, content, tokensAfter, tokensBefore, {
        ...context,
        contentType
      });

      this.updateStats(tokensBefore, tokensAfter);
    }

    return {
      content: compressedContent,
      compressed: isCompressed,
      tokensBefore,
      tokensAfter,
      ccrHash: isCompressed ? ccrHash : undefined,
      contentType
    };
  }

  async retrieve(hash: string): Promise<string | null> {
    const content = await this.store.retrieve(hash);
    if (content) {
      this.stats.totalRetrievals++;
    }
    return content;
  }

  getStats(): CompressionStats {
    return this.stats;
  }

  private updateStats(before: number, after: number) {
    this.stats.totalCompressions++;
    const saved = before - after;
    this.stats.totalTokensSaved += saved;
    
    const currentRatio = after / before;
    // Running average
    if (this.stats.totalCompressions === 1) {
      this.stats.averageCompressionRatio = currentRatio;
    } else {
      this.stats.averageCompressionRatio = 
        this.stats.averageCompressionRatio + (currentRatio - this.stats.averageCompressionRatio) / this.stats.totalCompressions;
    }
  }
}
