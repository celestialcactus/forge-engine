# Proposed Plan Reconciliation

This document reconciles major sections of `docs/architecture/forgeengine-proposed-plan-v2.md` with repository behavior. Labels mean: **implemented**, **partially implemented**, **absent**, **contradicted by code**, **obsolete**, **requires clarification**, or **post-V1 roadmap**.

## Resolved design decisions

| Plan section | Classification | Repository evidence and reconciliation |
|---|---|---|
| Decision 1: composable runtime flows and dynamic routing | **Partially implemented** | `RuntimeMode` and `ModelRouter.classify()` implement sovereign/copilot/hybrid selection between one local and one cloud string. There is no provider-slot map, configurable provider chains, failover, CLI switching, environment overrides, runtime YAML, health checking, cost/latency policy, or provider factory. `RouterConfig.alwaysLocal/alwaysCloud` are unused. |
| Decision 2: YAML primary, TS supported | **Contradicted by code** | `src/config/loader.ts` loads `~/.agent-engine/config.yaml` and `.agent/config.yaml`, not `forge.yaml`, and parses a legacy `AgentConfigSchema`. No TypeScript config loader exists. Config is never loaded by CLI or runtime. |
| Decision 3: hybrid safety placement and roles | **Contradicted by code** | Role visibility is implemented by `ROLE_TOOL_ACCESS` and `ToolRegistry.getToolsForRole()`. Workflow guards exist. However the promised pipeline is absent: the constraint block in `ToolRegistry.register()` is empty; no permission or audit stage exists; DLP is post-tool-output rather than pre-egress; provider traffic bypasses egress. `trusted` mode disables even the few connected checks without an approval boundary. |
| Decision 4: symbiotic dual-path MCP | **Partially implemented** | `connectMcpServer()` implements Forge as an MCP client over stdio. There is no Forge MCP server, `src/copilot/`, IDE integration, server lifecycle policy, JSON-schema-to-Zod conversion, or per-MCP-tool capability classification. All external MCP tools default to `execute` and inherit the parent environment. |
| Decision 5: web tools | **Absent** | No `web_fetch.ts` or `web_search.ts` exists. `src/tools/browser.ts` is a mock that returns strings and does no network request or extraction. |
| Decision 6: three-tier testing | **Partially implemented** | Six unit tests cover only routing and registry filtering. The proposed dispatcher mock provider, safety unit tests, persistence tests, workflow tests, integration tests, E2E tests, fixtures, and CI matrix are absent. |
| Decision 7: two-tier persistence | **Partially implemented** | `ForgeStore` creates SQLite tables and supports append-only checkpoints, latest checkpoint lookup, agent output, memory, and FTS. The active tier is merely the executor's local object; there is no explicit active-state abstraction, prune/history/status API, transaction around node result plus checkpoint, migrations, lifecycle/retention policy, or concurrency design. |
| Decision 8: advanced persistence/adaptive reasoning | **Post-V1 roadmap** | Tables include early memory fields and `KnowledgeConsolidator` is explicitly a v0.3 stub. Temporal invalidation, contradiction management, confidence evolution, reasoning-strategy routing, graph memory, vector search, and consolidation evaluation are absent. They should remain research/roadmap work until the baseline is secure and testable. |

## Updated gap analysis claims

The plan's “What Exists Today” appears to describe a predecessor named Drop-in-Code-Assistant, not this repository's verified baseline. References to a patch engine and a centralized 320-line tool pipeline are unsupported by the current tree: no patch-engine file exists, and `ToolRegistry` has only a partial wrapper. Claims about code to keep/delete point to predecessor paths and cannot be actioned without the missing predecessor history. Classification: **obsolete / requires clarification**.

The “What We Keep & Adapt” and “What We Delete” tables use inaccessible `file:///c:/Users/gabri/.vscode/Projects/CodeTraining/Drop-in-Code-Assistant/...` links. Those files are not in this repository. Any decision based on their content is an **unverified claim**.

## Proposed phases

| Phase | Classification | Evidence |
|---|---|---|
| Phase 0 — rename, restructure, dependencies | **Partially implemented** | Package name is `forge-engine`, directories resemble the target, and most listed dependencies are present. The dependency set is internally incompatible under `npm ci`; many dependencies are unused; old `.agent` naming and `bin/agent-engine.js` remain. No migration rationale or package export map exists. |
| Phase 1 — type system and tool infrastructure | **Partially implemented** | Target files exist. `defineTool`, role filtering, tool results, and MCP adaptation exist. Safety middleware, execution audit, robust schema conversion, immutability, and boundary tests do not. Registering mutates the supplied tool's `execute`, which can create surprising cross-registry behavior. |
| Phase 2 — agents, LLM integration, routing | **Partially implemented** | Schemas, registry, heuristic router, generic provider resolver, and `generateText()` dispatch exist. There is no provider implementation/composition, structured result parsing, actual findings extraction, prompt DLP, retries/failover, streamed thoughts, cancellation, cost enforcement, or integration test. |
| Phase 3 — workflow and persistence | **Partially implemented** | Sequential first-match traversal, guards, edge limits, checkpoints, and resume are present. Parallel execution, atomic transitions, robust crash semantics, status inspection, pruning, steering, cancellation, and migrations are absent. Failed/completed terminal state is not checkpointed after the loop exits, so persisted status can remain `running`. |
| Phase 3b — compression | **Partially implemented / post-V1 candidate** | All planned core compression files exist and dispatcher integration is present. The proposed `src/tools/ccr-retrieve.ts` instead lives at `src/core/compression/tool.ts`; `src/engine.ts` integration is impossible because the engine file is absent. Token estimates are character/4 approximations; no cache limits, tenant isolation, sensitive-data policy, encryption, collision handling, deletion, or tests exist. |
| Phase 4 — engine, observability, config, CLI | **Mostly absent** | `src/engine.ts` and `tracer.ts` are absent. Telemetry is partial. Config uses predecessor names/schema. CLI commands (`run`, `status`, `config set-mode`) do not exist, Ink is unused, and the compiled CLI has no entrypoint side effect. |
| Phase 5 — built-ins and tests | **Mostly absent** | Four tools exist: read/write/host-shell plus mock browser. Glob/search/web-fetch/skill/subagent tools are absent. Only two of the proposed test themes have minimal coverage. Docker/DevContainer isolation is explicitly only a comment in `bash.ts`. |

## Bleeding-edge patterns

The plan lists current-industry and research patterns as though incorporation were equivalent to implementation. Only these have tangible code: generic AI SDK dispatch, a heuristic model router, SQLite checkpoints, FTS table creation, rudimentary hash-and-swap compression, MCP client adaptation, and OTel spans. Streaming thoughts, prompt-cache control, plan/execute/reflection strategy selection, multi-agent map-reduce, container isolation, multimodal compression, and most cognitive-memory features are **absent** or **post-V1 roadmap**.

## Verification plan

Classification: **mostly absent**. The repository can compile after a nonstandard install override and six unit tests pass, but the plan's manual sovereign/hybrid/workflow/resume/CCR checks have no runnable fixture or composition root. The asserted CLI command cannot launch the engine. No test currently demonstrates a real local model, cloud model, tool call, checkpoint resume, or policy denial.

## Estimated effort

Classification: **obsolete / unsupported**. The `25–35 hours` estimate and prescribed per-file line counts have no repository evidence, uncertainty model, staffing assumptions, threat-model scope, release criteria, or integration allowance. Security isolation, provider compatibility, cross-platform process control, persistence correctness, and E2E testing cannot responsibly be estimated from line counts. Re-estimate only after ADRs and baseline acceptance criteria are agreed.

## Plan-quality findings

- Malformed/inaccessible references: all local `file:///c:/Users/.../Drop-in-Code-Assistant/...` links are nonportable and unavailable here.
- Stale provider/model examples include GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro, Llama 3.1, and an assumed VS Code Copilot endpoint. Provider availability, identifiers, SDK compatibility, and terms must be revalidated when implementation begins.
- Unsupported numbers include 1–5 ms safety overhead, less than 0.5% impact, indexed queries under 1 ms, token/cost savings, file LOC targets, and the overall effort estimate. No benchmarks or citations accompany them.
- Contradiction: the plan calls safety non-negotiable while also proposing “God Mode” that disables DLP and egress for autonomous looping. The trust, authorization, and deployment boundary needs an ADR.
- Contradiction: “sovereign” promises zero external data flow, while telemetry defaults to an HTTP exporter and MCP subprocesses inherit environment. Mode-wide egress enforcement is unspecified.
- Contradiction: the plan places memory/consolidation/adaptive reasoning in v0.3+, yet Phase 3 schema and Phase 3b compression bring sensitive durable context into the baseline without retention, encryption, or tenancy decisions.
- Premature prescriptions: exact filenames and LOC targets, five memory tables, FTS, cognitive taxonomies, reasoning strategies, streamed thoughts, skill self-modification, and subagent map-reduce precede a working single-agent secure runtime.
- ADR required: provider abstraction/version policy; meaning of sovereign; trusted mode; permission/approval model; sandbox boundary; MCP trust and environment policy; persistence scope/transactions/encryption/retention; telemetry defaults; config locations/precedence; public API and CLI contract; compression of sensitive content.
