import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const checkpoints = sqliteTable('checkpoints', {
  threadId: text('thread_id').notNull(),
  nodeId: text('node_id').notNull(),
  stateSnapshot: text('state_snapshot').notNull(), // JSON
  createdAt: integer('created_at').notNull(),
});

export const agentResults = sqliteTable('agent_results', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  nodeId: text('node_id').notNull(),
  agentName: text('agent_name').notNull(),
  output: text('output').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const contextSnapshots = sqliteTable('context_snapshots', {
  threadId: text('thread_id').primaryKey(),
  summary: text('summary').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const memoryStore = sqliteTable('memory_store', {
  key: text('key').primaryKey(),
  content: text('content').notNull(),
  confidence: real('confidence').notNull().default(1.0),
  sourceType: text('source_type').notNull(),
  validFrom: integer('valid_from'),
  expiresAt: integer('expires_at'),
  updatedAt: integer('updated_at').notNull(),
});

// Note: memoryStore_fts is a virtual table that will be created via raw SQL in the store initialization
// since Drizzle's SQLite support for FTS5 is limited.

export const compressionCache = sqliteTable('compression_cache', {
  hash: text('hash').primaryKey(),
  originalContent: text('original_content').notNull(),
  compressedTokens: integer('compressed_tokens').notNull(),
  originalTokens: integer('original_tokens').notNull(),
  contentType: text('content_type').notNull(),
  toolName: text('tool_name'),
  accessedAt: integer('accessed_at').notNull(),
  retrievalCount: integer('retrieval_count').notNull().default(0),
});
