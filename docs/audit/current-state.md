# ForgeEngine Current-State Audit

Audit date: 2026-07-10. Repository revision inspected: `master` as fetched from `origin/master`. This document describes observed implementation; claims from `README.md`, `SPEC.md`, and the proposed plan are not treated as implementation evidence.

## Repository overview

ForgeEngine is currently a TypeScript library prototype for defining role-scoped LLM agents, routing them to a caller-supplied model, traversing a directed workflow, invoking native or MCP tools, checkpointing state in SQLite, and optionally compressing tool results. It is not yet an assembled end-user engine: there is no composition root that loads configuration, creates providers, registers tools and agents, builds a workflow, and invokes `WorkflowExecutor`.

The public barrel `src/index.ts` exports core types, tools, agents, workflows, compression, and persistence. It does not export config, safety, observability, or CLI APIs. The package advertises `dist/cli/index.js` as `forge`, but `src/cli/index.ts` only exports `ForgeCLI`; it never instantiates the class or calls `start()`. `bin/agent-engine.js` is a legacy launcher for a nonexistent `dist/cli.js` and is not the package `bin` target.

Observed source boundaries:

| Area | Concrete implementation | State |
|---|---|---|
| Core types | `src/core/types.ts` | Implemented type declarations and static role/category map |
| Agents | `AgentRegistry`, `ModelRouter`, `AgentDispatcher` under `src/core/agents/` | Partial; usable only when assembled by a caller |
| Tools | `ToolRegistry`, `defineTool`, MCP client adapter, four built-ins | Partial; important safety hooks are missing or ineffective |
| Workflows | `WorkflowBuilder`, `WorkflowExecutor`, guards | Partial sequential graph traversal |
| Persistence | `ForgeStore`, Drizzle schema, `KnowledgeConsolidator` | Partial; SQLite tables are created ad hoc and consolidator extraction is a stub |
| Compression | `ForgeCompressionPipeline`, `CcrStore`, crusher/router/retrieve tool | Partial experimental implementation |
| Safety | `ConstraintEngine`, `EgressPolicyEnforcer`, `DlpFilter` | Mostly disconnected utilities, not an enforceable boundary |
| Configuration | Zod schemas and two-level YAML loader | Legacy/partial; not wired into runtime and does not model the plan's provider slots |
| Observability | OpenTelemetry spans and OTLP SDK wrapper | Partial; no audit event store and no tool-call policy trace |
| CLI/steering | `ForgeCLI`, `SteeringController`, renderer | Scaffold; CLI does not run an engine and executor never checks steering |

## Actual runtime flow

The only meaningful execution path available to a library consumer is:

1. The consumer manually constructs a `ModelRouter`, `ToolRegistry`, `AgentRegistry`, `AgentDispatcher`, `ForgeStore`, graph, and `WorkflowExecutor`.
2. `WorkflowExecutor.execute()` initializes or resumes a `WorkflowState` (`src/core/workflows/executor.ts`, `WorkflowExecutor.execute`).
3. It traverses one node at a time and resolves an agent from `AgentRegistry`.
4. `AgentDispatcher.dispatch()` asks `ModelRouter.classify()` for a model ID, then calls the injected `providerResolver` (`src/core/agents/dispatcher.ts`).
5. The dispatcher filters visible tools by the static `ROLE_TOOL_ACCESS` category map and passes wrappers to AI SDK `generateText()`.
6. Tool execution goes through the mutation wrapper installed by `ToolRegistry.register()`. That wrapper optionally validates a URL for `web` tools and post-processes string results with DLP, but its constraint-engine block has no validation calls.
7. The dispatcher optionally compresses successful tool results and exposes `ccr_retrieve`.
8. The executor saves each agent result, selects the first passing outgoing edge, updates state, and appends a checkpoint.

There is no executable path from `npm run forge` to these steps. The CLI displays initialization messages and schedules timers only (`src/cli/index.ts`, `ForgeCLI.start`).

## Implemented subsystem inventory

- Agent definitions are Zod-validated on registry insertion (`src/core/agents/types.ts`, `AgentDefinitionSchema`; `src/core/agents/registry.ts`, `AgentRegistry.register`).
- Role-level tool visibility is real but coarse: `ToolRegistry.getToolsForRole()` filters the static category map in `src/core/types.ts`.
- Provider construction is intentionally delegated to `DispatcherConfig.providerResolver`; core dispatcher code imports the generic `ai` interface rather than vendor SDK constructors.
- Runtime routing modes exist as in-memory constructor state. Sovereign always selects `localModel`, copilot always selects `cloudModel`, and hybrid uses task-length/file-count heuristics (`src/core/agents/model-router.ts`).
- Workflow graph validation checks required sentinel nodes, missing edge endpoints, and syntactic cycles without bounded edges (`src/core/workflows/graph.ts`).
- Sequential traversal, edge guards, edge traversal counters, agent-result persistence, checkpoints, and limited resume behavior exist (`src/core/workflows/executor.ts`).
- SQLite tables for checkpoints, results, context snapshots, memory, FTS, and compression are created in `ForgeStore.initializeTables()` (`src/persistence/store.ts`).
- Compression classifies large outputs, samples JSON arrays or truncates long line-oriented content, stores originals under a 16-character SHA-256 prefix, and can retrieve originals (`src/core/compression/`).
- Native read, write, and host-shell tools perform actual I/O (`src/tools/read-file.ts`, `write-file.ts`, `bash.ts`).
- An MCP stdio client can spawn a configured server, list its tools, and expose them as `execute` tools (`src/core/tools/mcp-adapter.ts`).
- OpenTelemetry spans wrap model routing, dispatch, workflow traversal, native tools, and MCP calls. `TelemetryManager` configures a fixed OTLP HTTP exporter (`src/observability/telemetry.ts`).

## Partial, stubbed, mocked, abandoned, or absent subsystems

- `browser_action` returns success strings without opening a browser (`src/tools/browser.ts`).
- `KnowledgeConsolidator.extractCandidates()` always returns an empty array; validation is pass-through (`src/persistence/consolidator.ts`).
- `AgentResult.findings` is always empty after a successful dispatch, so blocker guards cannot act on model-produced findings unless a separate unimplemented parser exists (`src/core/agents/dispatcher.ts`).
- `alwaysLocal` and `alwaysCloud` are declared in `RouterConfig` but never read. Hybrid classification is explicitly described in code as Phase 2 scaffolding (`src/core/agents/model-router.ts`).
- The constraint-engine branch in `ToolRegistry.register()` is empty. `validateFilePath()`, `isDependencyFile()`, and `validateCommand()` are never called on tool execution.
- DLP is applied after a tool returns. Moreover, `DlpFilter.redact()` returns `{ cleaned, redactions }`, and the registry assigns that whole object into `result.data`, changing the tool result shape (`src/core/tools/tool-registry.ts`; `src/safety/dlp-filter.ts`). No DLP is applied to prompts or context before `generateText()`.
- Egress checking applies only to registered tools categorized `web` with an `input.url`. Model-provider calls, MCP servers, shell commands, and arbitrary subprocess network activity bypass it. `validateProvider()` and `validateNoUserApiKey()` have no call sites.
- Permission schemas exist, but no approval UI or execution-time permission decision consumes them (`src/config/schema.ts`).
- Steering is disconnected: `WorkflowExecutor` has no `SteeringController` and never calls `awaitIfInterrupted()`.
- Execution limits in config are not wired to the executor. Only AI SDK step count and per-edge counts have an effect; runtime minutes and total tool calls are unenforced.
- There is no engine/composition root (`src/engine.ts` is absent), provider factory, provider-slot/failover implementation, web fetch/search, search tool, skill manager, subagent tool, patch engine, rollback, container sandbox, server-side MCP exposure, deployment artifact, migration directory, threat model, or integration/E2E harness.

## Current build and execution path

Observed environment: Node `v22.19.0`, npm `10.9.3`.

| Command run | Result |
|---|---|
| `npm ci` | Failed with `ERESOLVE`: locked `ai@4.3.19` conflicts with `ai-sdk-ollama@3.8.8`, whose peer requires `ai@^6.0.197` |
| `npm ci --legacy-peer-deps` | Succeeded; installed 440 packages. npm printed 45 vulnerabilities at install time |
| `npm run build` | Passed |
| `npm run typecheck` | Passed |
| `npm test -- --reporter=verbose` in the managed sandbox | Failed before collection with `spawn EPERM` from Vitest/tinypool |
| Same test command outside the sandbox | Passed: 2 files, 6 tests |
| `npm audit --json` after installation | Exit 0 and reported zero vulnerabilities, contradicting the install summary; this must be rechecked in a clean CI environment |

`npm run forge` was not claimed as a usable execution check: even after build, the target module has no top-level call, so it exits without starting `ForgeCLI`. Database scripts are also not reproducible as documented because there is no `drizzle.config.*` or checked-in migrations directory.

## Dependency graph summary

- Core dispatch depends on AI SDK v4 types/functions and OpenTelemetry API.
- Vendor provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `ai-sdk-ollama`) are package-level production dependencies, but are not imported by production source. They enlarge install and supply-chain scope without currently providing runtime behavior.
- Workflow depends directly on concrete `ForgeStore`, and compression depends on `ForgeStore.sqlite`, coupling domain flow and compression to SQLite/better-sqlite3.
- Persistence combines Drizzle declarations with handwritten `CREATE TABLE` SQL and public raw SQLite access.
- MCP uses the official SDK and launches arbitrary configured stdio commands with the entire parent environment merged into the child.
- CLI production dependencies include Ink, Inquirer, diff, execa, pino, and others that currently have no imports in `src/`.

No automated dependency-boundary rules, workspace packages, or layering checks exist.

## Test coverage summary

The complete suite is 82 source lines across two files:

- `tests/core/agents/model-router.test.ts`: four routing selection cases.
- `tests/core/tools/tool-registry.test.ts`: duplicate registration and role-category filtering.

There are no tests for dispatcher/provider calls, tool execution or safety middleware, path containment, command parsing, DLP, egress, MCP, workflow graph validation/traversal/guards/resume, persistence/FTS, compression/retrieval, configuration precedence, telemetry, CLI, steering, failure recovery, or installation. No coverage configuration or threshold exists.

## Current known failures

1. Reproducible locked installation fails under normal npm peer-dependency resolution.
2. The published CLI entry module is inert and the legacy launcher points at a nonexistent file.
3. Safety policies do not form an enforcement boundary; read/write/bash can escape intended workspace controls.
4. The default host shell tool provides arbitrary code execution without sandboxing or effective command policy.
5. README claims about Docker sandboxing, browser automation, instant resume, FTS semantic recall, live steering, and an interactive engine materially exceed implemented behavior.
6. Configuration names and modes are split between legacy `.agent`/`.agent-engine` schemas and the plan's `forge.yaml`/runtime-slot design.
7. Persistence migrations are not reproducible, and memory upsert/FTS maintenance is likely incoherent because `last_insert_rowid()` does not identify an existing row after conflict update (`ForgeStore.saveMemory`).
8. Normal tests require process spawning; this managed environment needed an unsandboxed rerun.
