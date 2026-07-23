export interface CompressionContext {
  contentType?: string;
  toolName?: string;
  tokenBudget?: number;
  role?: string;
}

export interface CompressionResult {
  content: string;
  compressed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  ccrHash?: string;
  contentType?: string;
}

export interface CompressionStats {
  totalCompressions: number;
  totalTokensSaved: number;
  totalRetrievals: number;
  averageCompressionRatio: number;
}

export interface CompressionPipeline {
  compress(content: string, context: CompressionContext): Promise<CompressionResult>;
  retrieve?(hash: string, query?: string): Promise<string | null>;
  getStats?(): CompressionStats;
}
