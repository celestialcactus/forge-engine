import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema.js';
import { WorkflowState } from '../core/workflows/types.js';
import { AgentResult } from '../core/agents/types.js';
import { nanoid } from 'nanoid';

export interface ForgeStoreConfig {
  dbPath: string;
}

export class ForgeStore {
  private db: BetterSQLite3Database<typeof schema>;
  public sqlite: Database.Database;

  constructor(config: ForgeStoreConfig) {
    this.sqlite = new Database(config.dbPath);
    this.db = drizzle(this.sqlite, { schema });
    this.initializeTables();
  }

  private initializeTables() {
    // In production we would use drizzle-kit migrate, but for dynamic initialization:
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        state_snapshot TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS agent_results (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        output TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS context_snapshots (
        thread_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_store (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        source_type TEXT NOT NULL,
        valid_from INTEGER,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_store_fts USING fts5(
        key, content, content='memory_store', content_rowid='rowid'
      );

      CREATE TABLE IF NOT EXISTS compression_cache (
        hash TEXT PRIMARY KEY,
        original_content TEXT NOT NULL,
        compressed_tokens INTEGER NOT NULL,
        original_tokens INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        tool_name TEXT,
        accessed_at INTEGER NOT NULL,
        retrieval_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async checkpoint(threadId: string, nodeId: string, state: WorkflowState) {
    await this.db.insert(schema.checkpoints).values({
      threadId,
      nodeId,
      stateSnapshot: JSON.stringify(state),
      createdAt: Date.now(),
    });
  }

  async resume(threadId: string): Promise<WorkflowState | null> {
    const records = await this.db
      .select()
      .from(schema.checkpoints)
      .where(eq(schema.checkpoints.threadId, threadId))
      .orderBy(sql`${schema.checkpoints.createdAt} DESC`)
      .limit(1);

    const record = records[0];
    if (!record) return null;
    return JSON.parse(record.stateSnapshot) as WorkflowState;
  }

  async saveAgentResult(threadId: string, nodeId: string, agentName: string, result: AgentResult) {
    await this.db.insert(schema.agentResults).values({
      id: nanoid(),
      threadId,
      nodeId,
      agentName,
      output: result.output,
      createdAt: Date.now(),
    });
  }

  async saveMemory(key: string, content: string, confidence = 1.0, sourceType = 'agent') {
    await this.db.insert(schema.memoryStore).values({
      key,
      content,
      confidence,
      sourceType,
      updatedAt: Date.now(),
    }).onConflictDoUpdate({
      target: schema.memoryStore.key,
      set: {
        content,
        confidence,
        sourceType,
        updatedAt: Date.now(),
      }
    });

    // Update FTS table manually since Triggers are cleaner but manual is safer here
    this.sqlite.prepare(`INSERT INTO memory_store_fts(rowid, key, content) VALUES (last_insert_rowid(), ?, ?)`).run(key, content);
  }

  async recallMemories(query: string, minConfidence = 0.5): Promise<string[]> {
    const results = this.sqlite.prepare(`
      SELECT m.content 
      FROM memory_store_fts f
      JOIN memory_store m ON m.rowid = f.rowid
      WHERE memory_store_fts MATCH ? 
      AND m.confidence >= ?
      ORDER BY rank
      LIMIT 10
    `).all(query, minConfidence) as { content: string }[];
    
    return results.map(r => r.content);
  }
}
