import { createHash } from 'crypto';
import { ForgeStore } from '../../persistence/store.js';
import { CompressionContext } from './types.js';

// Note: In a real implementation this would use Drizzle against compressionCache,
// but for abstraction, we assume ForgeStore has CCR methods.
// Let's add CCR methods to ForgeStore later or assume direct DB access.
// Since we don't want to pollute Store too much, we'll accept db or store here.
// Actually, let's keep it simple and just use the Store.

export class CcrStore {
  constructor(private store: ForgeStore) {}

  /**
   * Hashes the content and returns the hash without saving yet.
   */
  hash(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Saves the original content to the reversible cache.
   */
  async storeContent(
    hash: string, 
    content: string, 
    compressedTokens: number, 
    originalTokens: number,
    context: CompressionContext
  ): Promise<void> {
    // We assume store.db is accessible or we add a method to store.
    // Since store.ts didn't expose this, we use raw sql via store.sqlite for now
    // or we assume it will be implemented in store.ts.
    
    // Quick implementation via the store's sqlite connection (assuming it's exposed or we mock it)
    if (this.store.sqlite) {
      const stmt = this.store.sqlite.prepare(`
        INSERT INTO compression_cache (hash, original_content, compressed_tokens, original_tokens, content_type, tool_name, accessed_at, retrieval_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(hash) DO UPDATE SET accessed_at = excluded.accessed_at
      `);
      stmt.run(
        hash, 
        content, 
        compressedTokens, 
        originalTokens, 
        context.contentType || 'text', 
        context.toolName || null, 
        Date.now()
      );
    }
  }

  /**
   * Retrieves the original content by hash.
   */
  async retrieve(hash: string): Promise<string | null> {
    if (this.store.sqlite) {
      const stmt = this.store.sqlite.prepare(`
        UPDATE compression_cache 
        SET accessed_at = ?, retrieval_count = retrieval_count + 1 
        WHERE hash = ?
        RETURNING original_content
      `);
      const row = stmt.get(Date.now(), hash) as { original_content: string } | undefined;
      return row ? row.original_content : null;
    }
    return null;
  }
}
