# Forge-Harness: Enterprise Agentic Engine — Implementation Plan

> Transforming Drop-in-Code-Assistant into the architecture described in [SPEC.md](file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/SPEC.md).
> All 7 design decisions resolved below.

---

## Resolved Design Decisions
### Decision 1: Composable Runtime Flows with Dynamic Model Routing

**Your direction:** Agnostic default. Support Ollama with a built-in local runtime. Lean sovereign. Support dynamic routing configurations for any external cloud provider, not just VS Code Copilot. The user must be able to configure runtime flows by switching routing patterns.

**Resolution: Dynamic runtime routing configurations via composable provider slots.**

Instead of hardcoding specific providers (like Anthropic) for the cloud execution tier, Forge uses a provider-slot map. The engine resolves standard Vercel AI SDK provider strings (e.g., `openai/gpt-4o`, `anthropic/claude-3-5-sonnet`, `groq/llama-3.1-70b`, `google/gemini-1.5-pro`).

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Dynamic Routing Pipeline                            │
│                                                                      │
│    Task Input ──► [ Model Router Classifier ]                        │
│                         │                                            │
│            ┌────────────┴────────────┐                               │
│            ▼                         ▼                               │
│      [ Local Slot ]            [ Cloud Slot ]                        │
│            │                         │                               │
│      e.g. Ollama               e.g. Groq, Together,                  │
│           (Sovereign)               Anthropic, OpenAI                │
│                                                                      │
│    * Dynamic Failover: Slot ──[fail]──► [ Fallback Slot ]            │
└──────────────────────────────────────────────────────────────────────┘
```

#### Composable Runtime Modes

Forge supports quick-switching between three runtime modes, fully configurable in the `forge.yaml` or overridden via the CLI:

1. **Sovereign Mode**: Full data privacy. Forces all agent steps and the router to run on the local `sovereign` model tier (e.g., local Ollama instance). **Zero external data egress.**
2. **Copilot Mode**: Cloud-first. Delegates orchestrator and execution steps to external cloud providers or the VS Code Copilot endpoint.
3. **Hybrid Mode (Adaptive Router)**: Uses a local model (e.g., a fast 3B parameter model) as a local complexity classifier.
   - **Simple tasks** (reading files, checking directory contents, search regex) are executed locally ($0 cost, low latency).
   - **Complex tasks** (multi-file refactors, architecture reviews, writing patches) are dynamically routed to the configured cloud provider slot.
   - This achieves **40–85% cost savings** with negligible latency overhead.

#### Config Example with Customizable Runtimes & Failover Chains

The configuration structure supports completely customizable runtime flows:

```yaml
# forge.yaml
runtime:
  mode: hybrid                          # sovereign | copilot | hybrid
  
  # Slot definitions: Map slot name to any provider string
  providers:
    sovereign:
      model: ollama/qwen2.5-coder:7b
      options:
        temperature: 0.0
        num_ctx: 16384
    router:
      model: ollama/qwen2.5-coder:3b
    cloud_fast:
      model: groq/llama-3.1-70b        # Cheap, fast cloud alternative
    cloud_frontier:
      model: anthropic/claude-3-5-sonnet
      fallback:
        - openai/gpt-4o                # Failover provider if rate-limited
        - google/gemini-1.5-pro
      options:
        temperature: 0.1

  # Routing logic rules
  hybrid_routing:
    complexity_threshold: 0.5          # Threshold for escalating to cloud_frontier
    always_local_tools:
      - read_file
      - list_dir
      - grep
    always_cloud_tools:
      - write_file                     # Force cloud for actual edits
```

#### CLI Command to Switch Modes / Providers

```bash
# Quick-switch current workspace mode
forge mode sovereign
forge mode hybrid

# Override slot model via environment variables or CLI flags
forge run --task "update tests" --mode hybrid --cloud-frontier openai/gpt-4o
```| 'cloud';
  confidence: number;         // 0-1
  reasoning: string;          // Why this route was chosen
  signals: ComplexitySignals;
}

interface ComplexitySignals {
  estimatedFileCount: number;
  estimatedTokens: number;
  taskType: 'read' | 'write' | 'refactor' | 'architecture' | 'debug';
  hasCrossCuttingConcerns: boolean;
}

export class ModelRouter {
  async classify(task: string, context: string): Promise<RoutingDecision> {
    // Use the small local model to classify complexity
    const { text } = await generateText({
      model: ollama(this.config.router),
      prompt: COMPLEXITY_CLASSIFIER_PROMPT + task,
      maxTokens: 200,  // Keep classification fast
    });
    // Parse structured response into RoutingDecision
  }

  resolveModel(decision: RoutingDecision): LanguageModel {
    if (decision.target === 'local') return ollama(this.config.local);
    return this.cloudProvider(this.config.cloud);
  }
}
```

> [!NOTE]
> **Sovereignty roadmap:** The **Headroom-inspired compression pipeline** (Phase 3b) uses content-aware routing, statistical sampling (SmartCrusher), and reversible compression (CCR) to achieve **60–95% token reduction** on tool outputs. For a local model with a 16K context window, this transforms a 65K-token debugging session from *impossible* to *comfortable*. Combined with TOIN learning (v0.3+) and cache prefix stabilization, this is the single most impactful enhancement for making Sovereign mode competitive with cloud. See [Headroom Analysis](file:///C:/Users/gabri/.gemini/antigravity-ide/brain/97d24d40-711e-4870-adff-9ee2651f2e2b/headroom_analysis.md) for full details.

---

### Decision 2: YAML Primary Config, TS Supported

**Resolution:** `forge.yaml` is the primary config format. TypeScript config (`forge.config.ts`) is supported as an escape hatch for dynamic configuration (e.g., conditional tool registration, env-based provider selection).

Loading order:
1. `forge.config.ts` (if exists, loaded via `jiti` — no `tsx` dependency needed)
2. `forge.yaml` (if exists)
3. Built-in defaults

TS config overrides YAML where both specify the same field. This lets teams commit a simple `forge.yaml` to the repo while power users extend with TypeScript.

---

### Decision 3: Safety Module Placement — Tradeoff Analysis

You asked for an explanation. Here's the full tradeoff matrix:

#### Option A: Tool-level middleware (pipeline wrapping)

The current pattern. Every tool call flows through: `permission → constraint → DLP → egress → audit → execute`.

```
Agent calls tool "write_file"
  → ToolRegistry.execute()
    → ConstraintEngine.validatePath()     ← middleware
    → DlpFilter.redact(content)           ← middleware
    → EgressPolicy.validate()             ← middleware (if network)
    → OTel span recording                 ← middleware
    → tool.execute()                      ← actual work
```

| Pros | Cons |
|------|------|
| **Per-call enforcement.** Every single tool invocation is checked — impossible to bypass. | **Coupling.** Tools and safety are interleaved — harder to test tools in isolation. |
| **Content-aware.** DLP can inspect the *actual bytes* being written, not just workflow state. | **Performance.** Extra overhead per call (though negligible for file I/O). |
| **Composable.** New safety checks (e.g., "block writes to production DB") are added as middleware without touching tool code. | **Not workflow-aware.** Can't express "DLP only matters after the review step" — it's all-or-nothing. |
| **Already proven.** The current codebase has this working. | |

#### Option B: Workflow guard functions

Safety checks live on workflow edges. A guard inspects `WorkflowState` to allow/deny transitions.

```
Workflow edge: implement → review
  guard: (state) => {
    const lastResult = state.agentResults.get('implement');
    return !containsSecrets(lastResult.output);  // ← safety as guard
  }
```

| Pros | Cons |
|------|------|
| **Workflow-aware.** Can express "only check DLP on the final output, not intermediate drafts." | **Coarse-grained.** Checks happen at node boundaries, not per-tool-call. A tool could write secrets to disk *before* the guard fires. |
| **Co-located with flow.** Safety rules live next to the workflow definition — visible, auditable. | **Reactive, not preventive.** The damage may already be done by the time the guard runs. |
| **Testable.** Guards are pure functions — easy to unit test. | **Missing content.** Guards see `WorkflowState` (structured data), not the raw bytes flowing through tools. DLP needs raw content. |

#### Recommendation: Hybrid (Option A for per-call, Option B for workflow-level)

```
┌──────────────────────────────────────────────────┐
│               Workflow Executor                   │
│  ┌─────────────┐    ┌─────────────┐              │
│  │ Guard: "no   │→→→│ Guard: "all │→→→ __end__   │
│  │ blockers"    │    │ clear"      │              │
│  └─────────────┘    └─────────────┘              │
│         ↑                                        │
│  ┌──────┴───────┐  ← workflow-level safety       │
│  │  Agent Node  │                                │
│  │  ┌────────┐  │                                │
│  │  │ Tool   │  │  ← tool-level safety           │
│  │  │Registry│  │    (constraint, DLP, egress)   │
│  │  └────────┘  │                                │
│  └──────────────┘                                │
└──────────────────────────────────────────────────┘
```

- **ConstraintEngine** → Tool-level middleware. Path/command validation MUST happen before the tool executes. Non-negotiable.
- **DlpFilter** → Tool-level middleware. Content must be scanned at the point of generation (LLM response) and at the point of egress (outbound HTTP). Guards can't do this.
- **EgressPolicy** → Tool-level middleware. Network calls must be checked before `fetch()` fires.
- **Role-based access** → Tool-level (baked into `ToolRegistry.getToolsForRole()`). The agent never even *sees* tools it can't use.
- **Iteration caps, blocker checks, analysis-before-implementation** → Workflow guards. These are flow-control decisions, not per-call security.

#### Role-Based Access: Implementation Details

To enforce role-based access without relying on the LLM to self-restrict (which is vulnerable to jailbreaks), Forge filters tools programmatically:
1. Every tool in the `ToolRegistry` is tagged with a `category` (e.g., `'write'`).
2. The core configuration defines a static `ROLE_TOOL_ACCESS` matrix matching roles to permitted categories:
   - `analysis` agents only get `read` and `search` categories.
   - `planning` agents only get `read`, `search`, and `agent` categories.
   - `implementation` agents get all categories (including `write` and `execute`).
3. When `AgentDispatcher` executes an agent, it fetches the filtered tools array `registry.getToolsForRole(role)` and supplies only those declarations to the Vercel AI SDK. The LLM is structurally unaware of forbidden tools.

#### Safety Overhead Metrics & Industry Precedent

- **Overhead Analysis**: Per-call middleware (DlpFilter regex scans, ConstraintEngine path resolution, EgressPolicy domain matching) incurs a latency overhead of **1–5ms** total. Since LLM inference latency runs between **500ms–2000ms+**, this safety check accounts for less than **0.5%** of execution time, representing a negligible impact on user experience.
- **Industry Precedent**: This model is identical to the safety proxies deployed by enterprise gateways (like GitHub Copilot Enterprise) and client harnesses (like Claude Code), which run regex lists and secret scanning filters in-memory on prompt egress and response completion.

#### True Benefits of Workflow Guards

If the tool-level policy prevents damage, what is the role of the workflow guard?
- Workflow guards are **not security boundaries**; they are **process controllers & quality gates**.
- They prevent the workflow from proceeding downstream if quality criteria are unmet, saving expensive tokens.
- **Self-Correction Routing**: A guard like `guards.lastAgentFailed` routes the graph edge back to a previous node (e.g. routing from `validate` back to `implement` if unit tests fail) to trigger autonomous debugging loops rather than failing the run.
- **Task Gating**: If the `analysis` agent produces findings with `severity: 'blocker'`, the guard `noBlockerFindings` halts the graph execution, preventing the model from writing code based on an invalid architecture.

> [!IMPORTANT]
> **Bottom line:** Tool-level middleware handles the "prevent damage" concern (real-time, per-call). Workflow guards handle the "enforce process" concern (flow-control, policy). Both are needed. This is what the best enterprise harnesses do — defense in depth.

#### "God Mode" / Trusted Execution
While enterprise safety is critical, sometimes a developer just wants raw autonomy on a trusted local repo. 
To support pure agentic internal loops without friction, Forge will include a **Trusted Mode**:
```yaml
safety:
  mode: trusted  # Disables ConstraintEngine, DLP, and Egress middlewares
```
In this mode, the agent's internal loop runs at maximum speed with full OS access, matching Hermes' unrestricted autonomy.

---

### Decision 4: MCP Architecture — Symbiotic Dual-Path

**Your direction:** We want symbiosis. Forge-Harness should function as both an MCP server and an MCP client to maintain integration with VS Code Copilot while extending features using external MCPs.

**Resolution: Symbiotic Dual-Path.**

Forge maintains both endpoints:
1. **MCP Client**: Used to connect to external enterprise tool servers (Jira, GitHub, Slack) via `connectMcpServer()`. Forge consumes these tools and exposes them to the active agents depending on their roles.
2. **MCP Server**: Refactored (rather than deleted) inside `src/copilot/`. Exposes Forge's workflow executor to VS Code Copilot/IDE extensions. This allows the IDE's Copilot instance to call Forge-Harness as a tool, delegating complex tasks to it.

```
┌─────────────────┐             ┌───────────────┐             ┌───────────────────┐
│ VS Code Copilot │ ──[MCP]───► │ Forge Engine  │ ───[MCP]──► │ External Servers  │
│  (Orchestrator)  │   (Server)  │ (Orchestrator)│   (Client)  │   (Jira, GitHub)  │
└─────────────────┘             └───────────────┘             └───────────────────┘
```

This retains the local MCP integration layout without code duplication.

Files kept and refactored: `src/copilot/mcp-server.ts`, `src/copilot/mcp-tools.ts`. Files to delete: none.

---

### Decision 5: Web Tools — Following Industry Convention

**Research finding:** Yes, `web_fetch` and `web_search` are **standard conventions** among leading harnesses:

| Harness | Built-in HTTP Tool | Name | Scope |
|---------|-------------------|------|-------|
| **Claude Code** | ✅ | `WebFetch`, `WebSearch` | URL fetch + content extraction, web search |
| **Codex (OpenAI)** | ✅ | Built-in web search + browser automation | Search + interactive browsing |
| **OpenCode** | ✅ | Via MCP (mcp-server-fetch) | HTTP requests via MCP |
| **Continue.dev** | ✅ | `@web` context provider | URL fetching as context |

**Resolution:** Include `web_fetch` as a built-in tool in the `web` category. Do NOT include a generic `httpRequest` — that's too broad and a security risk. Instead:

- `web_fetch` — fetches a URL, converts HTML to markdown, returns content. Category: `web`. Uses egress policy for domain validation.
- `web_search` — search query → results. Category: `web`. Deferred to v0.3 (requires search API integration).

The old `httpRequest` tool (arbitrary HTTP with custom headers/body) is removed. If teams need that, they use MCP servers (e.g., `@modelcontextprotocol/server-fetch`) — exactly the Codex/OpenCode pattern.

---

### Decision 6: Deep Testing — Unit + Integration + Mock LLM Harness

**Resolution:** Three-tier test strategy:

| Tier | Scope | Framework | Mock Strategy |
|------|-------|-----------|---------------|
| **Unit** | Individual functions/classes | Vitest | Zod schemas, pure function testing |
| **Integration** | Multi-module flows (agent → tools → registry) | Vitest | Mock LLM provider that returns deterministic tool calls |
| **E2E** | Full workflow execution | Vitest | Mock Vercel AI SDK `generateText()` with scripted responses |

**Mock LLM provider:**

```typescript
// tests/helpers/mock-provider.ts
import { createMockLanguageModel } from 'ai/test';

export function createScriptedModel(responses: string[]) {
  let callIndex = 0;
  return createMockLanguageModel({
    doGenerate: async () => ({
      text: responses[callIndex++] ?? 'done',
      toolCalls: [], // or scripted tool calls
      usage: { promptTokens: 100, completionTokens: 50 },
    }),
  });
}
```

Vercel AI SDK provides `ai/test` with `MockLanguageModelV1` — purpose-built for testing agent loops without real LLM calls.

---

### Decision 7: Robust Two-Tier Persistence Architecture

**Your direction:** Most robust option possible. Rival the best harnesses for context management and memory persistence.

**Resolution: Two-tier architecture — `better-sqlite3` + Drizzle ORM for durable state, in-memory layer for active execution.**

```
┌──────────────────────────────────────────────────────────────────┐
│                         Persistence Layer                        │
│                                                                  │
│  ┌──────────────────────┐    ┌─────────────────────────────────┐ │
│  │   Active Memory      │    │    Durable Store                │ │
│  │   (in-process)       │    │    (SQLite via better-sqlite3)  │ │
│  │                      │    │                                 │ │
│  │  • WorkflowState     │◄──►│  • Checkpoints table           │ │
│  │  • Agent context     │    │  • Workflow runs table          │ │
│  │  • Tool call cache   │    │  • Agent results table          │ │
│  │  • Token budget      │    │  • Context snapshots table      │ │
│  │                      │    │  • Memory store table           │ │
│  └──────────────────────┘    └─────────────────────────────────┘ │
│            ↕                              ↕                      │
│     checkpoint()                   resume(threadId)              │
│     every N steps                  on process restart            │
└──────────────────────────────────────────────────────────────────┘
```

#### Why `better-sqlite3` + Drizzle (not raw JSON files):

| Approach | Crash Recovery | Query Speed | Concurrent Access | Context Search |
|----------|---------------|-------------|-------------------|----------------|
| JSON files | ❌ Partial writes corrupt state | ❌ Full file read every time | ❌ Race conditions | ❌ Full file scan |
| `better-sqlite3` | ✅ WAL mode — atomic writes | ✅ Indexed queries in <1ms | ✅ WAL allows concurrent reads | ✅ SQL queries on structured data |
| PostgreSQL | ✅ Full ACID | ✅ Fast | ✅ True multi-writer | ✅ Full SQL | Overkill for single-machine harness |

#### Schema (via Drizzle ORM):

```typescript
// src/persistence/schema.ts
import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),               // nanoid
  threadId: text('thread_id').notNull(),      // workflow run instance
  nodeId: text('node_id').notNull(),          // which workflow node
  stepIndex: integer('step_index').notNull(), // position in execution
  state: text('state', { mode: 'json' }).notNull(),  // serialized WorkflowState
  createdAt: text('created_at').notNull(),
});

export const agentResults = sqliteTable('agent_results', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  agentName: text('agent_name').notNull(),
  role: text('role').notNull(),
  output: text('output').notNull(),           // agent's response
  findings: text('findings', { mode: 'json' }),  // structured findings
  tokenUsage: text('token_usage', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
});

export const contextSnapshots = sqliteTable('context_snapshots', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  summary: text('summary').notNull(),         // compressed context
  fullContext: text('full_context'),           // raw context (prunable)
  tokenCount: integer('token_count').notNull(),
  createdAt: text('created_at').notNull(),
});

export const memoryStore = sqliteTable('memory_store', {
  id: text('id').primaryKey(),
  threadId: text('thread_id'),                // null = global memory
  key: text('key').notNull(),                 // e.g., "user_preference", "code_pattern"
  value: text('value').notNull(),
  confidence: integer('confidence'),          // 0-100, for selective promotion
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at'),              // retention policy
});
```

#### What this enables for v0.3+ context management:

1. **Crash resume** — workflow executor checks for existing checkpoint on `threadId`. If found, resumes from last successful node.
2. **Context compaction** — when token count exceeds the model's window, the system generates a summary of older context and stores it in `contextSnapshots`. Only the summary is injected into the prompt.
3. **Selective memory** — findings, decisions, and patterns are stored in `memoryStore` with confidence scores. High-confidence items are promoted into future workflow contexts. Low-confidence items decay and are pruned.
4. **Token budget tracking** — every agent result records token usage. The engine can enforce per-workflow or per-team budgets.

> [!NOTE]
> **Database Pluggability: Why not Postgres?** 
> Drizzle ORM abstracts SQL calls behind generic table models.
> - **SQLite (`better-sqlite3`)** remains the default for zero-config local developer environments (no server dependencies).
> - **PostgreSQL** is fully supported. Teams can swap SQLite for Postgres by changing the connection parameters in `forge.yaml` or supplying a `DATABASE_URL` connection string. Drizzle resolves the appropriate dialects dynamically, making Postgres support pluggable out of the box for team deployments.

**New dependencies:** `better-sqlite3`, `pg`, `@types/pg`, `drizzle-orm`, `drizzle-kit` (dev, for migrations).

---

### Decision 8: Advanced Persistence & Adaptive Reasoning (Bleeding Edge Roadmap)

Beyond the core two-tier persistence, these are the bleeding-edge patterns we're designing the schema to support and will progressively implement across v0.3–v1.0.

#### Cognitive Memory Taxonomy (CoALA Framework)

The industry has converged on a cognitive science taxonomy for agent memory. Our persistence layer maps directly to it:

```
┌────────────────────────────────────────────────────────────────────┐
│                   Forge Memory Architecture                        │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  WORKING MEMORY (In-Process)                                 │  │
│  │  • Current prompt context window                             │  │
│  │  • Active tool results / agent state                         │  │
│  │  • Token budget tracker                                      │  │
│  │  Maps to: WorkflowState (in-memory)                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↕                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  EPISODIC MEMORY (Event-based)                               │  │
│  │  • Sequences of past decisions & their outcomes              │  │
│  │  • "What happened last time we tried X"                      │  │
│  │  • Audit trail for why an agent reached a state              │  │
│  │  Maps to: checkpoints + agentResults tables                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↕                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  SEMANTIC MEMORY (Knowledge-based)                           │  │
│  │  • Distilled facts: "this repo uses ESM, not CJS"           │  │
│  │  • User preferences: "always use single quotes"              │  │
│  │  • Codebase patterns: "services follow repository pattern"   │  │
│  │  Maps to: memoryStore table (key-value with confidence)      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↕                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  PROCEDURAL MEMORY (How-to)                                  │  │
│  │  • Learned workflows: "deploy = build → test → push"        │  │
│  │  • Tool strategies: "use grep before read_file"              │  │
│  │  • Agent instructions (system prompts)                       │  │
│  │  Maps to: agent definitions + workflow graphs                │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

#### Knowledge Consolidation Pipeline (v0.3)

Raw episodic logs are noisy. The consolidation pipeline distills them into reusable semantic knowledge:

```
Episodic Memory (raw)                Semantic Memory (distilled)
┌────────────────────┐               ┌────────────────────────┐
│ Agent tried ESM    │               │                        │
│ import, got error. │  ──extract──► │ FACT: "This repo uses  │
│ Switched to CJS    │  ──validate─► │ CJS require() syntax"  │
│ require(). Worked. │  ──promote──► │ Confidence: 95         │
└────────────────────┘               │ ValidFrom: 2026-06-26  │
                                     └────────────────────────┘
```

Stages:
1. **Extract** — after each agent run, scan results for candidate facts (patterns, errors, preferences)
2. **Validate** — cross-reference against existing semantic memory (does this contradict known facts?)
3. **Promote** — if novel and high-confidence, add to `memoryStore` with temporal validity
4. **Decay** — low-confidence items that are never reinforced expire via `expiresAt`

#### Temporal Validity & Cascade Invalidation (v0.4)

Memory entries carry validity windows. When a new fact contradicts an existing one, the old fact is invalidated and all dependent memories are flagged for review:

```typescript
// Extended memoryStore schema (v0.4)
export const memoryStore = sqliteTable('memory_store', {
  // ... existing fields ...
  validFrom: text('valid_from'),              // When this fact became true
  validUntil: text('valid_until'),            // When it was superseded
  supersededBy: text('superseded_by'),        // ID of the replacing fact
  sourceType: text('source_type'),            // 'observed' | 'inferred' | 'user_stated'
  dependsOn: text('depends_on', { mode: 'json' }),  // IDs of facts this derives from
});
```

Example cascade: User says "we switched from Jest to Vitest" → system invalidates all Jest-related procedural memories → flags test-related workflow configurations for review.

#### Adaptive Reasoning Strategies (v0.3–v0.4)

Beyond model routing, the harness adapts its *reasoning strategy* per task:

| Strategy | When | How |
|----------|------|-----|
| **Direct completion** | Simple, well-defined tasks (file reads, linting) | Single `generateText()` call, no chain-of-thought |
| **Chain-of-Thought** | Medium complexity (single-file edits) | Enable CoT via prompt engineering |
| **Plan-and-Execute** | Complex tasks (multi-file refactors) | Separate planning agent → execution agent |
| **Reflection loop** | High-stakes tasks (architecture changes) | Agent reviews its own output → iterates |
| **Retrieval-Augmented** | Large codebase, unfamiliar context | Inject relevant semantic memories + grep results before reasoning |

The `ModelRouter` (in Hybrid mode) selects both the **model** and the **reasoning strategy** based on the complexity classification. This is the "strategy routing" pattern from 2026 research — selecting not just *who* answers, but *how* they answer.

#### Bleeding-Edge Persistence Methods (Research Notes)

These are patterns we're tracking for v0.4–v1.0:

| Method | What It Is | Framework Example | Our Plan |
|--------|-----------|-------------------|----------|
| **Graph RAG** | Store knowledge as entity-relationship graphs, not flat vectors | Graphiti, Neo4j | v0.4 — `memoryStore` gets `dependsOn` field for relationship tracking |
| **Temporal Knowledge Graphs** | Every fact has `validFrom`/`validUntil` windows | Graphiti | v0.4 — schema extension above |
| **Cascade Invalidation** | New facts auto-invalidate contradictory old facts | Zep/Graphiti | v0.4 — `supersededBy` chain |
| **Memory Consolidation** | Distill raw episodes into structured semantic knowledge | Letta, LangMem | v0.3 — post-run extraction pipeline |
| **Selective Promotion** | Only inject high-confidence, relevant memories into context | Mem0 | v0.2 — `confidence` score in `memoryStore` |
| **Context Compaction** | Summarize old context to fit smaller windows | Context Engineering | v0.2 — `contextSnapshots` table |
| **Reaper Daemons** | Background process that prunes expired/low-value memories | EverOS | v0.4 — `pruneOldCheckpoints()` + memory TTL |
| **KV-Cache Prefix Reuse** | Reuse computed tokens for system prompts across calls | Ollama `num_keep` | v0.3 — Ollama-specific optimization |

> [!TIP]
> **The sovereignty angle:** These persistence patterns are *especially* important for Sovereign mode. Cloud models have massive context windows (200K+ tokens) that paper over inefficient context management. Local models (8K-32K) force you to be *surgically precise* about what goes into the window. Our cognitive memory system + context compaction is the key to making Sovereign mode competitive with cloud for real-world tasks.

---

## Updated Gap Analysis

> [!IMPORTANT]
> This section is unchanged from the original plan — see below for the full file map and phase breakdown.

### What Exists Today (Drop-in-Code-Assistant)

| Layer | What's Built | LOC |
|-------|-------------|-----|
| **Orchestrator** | Single-agent loop calling Ollama with 3 hardcoded tools | ~190 |
| **Patch Engine** | Propose → validate → checkpoint → apply → rollback pipeline | ~230 |
| **Tool Pipeline** | Centralized pipeline: permission → constraint → DLP → egress → audit → execute | ~320 |
| **Safety Suite** | ConstraintEngine, PermissionPolicy, EgressPolicy, DlpFilter, AuditLogger | ~600 |
| **Config System** | Zod-validated YAML config with global/repo merge + tamper detection | ~550 |
| **State Management** | TaskSpecManager, StateHydrator, HeartbeatTimer | ~680 |
| **MCP Server** | Exposes 10 tools to VS Code Copilot via stdio transport | ~530 |
| **CLI** | Commander.js with 13 commands | ~670 |
| **Total** | | **~3,770 LOC** |

### What We Keep & Adapt

| Module | Strategy |
|--------|----------|
| [constraint-engine.ts](file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/src/safety/constraint-engine.ts) | **Keep.** Tool-level middleware for path/command validation. |
| [dlp-filter.ts](file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/src/safety/dlp-filter.ts) | **Keep.** Tool-level middleware for secret redaction on LLM I/O. |
| [egress-policy.ts](file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/src/safety/egress-policy.ts) | **Keep.** Tool-level middleware for network egress. |
| [config/schema.ts](file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/src/config/schema.ts) | **Partially keep.** Execution limits, permission levels reusable. |
| [config/loader.ts](file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/src/config/loader.ts) | **Adapt.** YAML loading logic preserved, extended for `forge.yaml`. |
| [patch-engine.ts](file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/src/core/patch-engine.ts) | **Refactor.** Checkpoint/rollback → `write_file` tool implementation. |
| `src/copilot/` | **Keep and refactor.** Retained to serve symbiotic Copilot integration. |

### What We Delete

| Module | Why |
|--------|-----|
| `src/core/orchestrator.ts` | Hardcoded Ollama, replaced by AgentDispatcher + Vercel AI SDK |
| `src/core/lifecycle.ts` | Linear FSM replaced by DAG guards |
| `src/state/task-spec-manager.ts` | Markdown state files → SQLite persistence |
| `src/state/state-hydrator.ts` | HOT/WARM/COLD → WorkflowState + context compaction |
| `src/state/heartbeat-timer.ts` | Ownership locking deferred to v0.4 |
| `src/safety/audit-logger.ts` | JSONL → OpenTelemetry spans |
| `src/safety/permission-policy.ts` | Subsumed into role-based tool access |
| `src/tools/tool-pipeline.ts` | Logic distributed into tool registry + safety middleware |
| `src/cli/app.ts` | Rewritten as `src/cli/index.ts` |
| `src/cli/screens/`, `src/cli/components/` | No interactive UI in Forge |

---

## Proposed Changes

### Phase 0 — Rename, Restructure, Dependencies

#### [MODIFY] `package.json`
- Rename `@agent-engine/core` → `forge-engine`
- Update `bin`: `agent-engine` → `forge`
- **Add production deps:** `ai`, `ai-sdk-ollama`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `nanoid`, `pino`, `better-sqlite3`, `drizzle-orm`
- **Add dev deps:** `drizzle-kit`, `@types/better-sqlite3`
- **Remove deps:** `crypto-js`, `chokidar`, `@types/react`
- **Keep deps:** `ink`, `ink-text-input`, `figures`, `@inquirer/prompts`, `@modelcontextprotocol/sdk`, `commander`, `zod`, `yaml`, `diff` (Retaining TUI deps for Hermes-style UX)
- Update `engines.node` → `>=22.0.0`
- Update scripts: `"forge": "node dist/cli/index.js"`, `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`

#### [MODIFY] [tsconfig.json](file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/tsconfig.json)
- Target `ES2024`, remove `jsx` (no React)
- Add `noUncheckedIndexedAccess`, `noUnusedLocals`, `noImplicitReturns`

#### [NEW] Target directory structure
```
src/
├── index.ts                     # Public API barrel exports
├── engine.ts                    # ForgeEngine composition root
├── core/
│   ├── types.ts                 # Branded IDs, roles, categories, runtime modes
│   ├── tools/
│   │   ├── types.ts             # Tool interface, ToolResult
│   │   ├── tool-registry.ts     # Registry with role-based filtering + OTel + safety middleware
│   │   ├── native.ts            # defineTool() factory
│   │   ├── mcp-adapter.ts       # connectMcpServer() — MCP client
│   │   └── index.ts
│   ├── agents/
│   │   ├── types.ts             # AgentDefinition schema, AgentResult, Finding
│   │   ├── registry.ts          # Agent store
│   │   ├── dispatcher.ts        # LLM tool-use loop via Vercel AI SDK
│   │   ├── model-router.ts      # Hybrid mode complexity classifier + model selection
│   │   └── index.ts
│   ├── compression/             # Headroom-inspired modular compression pipeline
│   │   ├── types.ts             # CompressionPipeline interface, CompressionContext/Result
│   │   ├── content-router.ts    # Content-type classifier → compressor dispatch
│   │   ├── smart-crusher.ts     # JSON array statistical sampling + anomaly preservation
│   │   ├── ccr-store.ts         # Compress-Cache-Retrieve — hash-indexed original store
│   │   ├── pipeline.ts          # ForgeCompressionPipeline — built-in default impl
│   │   └── index.ts
│   └── workflows/
│       ├── types.ts             # DAG types, WorkflowState
│       ├── graph.ts             # defineWorkflow() fluent builder
│       ├── executor.ts          # DAG traversal engine
│       ├── guards.ts            # Built-in guard functions
│       └── index.ts
├── persistence/
│   ├── schema.ts                # Drizzle table definitions (cognitive memory + compression cache)
│   ├── store.ts                 # ForgeStore — checkpoint/resume/memory API
│   ├── consolidator.ts          # Knowledge consolidation pipeline (v0.3)
│   ├── migrations/              # Drizzle migration files
│   └── index.ts
├── observability/
│   ├── tracer.ts                # OTel SDK initialization
│   └── index.ts
├── safety/                      # Preserved + adapted
│   ├── constraint-engine.ts     # Path/command validation
│   ├── dlp-filter.ts            # Secret redaction
│   ├── egress-policy.ts         # Network egress control
│   └── index.ts
├── config/
│   ├── schema.ts                # Zod schemas for forge.yaml (incl. runtime modes + compression)
│   ├── loader.ts                # YAML + TS config loader
│   └── index.ts
├── tools/                       # Built-in tool implementations
│   ├── read-file.ts
│   ├── write-file.ts
│   ├── bash.ts
│   ├── grep.ts
│   ├── list-dir.ts
│   ├── web-fetch.ts
│   ├── ccr-retrieve.ts          # Built-in CCR retrieval tool (injected when compression active)
│   ├── skill-manage.ts          # Hermes-inspired autonomous skill creation tool
│   └── index.ts
└── cli/
    └── index.ts                 # Commander.js CLI (with --mode flag)
```

---

### Phase 1 — Core Type System & Tool Infrastructure

#### [NEW] `src/core/types.ts` (~100 LOC)
- Branded ID types: `AgentId`, `WorkflowId`, `ToolId` using `nanoid`
- Role enum: `analysis | planning | implementation | review | orchestration`
- Tool category enum: `read | write | execute | search | web | agent`
- `ROLE_TOOL_ACCESS` matrix (spec's table, line 328-334)
- `FindingSeverity`: `blocker | warning | info`

#### [NEW] `src/core/tools/types.ts` (~80 LOC)
- `Tool<TInput, TOutput>` interface (spec lines 206-213)
- `ToolResult<T>` — success/error envelope
- `ToolSource` — `{ type: 'native' } | { type: 'mcp', serverName: string }`
- `NativeToolConfig<T>` — input for `defineTool()`
- `ToolExecutionContext` — OTel span, working directory, DLP filter ref

#### [NEW] `src/core/tools/native.ts` (~85 LOC)
- `defineTool(config)` — Zod schema + handler → `Tool`
- Zod → JSON Schema conversion for LLM tool parameter descriptions
- Automatic OTel span wrapping

#### [NEW] `src/core/tools/tool-registry.ts` (~130 LOC)
- `ToolRegistry` class with role-based filtering
- `register(tool)`, `registerAll(tools)`, `get(name)`, `list()`
- **`getToolsForRole(role)`** — the core access control enforcement
- Safety middleware integration:
  - ConstraintEngine on file-path parameters
  - DlpFilter on tool outputs (before they reach the LLM)
  - EgressPolicy on web/network tools
- OTel span per tool execution

#### [NEW] `src/core/tools/mcp-adapter.ts` (~135 LOC)
- `connectMcpServer(config)` — connects to external MCP servers as **client**
- Supports `stdio` and `http` (Streamable HTTP) transports
- Maps MCP tool schemas to unified `Tool` interface
- Returns `{ tools: Tool[], connection: McpConnection }`

---

### Phase 2 — Agent System, LLM Integration & Model Router

#### [NEW] `src/core/agents/types.ts` (~85 LOC)
- `AgentDefinitionSchema` — Zod schema for agent definitions
  - `name`, `description`, `role`, `model?`, `instructions`, `maxIterations`, `outputFormat`
- `AgentResult` — status, output, findings array, token usage
- `FindingSchema` — severity, message, evidence, verifiable command
- `RuntimeMode` — `'sovereign' | 'copilot' | 'hybrid'`
- `RoutingDecision` — target model, confidence score, complexity signals

#### [NEW] `src/core/agents/registry.ts` (~40 LOC)
- `AgentRegistry` — validated definition store
- `register(def)`, `get(name)`, `list()`

#### [NEW] `src/core/agents/model-router.ts` (~120 LOC)
- `ModelRouter` class — complexity-based adaptive routing for Hybrid mode
- `classify(task, context)` — uses small local model to score complexity (0-1)
- `resolveModel(decision)` — returns appropriate Vercel AI SDK model instance
- Complexity signals: estimated file count, token budget, task type, cross-cutting concerns
- `always_local` / `always_cloud` overrides from config
- OTel span: `model.route` with `routing.decision`, `routing.confidence` attributes
- In Sovereign mode: always returns local model (no classification needed)
- In Copilot mode: always returns cloud model (no classification needed)

#### [NEW] `src/core/agents/dispatcher.ts` (~220 LOC)
- `AgentDispatcher` — the LLM tool-use loop
- Uses Vercel AI SDK `generateText()` with `maxSteps` for multi-step tool calling
- **Runtime mode integration** — consults `ModelRouter` to resolve model per dispatch
- Ollama integration via `ai-sdk-ollama` — same `generateText()` interface
- DLP filter on system prompt + LLM responses
- OTel span: `agent.dispatch` with `gen_ai.*` attributes + routing metadata
- Iteration cap enforcement
- Structured `AgentResult` output
- Records routing decision in agent result for observability

---

### Phase 3 — Workflow Engine (DAG) & Persistence

#### [NEW] `src/core/workflows/types.ts` (~90 LOC)
- `WorkflowGraph` — validated DAG definition
- `WorkflowNode` — nodeId → agentName mapping
- `WorkflowEdge` — source, target, guard?, maxTraversals?
- `WorkflowState` — the accumulated execution state:
  - `currentNodeId`, `visitedNodes`, `edgeTraversalCounts`
  - `agentResults: Map<string, AgentResult[]>`
  - `status: 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled'`
- `WorkflowRunRecord` — timing, steps, final status

#### [NEW] `src/core/workflows/graph.ts` (~115 LOC)
- `defineWorkflow(id, description)` — fluent builder
- `.node(id, agentName)`, `.edge(from, to, opts?)`, `.withMaxSteps(n)`, `.build()`
- Build-time validation: reachability, `__start__`/`__end__` existence, cycle detection with maxTraversals exceptions

#### [NEW] `src/core/workflows/executor.ts` (~200 LOC)
- `WorkflowExecutor` — DAG traversal engine
- `execute(graph, initialInput, options?)` — main loop
- Guard evaluation on outgoing edges
- Agent dispatch via `AgentDispatcher`
- State accumulation after each node
- **Checkpoint integration** — saves state to `ForgeStore` after each node
- **Resume support** — `execute()` checks for existing checkpoint on `threadId`
- OTel span per node traversal and full workflow

#### [NEW] `src/core/workflows/guards.ts` (~65 LOC)
- `guards.analysisCompleted`
- `guards.noBlockerFindings`
- `guards.hasBlockerFindings`
- `guards.lastAgentSucceeded`
- `guards.lastAgentFailed`
- `guards.withinStepLimit(n)`

#### [NEW] `src/persistence/schema.ts` (~100 LOC)
- Drizzle table definitions: `checkpoints`, `agentResults`, `contextSnapshots`, `memoryStore`, `compressionCache`
- Schema designed for cognitive memory taxonomy (episodic → agentResults/checkpoints, semantic → memoryStore, procedural → agent definitions)
- `memoryStore` includes `confidence`, `sourceType`, `validFrom`, `expiresAt` fields for temporal validity
- **`memoryStore_fts`**: SQLite FTS5 (Full-Text Search) virtual table tied to `memoryStore` for rapid cross-session recall (Hermes pattern)
- **`compressionCache`** — hash-indexed store for CCR (reversible compression):
  - `hash` (PK), `originalContent`, `compressedTokens`, `originalTokens`
  - `contentType` (json_array, log, etc.), `toolName` (for TOIN learning)
  - `accessedAt` (LRU eviction), `retrievalCount` (tracks how often LLM needs full data)
- Indexes on `threadId`, `key`, `confidence` for efficient retrieval

#### [NEW] `src/persistence/store.ts` (~150 LOC)
- `ForgeStore` class
- `checkpoint(threadId, nodeId, state)` — save state snapshot (episodic memory)
- `resume(threadId)` — load latest checkpoint
- `getHistory(threadId)` — all checkpoints for a run
- `saveAgentResult(result)` — persist agent output
- `saveMemory(key, value, opts)` — save semantic memory with confidence + source type
- `recallMemories(query, opts)` — retrieve relevant memories by key pattern, confidence threshold
- `pruneOldCheckpoints(maxAge)` — retention policy
- `pruneExpiredMemories()` — remove memories past `expiresAt`
- Auto-initialization: creates SQLite DB at `.forge/forge.db`

#### [NEW] `src/persistence/consolidator.ts` (~80 LOC, scaffolded in v0.2, implemented in v0.3)
- `KnowledgeConsolidator` class — post-run extraction pipeline
- `extractCandidates(agentResults)` — scan for facts, patterns, preferences
- `validate(candidates, existingMemories)` — check for contradictions
- `promote(validated)` — write to `memoryStore` with confidence scores
- Scaffolded with interface + no-op implementation in v0.2; full implementation in v0.3

---

### Phase 3b — Compression Pipeline (Headroom-Inspired)

> **Strategy:** Native implementation behind a modular `CompressionPipeline` interface. Three modes: `'builtin'` (default), `'none'` (off), or user-provided custom pipeline. See [Headroom Analysis](file:///C:/Users/gabri/.gemini/antigravity-ide/brain/97d24d40-711e-4870-adff-9ee2651f2e2b/headroom_analysis.md) for full design rationale.

#### [NEW] `src/core/compression/types.ts` (~60 LOC)
- `CompressionPipeline` interface — the single strategy contract:
  - `compress(content, context): Promise<CompressionResult>` — must never throw; return original on failure
  - `retrieve?(hash, query?): Promise<string | null>` — optional CCR retrieval
  - `getStats?(): CompressionStats` — optional telemetry
- `CompressionContext` — `contentType` (tool_result/user_message/system/assistant), `toolName`, `tokenBudget`, `role`
- `CompressionResult` — `content`, `compressed`, `tokensBefore`, `tokensAfter`, `ccrHash?`, `contentType?`
- `CompressionStats` — `totalCompressions`, `totalTokensSaved`, `totalRetrievals`, `averageCompressionRatio`

**Design rules:**
- Interface is async — external pipelines may need network calls
- `compress()` must return original content unchanged on failure (Invariant I1)
- `context.contentType` lets pipeline skip user messages and system prompts (Invariant I2)

#### [NEW] `src/core/compression/content-router.ts` (~100 LOC)
**Headroom pattern: ContentRouter**
- Classifies tool output content type: `json_array`, `log_output`, `code`, `text`, `short`
- Routes to appropriate compressor (SmartCrusher for JSON, passthrough for code/short)
- Content under 200 tokens passes through unchanged (overhead exceeds savings)
- Fail-safe: if classification fails, return `short` (passthrough)

#### [NEW] `src/core/compression/smart-crusher.ts` (~200 LOC)
**Headroom pattern: SmartCrusher** — the highest-ROI compressor (70–95% savings on JSON arrays)

Algorithm:
1. Parse JSON arrays from tool results
2. Factor out constant fields shared by all items (schema extraction)
3. Detect anomalies (errors, warnings) — **always preserve unconditionally**
4. Select representative subset: 30% from start (schema), 15% from end (recency), 55% by variance/importance score
5. Emit compressed output with CCR marker: `[N items compressed to M. Retrieve: hash=abc123]`

Configuration:
- `minTokensToCrush: 200` — skip small content
- `maxItemsAfterCrush: 50` — max retained items
- `preserveErrors: true` — always keep error/warning items regardless of budget

#### [NEW] `src/core/compression/ccr-store.ts` (~120 LOC)
**Headroom pattern: CCR (Compress-Cache-Retrieve)** — reversible compression
- `store(content, meta): string` — hash content, persist to `compressionCache` table, return hash
- `retrieve(hash): string | null` — fetch original by hash, update `accessedAt` + `retrievalCount`
- `retrieveWithQuery(hash, query): string | null` — filtered retrieval within cached data
- `prune(maxAge): number` — evict entries older than maxAge (LRU by `accessedAt`)
- Uses SHA-256 hashing for content-addressable storage
- Backed by `compressionCache` table in ForgeStore's SQLite database

#### [NEW] `src/core/compression/pipeline.ts` (~80 LOC)
**`ForgeCompressionPipeline`** — the built-in default implementation of `CompressionPipeline`
- Wires together ContentRouter → SmartCrusher → CCR Store
- Implements all three interface methods (`compress`, `retrieve`, `getStats`)
- Skips compression for `user_message` and `system` content types
- Tracks cumulative compression statistics for dashboard/telemetry

#### [NEW] `src/tools/ccr-retrieve.ts` (~50 LOC)
**Built-in CCR retrieval tool** — injected into the LLM's tool list when compression is active
- Tool name: `ccr_retrieve`
- Schema: `{ hash: string, query?: string }`
- Category: `read` (available to all agent roles)
- Handler: delegates to `CompressionPipeline.retrieve()`

#### [MODIFY] `src/core/agents/dispatcher.ts`
- Add `compressionPipeline` dependency (injected from ForgeEngine)
- Before sending tool results to LLM: `pipeline.compress(toolResult, context)`
- If pipeline is `'none'`, skip compression entirely
- If pipeline has `retrieve`, inject `ccr_retrieve` tool into the active tool list
- **Hermes Pattern: Tiered Prompt Assembly & Stacking Caches**:
  - Forge stacks provider-level caching *on top* of the Headroom compression pipeline.
  - `Stable Tier` (System Identity, Profiles, Role, Tools).
  - `Context Tier` (Memory hits, loaded files, created skills).
  - `Volatile Tier` (Immediate tool outputs).
  - **Anthropic Integration:** The dispatcher dynamically inserts `cache_control: {"type": "ephemeral"}` blocks at the boundary of the Stable and Context tiers. This triggers Anthropic's Prompt Caching (saving 90% on input costs for large contexts).
  - **Ollama Integration:** The strict tiering ensures the prefix remains identical byte-for-byte across steps, triggering Ollama's KV-cache reuse (`num_keep`), drastically reducing local inference time.
  - **Truncation:** If the compressed prompt still exceeds context limits, the `contextSnapshots` module engages, summarizing the oldest volatile turns into a single semantic block.
- **Hermes Pattern: Interactive UX & Steering**:
  - **Streaming Thoughts:** The dispatcher uses `streamText()` instead of `generateText()`. It streams the model's text generation (e.g., `<think>` tags and reasoning) directly to the TUI so the user can observe the agent's logic in real time.
  - **Interrupt & Redirect:** The dispatcher traps `SIGINT` (Ctrl+C). Instead of killing the process, it pauses the `maxSteps` loop, prompts the user via the TUI ("Enter steering feedback or press Ctrl+C again to abort"), and injects the user's feedback into the `Volatile Tier` as a user message before resuming the loop.

#### [MODIFY] `src/config/schema.ts`
- Add `CompressionConfigSchema`:
  ```yaml
  compression:
    pipeline: builtin        # builtin | none | (custom via forge.config.ts)
    builtin:
      minTokensToCrush: 200
      maxItemsAfterCrush: 50
      preserveErrors: true
      ccrEnabled: true
  safety:
    mode: strict             # strict (all middlewares active) | trusted (no guardrails)
  ```
- Custom pipelines configured via `forge.config.ts` (TypeScript escape hatch) — user provides a `CompressionPipeline` object

#### [MODIFY] `src/engine.ts`
- Resolve compression pipeline from config:
  - `'builtin'` → instantiate `ForgeCompressionPipeline` with config
  - `'none'` → null (no compression)
  - `CompressionPipeline` instance → use directly
- Pass resolved pipeline to `AgentDispatcher`
- Add `engine.compressionStats()` method for dashboard integration

#### Cache-Safety Invariants (enforced in all compression code)

| # | Invariant | Implementation |
|---|-----------|---------------|
| I1 | **Byte-faithful passthrough** | `compress()` returns original content unchanged if no compressor matches or compression fails |
| I2 | **Frozen zone is sacred** | System prompts, user messages, and tool schemas are never compressed |
| I3 | **Append-only** | Once a message has been sent to the LLM, its compressed form is frozen for subsequent steps |
| I4 | **Safety-first** | All compressed content passes through DLP filter before reaching the LLM |

---

### Phase 4 — Engine, Observability, Config & CLI

#### [NEW] `src/engine.ts` (~160 LOC)
- `ForgeEngine` — composition root
  - `tools: ToolRegistry`
  - `agents: AgentRegistry`
  - `dispatcher: AgentDispatcher`
  - `router: ModelRouter`
  - `store: ForgeStore`
  - `tracer: ForgeTracer`
  - `mode: RuntimeMode` — current runtime mode
- `createForgeEngine(config)` factory
  - Accepts runtime mode + model configs per mode
  - Initializes ModelRouter for Hybrid mode
  - Initializes OTel, creates registries, SQLite store
  - Wires safety middleware into tool registry
- `engine.registerAgent(definition)`
- `engine.runWorkflow(graph, { task, threadId?, mode? })` — mode override per-run
- `engine.runAgent(agentName, { task, mode? })`
- `engine.switchMode(mode)` — runtime mode quick-switch

#### [NEW] `src/observability/tracer.ts` (~55 LOC)
- OTel SDK initialization with GenAI semantic conventions
- OTLP HTTP exporter (configurable endpoint)
- `getTracer()`, `createSpan()` helpers
- Attributes: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`

#### [MODIFY] `src/config/schema.ts` — extend for Forge
- Add `RuntimeConfigSchema` — mode (sovereign/copilot/hybrid) + per-mode model configs
- Add `HybridConfigSchema` — router model, local model, cloud model, complexity threshold, always_local/always_cloud lists
- Add persistence config (db path, retention, memory TTL)
- Add tracing config (otlp endpoint, enabled flag)
- Keep execution limits, egress policy schemas

#### [MODIFY] `src/config/loader.ts` — support `forge.yaml`
- Load `forge.yaml` from project root
- Support `forge.config.ts` via `jiti` dynamic import
- Merge with global config (~/.forge/config.yaml)
- Validate runtime mode config (ensure models exist for selected mode)

#### [NEW] `src/cli/index.ts` (~160 LOC)
- `forge run <workflow> --task "description" [--thread-id <id>] [--mode sovereign|copilot|hybrid]`
- `forge agent <name> --task "description" [--mode ...]`
- `forge tools` — list registered tools with categories
- `forge status [--thread-id <id>] [--mode]` — show workflow/checkpoint status + current runtime mode
- `forge init` — scaffold `forge.yaml` with auto-detection
- `forge mode [sovereign|copilot|hybrid]` — quick-switch runtime mode (writes to forge.yaml)
- **TUI Integration:** Wraps execution in an `ink` rendering tree for rich, interactive, multiline output (borrowing the interactive conventions of Hermes Agent).
- All commands support `--ci` flag (non-interactive, exit codes, no color, disables TUI).

---

### Phase 5 — Built-in Tools & Tests

#### [NEW] `src/tools/` — 8 built-in tools (~390 LOC total)

| Tool | Category | Safety Checks |
|------|----------|---------------|
| `read-file.ts` | `read` | ConstraintEngine path validation |
| `write-file.ts` | `write` | ConstraintEngine + DLP on content (adapted from PatchEngine) |
| `bash.ts` | `execute` | ConstraintEngine command deny-list |
| `grep.ts` | `search` | ConstraintEngine path validation |
| `list-dir.ts` | `read` | ConstraintEngine path validation |
| `web-fetch.ts` | `web` | EgressPolicy domain validation + DLP on response |
| `skill-manage.ts`| `write` | ConstraintEngine. Hermes pattern: agents write/update reusable `agentskills.io` standard Markdown workflows based on successful executions. |
| `invoke-subagent.ts`| `agent` | Hybrid Mode routing constraints. Hermes pattern: spawn isolated subagents for parallel workstreams (Map-Reduce). |
| `git.ts` | `read`/`write` | Claude Code pattern: Git awareness. Read `git status/diff`, create commits, or rollback changes for safe experimentation. |
| `lsp.ts` | `search` | Codex/Cursor pattern: Language Server Protocol queries. Ask for type definitions, references, and hover info instead of blind grepping. |
| `semantic-search.ts`| `search` | Claude Code pattern: Embedding/AST codebase indexing to find concepts conceptually rather than exactly. |
| `browser.ts` | `web` | SWE-agent / OpenDevin pattern: Headless Playwright browser to navigate local dev servers, interact with JS, and take screenshots for visual UI verification. |

> [!CAUTION]
> **Sandboxed Execution:** To truly be enterprise-grade (rivaling Daytona and OpenDevin), the `bash.ts` tool must support **Docker/DevContainer Sandboxing**. Running raw `bash` locally, even with ConstraintEngine, is risky. Forge will support a configuration flag to route all `bash` and `browser` execution through an isolated, ephemeral Docker container.

Each uses `defineTool()` with Zod schemas. Constraint/DLP/Egress checks are applied by the ToolRegistry middleware, not inline.

#### [NEW] `tests/` — Three-tier test suite (~500 LOC total)

**Unit tests:**
- `tests/core/tools/tool-registry.test.ts` — role filtering, registration, safety middleware
- `tests/core/tools/native.test.ts` — `defineTool()` factory, Zod→JSON Schema
- `tests/core/agents/dispatcher.test.ts` — mock LLM, tool-use loop, iteration caps
- `tests/core/workflows/graph.test.ts` — builder validation, cycle detection
- `tests/core/workflows/guards.test.ts` — all guard functions
- `tests/safety/constraint-engine.test.ts` — path/command validation
- `tests/safety/dlp-filter.test.ts` — secret redaction patterns
- `tests/persistence/store.test.ts` — checkpoint/resume/prune

**Integration tests:**
- `tests/core/workflows/executor.test.ts` — full DAG traversal with mock agents + persistence
- `tests/integration/e2e.test.ts` — complete workflow: define agents → define workflow → execute → verify results in SQLite

**Mock infrastructure:**
- `tests/helpers/mock-provider.ts` — Vercel AI SDK `MockLanguageModelV1` wrapper
- `tests/helpers/test-db.ts` — in-memory SQLite for test isolation

---

## Bleeding-Edge Patterns Incorporated

| Pattern | Source | Version | Implementation |
|---------|--------|---------|---------------|
| **Vercel AI SDK `generateText()` + `maxSteps`** | Vercel AI SDK 2025+ | v0.2 | Agent dispatch loop — no custom tool protocol |
| **`ai-sdk-ollama` for sovereign inference** | Community provider 2026 | v0.2 | Same `generateText()` API for local models |
| **Three runtime modes (Sovereign/Copilot/Hybrid)** | Forge original design | v0.2 | Quick-switch between local-only, cloud-only, and adaptive routing |
| **Adaptive model routing (Small Orchestrator, Large Executor)** | RouteLLM research 2025, MorphLLM | v0.2 | Local model classifies complexity, routes to cloud for complex tasks |
| **Strategy routing** | USTC research 2026 | v0.3 | Select reasoning strategy (direct/CoT/plan-execute/reflection) per task |
| **Two-tier persistence (memory + SQLite)** | LangGraph/Mastra 2026 | v0.2 | `ForgeStore` with active memory + durable checkpoints |
| **Cognitive memory taxonomy (CoALA)** | CoALA framework, Letta, Mem0 | v0.2 | Working/episodic/semantic/procedural memory in schema |
| **Knowledge consolidation pipeline** | Letta, LangMem | v0.3 | Post-run extraction → validation → promotion of semantic facts |
| **Temporal knowledge validity** | Graphiti, Zep | v0.4 | `validFrom`/`validUntil` + cascade invalidation |
| **Context compaction** | Context Engineering 2026 | v0.2 | `contextSnapshots` table with token-budgeted summaries |
| **KV-cache prefix reuse** | Ollama `num_keep` | v0.3 | Reuse computed system prompt tokens across calls |
| **OTel GenAI Semantic Conventions** | OpenTelemetry 2026 | v0.2 | `gen_ai.*` attributes on all LLM/agent spans |
| **MCP Client (Streamable HTTP + stdio)** | MCP 2025-11-25 spec | v0.2 | `connectMcpServer()` for external tool consumption |
| **DAG with guard functions** | LangGraph pattern | v0.2 | Workflow engine replaces linear FSM |
| **Drizzle ORM + better-sqlite3** | TypeScript best practice 2026 | v0.2 | Type-safe persistence without heavy ORM overhead |
| **Defense-in-depth safety** | Enterprise security pattern | v0.2 | Tool-level middleware + workflow-level guards |
| **Role-based tool visibility** | Forge spec ADR-5 | v0.2 | Agents can't see tools outside their role |
| **Content-aware compression routing** | Headroom (ContentRouter) | v0.2 | Classify content type, dispatch to optimal compressor |
| **Reversible compression (CCR)** | Headroom (Compress-Cache-Retrieve) | v0.2 | Store originals in hash-indexed cache, inject retrieval tool |
| **Statistical sampling + anomaly preservation** | Headroom (SmartCrusher) | v0.2 | JSON array compression: 70–95% savings, errors always preserved |
| **Modular compression pipeline interface** | Forge original design | v0.2 | Strategy pattern: builtin / none / custom — swappable at config level |
| **Tiered Prompt Assembly + Caching** | Hermes Agent / Anthropic | v0.2 | Stable/Context/Volatile tiering for KV-cache and API cache breakpoints |
| **Closed Learning Loop (Skills)** | Hermes Agent | v0.3 | Agents use `skill_manage` to author `agentskills.io` reusable workflows |
| **Cross-Session FTS5 Memory** | Hermes Agent | v0.2 | SQLite Full-Text Search indexing on the `memoryStore` table |
| **Agentic LSP Integration** | Cursor / Codex | v0.3 | Agent queries Language Server Protocol for type definitions and references |
| **Agentic Git Awareness** | Claude Code | v0.2 | Native `git.ts` tool to read diffs, branch, and rollback state autonomously |
| **Semantic Codebase Search** | Claude Code | v0.3 | Local embedding / AST-based codebase index search |
| **Visual Browser Automation** | SWE-agent / OpenDevin | v0.4 | Playwright-based tool to visually verify local web servers and UI changes |
| **Docker / DevContainer Sandboxing** | OpenDevin / Daytona | v0.3 | Ephemeral, isolated execution environments for `bash` and `browser` tools |

---

## Verification Plan

### Automated Tests
```bash
npm run typecheck          # Zero TypeScript errors under strict mode
npm run test               # Vitest — unit + integration + e2e
npm run forge -- --help    # CLI responds correctly
```

### Manual Verification
1. Define a 3-node workflow (analyze → implement → review) in `forge.yaml`
2. Run against local Ollama (`qwen2.5-coder:7b`)
3. Verify:
   - Agent dispatcher calls `generateText()` through `ai-sdk-ollama`
   - Tool registry enforces role-based access (analysis can't write)
   - Workflow executor follows DAG edges, guards work
   - Checkpoints saved to `.forge/forge.db`
   - Resume from checkpoint after simulated crash
   - OTel spans in console output
   - Built-in tools work end-to-end

### Build Validation
```bash
npm run build                  # Clean compilation
node dist/cli/index.js --help  # Binary works
```

---

## Estimated Effort

| Phase | Description | Est. New LOC | Key Dependencies |
|-------|------------|-------------|-----------------|
| **0** | Rename, restructure, deps | ~100 (config) | None |
| **1** | Core types + tool infra | ~530 | Phase 0 |
| **2** | Agent system + AI SDK + Model Router | ~465 | Phase 1 |
| **3** | Workflow engine + persistence + memory schema | ~780 | Phase 2 |
| **3b** | Compression pipeline (Headroom-inspired) | ~610 | Phase 3 |
| **4** | Engine, OTel, config (runtime modes + compression), CLI | ~455 | Phase 3b |
| **5** | Built-in tools + tests (incl. routing + compression tests) | ~950 | Phase 4 |
| **Total** | | **~3,890 new LOC** | |

After deletions (~2,200 LOC removed) and additions (~3,890 LOC), the final codebase will be approximately **~5,460 LOC** — architecturally transformed, with three runtime modes, adaptive routing, content-aware compression pipeline, cognitive memory persistence, observability, and multi-agent DAG workflows.
