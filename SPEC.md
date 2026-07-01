# forge-engine — Project Specification

> Enterprise-grade agentic harness for developer teams.
> Not a vibe-coding tool. A production-ready orchestration engine.

---

## Table of Contents

1. [Origin & Motivation](#1-origin--motivation)
2. [Source Project Analysis](#2-source-project-analysis)
3. [Architecture Decisions](#3-architecture-decisions)
4. [What's Built (v0.1-alpha)](#4-whats-built-v01-alpha)
5. [What's Planned (v0.2–v1.0)](#5-whats-planned-v02v10)
6. [Developer Guide](#6-developer-guide)
7. [File Map](#7-file-map)

---

## 1. Origin & Motivation

This project was born from analyzing two existing codebases:

1. **george_agentic_setup** — An internal framework that turns VS Code Copilot into a multi-agent orchestration system with explicit role boundaries, FSM workflows, and CLI-enforced gates.

2. **openclaude** — An open-source Claude Code rewrite providing a provider-agnostic terminal-first coding agent with 200+ model support, MCP integration, and a rich tool ecosystem.

**The gap neither fills:**
- No structured observability (OpenTelemetry)
- No multi-tenant / team-aware execution
- No CI/CD pipeline integration as first-class concern
- No cost governance / budget enforcement per team
- No formal schema-validated agent/skill definitions
- No health checks, graceful degradation, or circuit breakers

**Goal:** Build an enterprise harness that takes the best patterns from both while following current industry paradigms (Vercel AI SDK, LangGraph, OpenTelemetry, MCP protocol).

---

## 2. Source Project Analysis

### george_agentic_setup

**Architecture:** VS Code Copilot extension with markdown-defined agents, CLI validators (stateless gate enforcement), and a shared contract system.

**Key patterns we adopted:**
| Pattern | Rationale |
|---------|-----------|
| Role-based tool restriction (analysis can't write) | Prevents agents from exceeding their authority |
| Iteration caps with escalation | Prevents runaway loops and token burn |
| Analysis-before-implementation mandate | Prevents patches that break other things |
| Review-before-commit mandate | Prevents unreviewed code from shipping |
| Evidence-based findings (verifiable commands/quotes) | Prevents "I think there's a bug" without proof |
| CLI as primary interface | CI/CD integration requires exit codes, not UIs |

**What we intentionally didn't adopt:**
| Pattern | Why not |
|---------|---------|
| Markdown-as-executable-spec | Typos fail silently; no schema validation |
| Hand-encoded FSM table | Drifts from docs; linear chains are limiting |
| Custom EventBus | Worse reimplementation of OTel |
| 50+ gate taxonomy (U/A/Im/R/O prefixes) | Gate explosion; hard to prioritize |
| Token caching for SSO skills | MCP replaces custom integration skills |

### openclaude

**Architecture:** Standalone Node.js/TypeScript CLI with Zustand state, React (Ink) terminal UI, 80+ slash commands, and descriptor-driven provider support.

**Key patterns we adopted:**
| Pattern | Rationale |
|---------|-----------|
| TypeScript + strict mode | Compile-time safety, refactorability |
| Provider abstraction via SDK | Don't build custom provider layer (use Vercel AI SDK) |
| MCP client integration | Industry standard tool interop protocol |
| Tool result structured typing | Agents get typed data, not raw strings |
| OTel-style span tracing | Industry standard observability |

**What we intentionally didn't adopt:**
| Pattern | Why not |
|---------|---------|
| React (Ink) terminal UI | Over-engineered for a harness; CLI is sufficient |
| Zustand state management | No interactive UI to drive; workflow state is simpler |
| 80+ commands | Feature sprawl; start with 5 commands |
| Descriptor codegen for providers | Vercel AI SDK handles this |
| Feature flags (GrowthBook) | Premature for v0.1 |

---

## 3. Architecture Decisions

### ADR-1: Dual-path tool system (native + MCP)

**Context:** Enterprise environments may block MCP (firewall, compliance). Developers still need to create custom tools.

**Decision:** Single `Tool` interface with two creation paths:
- `defineTool()` — Zod schema + handler function (works anywhere)
- `connectMcpServer()` — Adapts MCP server tools to the same interface

**Consequence:** Agents see one tool list regardless of tool origin. No code changes needed when MCP becomes available/blocked.

### ADR-2: DAG workflow graph (not linear FSM)

**Context:** george_agentic_setup used linear FSM (idle → analyze → plan → implement → review → complete). Real work needs parallel reviews, conditional branches, and retry subgraphs.

**Decision:** Directed Acyclic Graph with guard functions on edges. A guard returns `boolean` — `true` means traverse, `false` means skip. First passing guard wins.

**Consequence:**
- Parallel agents: multiple edges from one node
- Conditional branches: guards inspect workflow state
- Retry loops: `review → implement` with `maxTraversals: 3`
- Linear chains: trivial DAG (still supported)
- Iteration caps: `maxTotalSteps` on the graph + per-edge `maxTraversals`

### ADR-3: Guards on edges replace gate registry

**Context:** Initial design had a separate `GateRegistry` with 50+ gates. This created two systems doing one job.

**Decision:** Guards ARE the policy enforcement. They live on workflow edges and are evaluated during graph traversal. Built-in guard functions (`guards.analysisCompleted`, `guards.noBlockerFindings`) cover the enterprise safety patterns.

**Consequence:** One system, not two. Guards are composable, testable, and co-located with the workflow definition.

### ADR-4: Vercel AI SDK for LLM interaction

**Context:** OpenClaude built a custom provider layer. That's months of per-provider work.

**Decision:** Use `ai` package (Vercel AI SDK) which handles streaming, tool calling, structured output, retries, and 20+ providers out of the box.

**Consequence:** `AgentDispatcher` calls `generateText()` with tools. Provider switching is a config change, not a code change. Supports Anthropic, OpenAI, Google, Ollama, Azure, Bedrock, etc.

### ADR-5: Role-based allowlist (not capability tokens)

**Context:** Initial design used Symbol-branded capability tokens for "unforgeable" access control. But the threat model is wrong — LLMs return `tool_use` blocks that the *runtime* dispatches. The LLM never touches JS objects.

**Decision:** Simple role-based allowlist. `ToolRegistry.getToolsForRole("analysis")` returns only `["read", "search"]` tools. An analysis agent literally cannot see write tools.

**Consequence:** Zero ceremony. Same security property. The agent dispatcher calls `getToolsForRole(definition.role)` at dispatch time — that's the enforcement.

### ADR-6: OpenTelemetry (not custom event bus)

**Context:** Initial design had a custom `EventBus` with typed events. This reimplements what OTel already does, but worse.

**Decision:** OTel spans on tool execution, agent dispatch, and workflow traversal. Export to any OTel-compatible backend (Datadog, Grafana, Jaeger, Splunk).

**Consequence:** Industry-standard observability. Distributed tracing works across services. No custom event format to document/maintain.

---

## 4. What's Built (v0.1-alpha)

### File Structure
```
forge-engine/
├── package.json                    # Dependencies, scripts
├── tsconfig.json                   # Strict TypeScript config
├── src/
│   ├── index.ts                    # Public API surface (exports)
│   ├── engine.ts                   # ForgeEngine class (composition root)
│   ├── core/
│   │   ├── types.ts                # Shared primitives (IDs, roles, categories)
│   │   ├── tools/
│   │   │   ├── types.ts            # Tool interface, ToolResult, ToolSource
│   │   │   ├── tool-registry.ts    # Registry with role-based filtering + OTel
│   │   │   ├── native.ts           # defineTool() — Zod schema + handler
│   │   │   ├── mcp-adapter.ts      # connectMcpServer() — MCP → Tool adapter
│   │   │   └── index.ts            # Barrel exports
│   │   ├── agents/
│   │   │   ├── types.ts            # AgentDefinition schema, AgentResult, Finding
│   │   │   ├── registry.ts         # AgentRegistry — stores validated definitions
│   │   │   ├── dispatcher.ts       # AgentDispatcher — LLM tool-use loop via AI SDK
│   │   │   └── index.ts            # Barrel exports
│   │   └── workflows/
│   │       ├── types.ts            # WorkflowGraph, WorkflowNode, WorkflowEdge, state
│   │       ├── graph.ts            # defineWorkflow() — fluent builder with validation
│   │       ├── executor.ts         # WorkflowExecutor — DAG traversal + agent dispatch
│   │       ├── guards.ts           # Built-in guard functions (enterprise defaults)
│   │       └── index.ts            # Barrel exports
│   ├── observability/
│   │   ├── tracer.ts              # OTel SDK initialization
│   │   └── index.ts
│   └── cli/
│       └── index.ts               # Commander.js CLI (forge run/agent/tools/status)
└── tests/                          # (empty — to be built)
```

### Compilation Status
**Zero TypeScript errors.** All files compile under `strict: true` with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noImplicitReturns`.

### Dependencies
| Package | Purpose |
|---------|---------|
| `ai` | Vercel AI SDK — LLM interaction, tool calling, streaming |
| `@ai-sdk/anthropic` | Anthropic provider |
| `@ai-sdk/openai` | OpenAI/Azure provider |
| `@ai-sdk/google` | Google Gemini provider |
| `@modelcontextprotocol/sdk` | MCP client (stdio + SSE transports) |
| `@opentelemetry/*` | Distributed tracing |
| `zod` | Runtime schema validation |
| `nanoid` | ID generation |
| `pino` | Structured logging |
| `commander` | CLI framework |

### Core Concepts

#### Tool (unified interface)
```typescript
interface Tool<TInput, TOutput> {
  name: string;
  description: string;
  category: ToolCategory;           // "read" | "write" | "execute" | "search" | "web" | "agent"
  parameters: Record<string, unknown>; // JSON Schema
  source: { type: "native" } | { type: "mcp"; serverName: string };
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}
```

#### Creating native tools (MCP blocked)
```typescript
import { defineTool } from "forge-engine";
import { z } from "zod";

const readFile = defineTool({
  name: "read_file",
  description: "Read contents of a file",
  category: "read",
  parameters: z.object({
    path: z.string().describe("Absolute file path"),
    maxLines: z.number().optional(),
  }),
  execute: async ({ path, maxLines }) => {
    const content = await fs.readFile(path, "utf-8");
    return maxLines ? content.split("\n").slice(0, maxLines).join("\n") : content;
  },
});
```

#### Connecting MCP servers (MCP available)
```typescript
import { connectMcpServer } from "forge-engine";

const { tools, connection } = await connectMcpServer({
  name: "jira",
  transport: "stdio",
  command: "npx",
  args: ["@jira/mcp-server"],
  category: "web",
});
// tools is Tool[] — same interface as native tools
```

#### Defining agents
```typescript
import { AgentDefinitionSchema } from "forge-engine";

const codeReviewer = AgentDefinitionSchema.parse({
  name: "code-reviewer",
  description: "Reviews code for bugs, patterns, and security issues",
  role: "review",                    // Gets: read + search + execute tools
  model: "claude-sonnet-4-20250514", // Optional override
  instructions: `You are a code reviewer. Find bugs, security issues...`,
  maxIterations: 10,
  outputFormat: "findings",
});
```

#### Defining workflows (DAG with guards)
```typescript
import { defineWorkflow, guards } from "forge-engine";

const featureDev = defineWorkflow("feature-development", "Full feature lifecycle")
  .node("analyze", "code-explorer")
  .node("plan", "planner")
  .node("implement", "developer")
  .node("review", "code-reviewer")
  .edge("__start__", "analyze")
  .edge("analyze", "plan")
  .edge("plan", "implement", {
    guard: guards.analysisCompleted,
    description: "Analysis must complete before implementation",
  })
  .edge("implement", "review")
  .edge("review", "implement", {
    guard: guards.hasBlockerFindings,
    description: "Fix blocker findings",
    maxTraversals: 3,                // Prevent infinite review loops
  })
  .edge("review", "__end__", {
    guard: guards.noBlockerFindings,
    description: "All clear — done",
  })
  .withMaxSteps(20)
  .build();
```

#### Running the engine
```typescript
import { createForgeEngine, connectMcpServer } from "forge-engine";
import { anthropic } from "@ai-sdk/anthropic";

const engine = createForgeEngine({
  model: anthropic("claude-sonnet-4-20250514"),
  tracing: { otlpEndpoint: "http://localhost:4318/v1/traces" },
  workingDirectory: "/path/to/project",
  logLevel: "info",
});

// Register tools (native or MCP)
engine.tools.register(readFileTool);
engine.tools.register(writeFileTool);
const { tools } = await connectMcpServer(jiraConfig);
engine.tools.registerAll(tools);

// Register agents
engine.registerAgent(codeExplorer);
engine.registerAgent(planner);
engine.registerAgent(developer);
engine.registerAgent(codeReviewer);

// Run workflow
const result = await engine.runWorkflow(featureDev, {
  task: "Add pagination to the users API",
});

console.log(result.status); // "completed" | "failed" | "blocked" | "cancelled"
console.log(result.state.agentResults); // All agent outputs
```

### Role → Tool Access Matrix
| Role | read | write | execute | search | web | agent |
|------|------|-------|---------|--------|-----|-------|
| analysis | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| planning | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| implementation | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| review | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ |
| orchestration | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |

### Built-in Guards
| Guard | Use case |
|-------|----------|
| `guards.analysisCompleted` | Block implementation until analysis passes |
| `guards.noBlockerFindings` | Allow workflow completion (review → end) |
| `guards.hasBlockerFindings` | Trigger fix loop (review → implement) |
| `guards.lastAgentSucceeded` | Proceed on success |
| `guards.lastAgentFailed` | Route to error handling |
| `guards.withinStepLimit(n)` | Custom step cap |

---

## 5. What's Planned (v0.2–v1.0)

### v0.2 — Working end-to-end

| Task | Description |
|------|-------------|
| **Built-in tools** | `read_file`, `write_file`, `bash`, `grep`, `list_dir` — the minimum tool set for any coding agent |
| **Agent loader** | Load agent definitions from YAML/JSON files (not just code) |
| **Workflow persistence** | Serialize/deserialize workflow state to `.forge/` for resume |
| **CLI implementation** | Wire up `forge run`, `forge agent`, `forge status` to real engine |
| **Config file** | `forge.config.ts` — define tools, agents, workflows, MCP servers |
| **Error recovery** | Retry failed agents with exponential backoff |

### v0.3 — Enterprise features

| Task | Description |
|------|-------------|
| **Parallel node execution** | Multiple outgoing edges dispatched concurrently |
| **Cost tracking** | Token usage per agent/workflow, budget caps per team |
| **Approval workflows** | Human-in-the-loop gates for destructive actions |
| **Structured output** | JSON mode with schema validation on agent results |
| **Finding verification** | Run evidence commands and validate findings programmatically |
| **Session persistence** | Resume workflows across process restarts |

### v0.4 — Team features

| Task | Description |
|------|-------------|
| **Multi-tenant** | Namespace tools/agents/workflows per team |
| **Audit log** | Append-only log of all actions (OTel → persistent store) |
| **RBAC** | Who can run which workflows, who can register agents |
| **Webhook notifications** | Notify Slack/Teams on workflow completion/failure |
| **CI/CD mode** | `forge run --ci` with non-interactive mode, exit codes, JUnit XML |

### v1.0 — Production-ready

| Task | Description |
|------|-------------|
| **Plugin system** | Load plugins from npm packages |
| **Custom guard library** | Shareable guard functions across teams |
| **Dashboard** | Web UI for monitoring active/historical workflows |
| **Rate limiting** | Per-provider token rate limiting |
| **Circuit breaker** | Auto-disable failing providers, fallback to alternatives |
| **Health checks** | `/healthz` endpoint for container orchestration |

---

## 6. Developer Guide

### Prerequisites
- Node.js >= 22.0.0 (uses ES2024 features)
- npm or pnpm

### Setup
```bash
cd forge-engine
npm install
npm run typecheck   # Verify compilation
npm run forge -- --help   # Test CLI
```

### Development workflow
```bash
npm run dev          # Watch mode (tsc --watch)
npm run test:watch   # Vitest watch mode
npm run forge -- run feature-development --task "your task"
```

### Adding a native tool
1. Create a file in `src/tools/` (future; currently inline)
2. Use `defineTool()` with a Zod schema
3. Register in the engine config

### Adding an agent
1. Define with `AgentDefinitionSchema.parse({...})`
2. Choose appropriate role (determines tool access)
3. Write instructions (system prompt)
4. Register in the engine config

### Adding a workflow
1. Use `defineWorkflow()` fluent builder
2. Add nodes (agent assignments)
3. Add edges with guards
4. Set `maxTotalSteps` and edge `maxTraversals`
5. Call `.build()` — validates graph reachability

### Adding an MCP integration
1. Use `connectMcpServer()` with stdio or HTTP transport
2. Assign a category to all tools from that server
3. Register with `engine.tools.registerAll(tools)`

### Key design rules
- **Tools are categorized, not individually permissioned.** If you need fine-grained control, use different categories.
- **Guards are pure functions.** They inspect `WorkflowState` and return `boolean`. No side effects.
- **Agent instructions are the behavioral spec.** The harness enforces structure; instructions guide behavior.
- **Workflow state accumulates.** Each agent's output is appended to context for downstream agents.
- **OTel spans are automatic.** Tool execution, agent dispatch, and workflow traversal are all traced without manual instrumentation.

---

## 7. File Map

### Active source files (compiled)
| File | LOC | Purpose |
|------|-----|---------|
| `src/core/types.ts` | 99 | Branded IDs, roles, categories, constants |
| `src/core/tools/types.ts` | 80 | Tool interface, ToolResult, NativeToolConfig |
| `src/core/tools/tool-registry.ts` | 115 | Registry with role-based filtering + OTel tracing |
| `src/core/tools/native.ts` | 85 | defineTool() factory |
| `src/core/tools/mcp-adapter.ts` | 135 | MCP server → Tool adapter |
| `src/core/agents/types.ts` | 74 | AgentDefinition schema, AgentResult, Finding |
| `src/core/agents/registry.ts` | 40 | Agent definition store |
| `src/core/agents/dispatcher.ts` | 175 | LLM tool-use loop via Vercel AI SDK |
| `src/core/workflows/types.ts` | 90 | DAG types, WorkflowState, run records |
| `src/core/workflows/graph.ts` | 115 | Fluent workflow builder with validation |
| `src/core/workflows/executor.ts` | 180 | DAG traversal engine |
| `src/core/workflows/guards.ts` | 65 | Built-in guard functions |
| `src/observability/tracer.ts` | 55 | OTel SDK initialization |
| `src/engine.ts` | 120 | ForgeEngine composition root |
| `src/index.ts` | 55 | Public API barrel exports |
| `src/cli/index.ts` | 75 | Commander.js CLI skeleton |

### Stale files (excluded from compilation via tsconfig)
These are leftovers from the initial over-engineered design. Delete or repurpose:
- `src/core/events/` — Custom EventBus (replaced by OTel)
- `src/core/gates/` — Separate gate registry (replaced by workflow guards)
- `src/core/capabilities.ts` — Capability tokens (replaced by role-based allowlist)

### Empty directories (planned)
- `src/config/` — forge.config.ts loader
- `src/integrations/` — Provider-specific adapters if needed
- `src/plugins/` — Plugin system (v1.0)
- `src/runtime/` — Sandbox, scheduler (v0.3)
- `src/sdk/` — Public SDK for external integration (v0.4)
- `src/skills/` — Removed concept (MCP replaces it)
- `tests/` — Test suite (v0.2 priority)

---

## Appendix: Enterprise Constraints (from george's repo)

These constraints inform why certain patterns exist:

1. **Air-gapped networks** → MCP may be blocked → `defineTool()` must work standalone
2. **SSO/Okta auth** → MCP servers may need custom auth headers → `McpHttpConfig.headers`
3. **Audit requirements** → Every action must be traceable → OTel spans with correlation IDs
4. **Approval workflows** → Destructive actions need human sign-off → guards + "blocked" state
5. **Iteration caps** → LLMs loop forever without limits → `maxTotalSteps` + `maxTraversals`
6. **Role separation** → Analysis agents must not edit files → `ROLE_TOOL_ACCESS` allowlist
7. **Evidence-based findings** → Claims require proof → `FindingSchema.evidence` field
8. **Session recovery** → Process crashes shouldn't lose state → workflow persistence (v0.2)
9. **CI/CD integration** → Must work headlessly with exit codes → CLI-first design
10. **Multi-team usage** → Teams need isolation → namespace support (v0.4)
