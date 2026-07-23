# ForgeEngine Second-Pass Product and Reference Audit

Date: 2026-07-10. Status: implementation freeze; architecture review in progress.

## Why a second pass was required

The first audit accurately identified that the prototype was not a credible implementation of its plan. It was weaker at reconstructing the full product thesis. The initial rewrite then narrowed quickly to a small agent-loop slice. That was a useful validation tactic, but it risked letting the slice define the architecture rather than making it prove an architecture derived from the intended product.

Repository history reinforces this concern: the prototype's source, dependency tree, specifications, task residue, safety modules, persistence, compression, CLI, and tests arrived in one implementation commit. The architecture plan and product README followed as documentation-only commits. There is no incremental evidence trail demonstrating which abstractions were validated.

The reconstruction must therefore derive authority from explicit product goals, observable acceptance tests, source-level reference audits, and ADRs—not from the prototype's names or apparent completeness.

## Product intent recovered from discussion

ForgeEngine is intended to be:

- a delightful local developer harness, not merely enterprise middleware;
- sovereign-first, meaning local ownership and local inference are first-class, not that cloud use is forbidden;
- cloud-compatible through deliberate routing and escalation;
- host-neutral and symbiotic: standalone, orchestrator/master, apprentice through MCP, or embedded in another host;
- capable of allowing an external cloud runtime to use Forge capabilities while Forge continues to own its internal semantics;
- adaptive through procedural skills, scoped memory, retrieval, and measured learning;
- materially more context-efficient through Headroom-like techniques;
- extensible beyond software development into a future general sovereign platform;
- governable through replaceable policy and isolation boundaries without making local development hostile.

The competitive thesis is not “support many models.” It is portable ownership of runtime behavior, context economics, skills, memory, evidence, and execution capabilities across local and proprietary hosts.

## Important areas underweighted by the first audit

### Product surfaces and role symmetry

Master and apprentice are relationships per delegation, not global runtime modes. Runtime location, orchestration ownership, and policy authority are independent axes. Forge must avoid separate standalone and MCP execution paths that drift semantically.

### Context as a platform subsystem

Compression alone is too narrow. Prompt assembly, stable-prefix caching, live-zone selection, capability/skill disclosure, tool-output shaping, context provenance, token accounting, retrieval, and compaction recovery form one context engine.

### Learning requires evaluation

Skills and memory cannot be called “learning” merely because the model writes files. A learned artifact needs provenance, scope, versioning, activation state, observed outcomes, regression evaluation, refinement, and retirement.

### Developer delight is architectural

Streaming, interruptibility, steering, useful diffs, tool progress, fast startup, session continuation, failure recovery, and understandable model/cost decisions are not CLI polish to add at the end. They constrain the event protocol and runtime contracts.

### Host lifecycle and protocol

MCP tools alone are insufficient. Forge needs session identity, progress, cancellation, approval/elicitation, artifacts, capability discovery, and resumable delegation semantics that can map onto MCP, a CLI, an SDK, and a future app server.

### Local inference is heterogeneous

“OpenAI-compatible” is not a complete abstraction. Local runtimes vary in tool calling, streaming, context limits, structured output, token accounting, model loading, cold-start latency, and error behavior. Provider capability discovery and contract tests are required.

### General-platform trajectory

Developer concepts should live in a first-party developer capability pack. The kernel should use domain-neutral concepts: sessions, turns, capabilities, artifacts, skills, memory, context, delegation, schedules, policies, and events.

### Graph-shaped data

Code relationships, provenance, skill dependencies, memory supersession, artifacts, and delegation are naturally graph-shaped. A graph database is not justified as the V1 source of truth; a rebuildable relationship projection is justified in the architecture.

## Source-level reference audit

The reference repositories were shallow-cloned to a temporary research directory. No code or dependencies were copied into ForgeEngine.

### Hermes Agent

Observed strengths:

- one agent capability set exposed across CLI, gateway/messaging, TUI, and desktop surfaces;
- progressive skill disclosure: metadata listing before full `SKILL.md` and referenced resources;
- separation of procedural skills from compact factual/user memory;
- bounded memory with explicit consolidation pressure;
- frozen memory snapshots at session start to preserve prompt-prefix stability;
- provider plugins, terminal backends, profiles, scheduled operation, session search, and subagents;
- context engine abstraction and separate gateway/agent compaction thresholds;
- prompt tiers and prompt-inspection commands;
- explicit skill provenance, platform compatibility, prerequisite handling, and path/prompt-injection guards.

Observed costs and cautions:

- `run_agent.py` is roughly 6,000 lines;
- the default context compressor is roughly 3,100 lines;
- skills tooling is roughly 1,700 lines and skill guarding roughly 1,000;
- memory tooling is roughly 1,100 lines;
- significant behavior relies on process-global configuration, caches, environment state, and filesystem conventions;
- the breadth of surfaces creates considerable lifecycle and testing complexity.

Forge conclusion: adopt progressive disclosure, bounded/frozen memory, skill provenance, shared-core multi-surface behavior, prompt tiers, and provider/backend plugins. Do not reproduce Hermes's accumulated module coupling or treat autonomous skill creation as a small feature.

### Headroom

Observed strengths:

- context transforms operate as a pipeline with applicability decisions and metadata;
- live-zone-only compression avoids rewriting stable historical prompt content;
- user/assistant text is protected and tool calls/results are treated atomically;
- parse or transform uncertainty fails open to unchanged content rather than malformed context;
- content routing, log/code/diff/search compressors, adaptive sizing, anchor selection, cross-turn deduplication, and tag protection are separate concerns;
- Compress-Cache-Retrieve includes persistent original storage, retrieval instructions, cross-turn context tracking, workspace scoping, relevance-driven expansion, and observability;
- compression is evaluated and benchmarked, with explicit savings and failure reasons;
- proxy, SDK, MCP, provider, cache, and Rust streaming surfaces reveal that transparent context optimization is an integration product, not just an algorithm.

Observed costs and cautions:

- Headroom contains around 1,800 files and both Python and Rust implementation surfaces;
- compression correctness depends on provider message formats, streaming, strict tool pairing, project identity, cache lifecycles, and protocol invariants;
- claimed savings are workload-dependent and must not substitute for task-success evaluation;
- direct dependency would import a Python/Rust operational stack into a TypeScript local runtime.

Forge conclusion: make context items, transforms, provenance, reversibility, atomic pairing, no-op failure, and evaluation first-class. Initially implement native deterministic transforms and an adapter seam; evaluate Headroom as a sidecar/MCP/proxy integration separately from any native port.

### OpenAI Codex

Observed strengths:

- explicit event/protocol types between runtime and app-server surfaces;
- append-oriented rollout persistence plus SQLite-derived state and search;
- separate tool routing, dynamic tools, MCP, connectors, skills watching, compaction, and app-server thread state;
- sandboxing is a platform-specific subsystem with dedicated Windows restricted-token/ACL/WFP code and Linux/macOS implementations;
- approval, execution, network proxy, and application-tool policy are distinct concerns;
- extensive integration suites cover tools, MCP, persistence, compaction, parallelism, and platform sandboxes.

Observed costs and cautions:

- the Rust workspace contains many specialized crates and thousands of source files;
- production-grade sandboxing and app-server protocols are products in themselves;
- copying isolated details without the event and process model would preserve complexity without its reliability.

Forge conclusion: prioritize a versioned runtime event protocol, append-oriented sessions with projections, cancellation, tool lifecycle, and platform backend contracts. Do not claim equivalent isolation from a JavaScript command filter.

### Claude Code

Observed strengths from official documentation:

- broad lifecycle events around session, tool, permission, compaction, file/config changes, subagents, tasks, and failure;
- hooks can observe, inject context, approve/block, or validate at explicit lifecycle points;
- skills, instructions, rules, hooks, MCP, and subagents have different loading and execution semantics;
- subagents have isolated context and optional worktree isolation, bounded turns, scoped tools, memory, skills, and models;
- compaction has explicit pre/post lifecycle and loop-avoidance behavior;
- path-scoped instructions and skill bodies interact with context budgets.

Forge conclusion: define a small but extensible lifecycle event vocabulary early. Hooks are not merely shell callbacks; they are adapters over runtime lifecycle and policy decisions. Context-loading rules must be deterministic and inspectable.

### VS Code and Copilot

Observed strengths and constraints from official documentation:

- MCP, built-in tools, and extension-contributed tools coexist;
- workspace `.vscode/mcp.json` supports portable stdio servers and `${workspaceFolder}`;
- host approvals apply to exposed MCP calls, not necessarily Forge's internal nested actions;
- tool count and context costs make capability scoping and progressive disclosure operational requirements;
- custom agents, skills, hooks, and MCP integrations provide a richer later packaging surface;
- Windows does not currently receive the same VS Code stdio-MCP sandbox option documented for macOS/Linux.

Forge conclusion: MCP is the first portability test, but a later extension/app-server integration may be required for excellent progress, diff, approval, artifact, and session UX. VS Code-hosted approval cannot be assumed to govern internal Forge operations.

## Revised domain model

### Kernel

- session and turn state machine;
- versioned runtime events;
- provider-neutral inference request/response stream;
- capability discovery and invocation;
- lifecycle interception;
- cancellation, budgets, and errors;
- artifact references rather than unbounded inline payloads.

### Context engine

- typed context items and provenance;
- prompt tiers;
- model-aware budgets;
- capability and skill disclosure;
- deterministic transforms;
- reversible retrieval;
- compaction and recovery;
- quality/cost measurements.

### Knowledge and adaptation

- session history (episodic evidence);
- bounded user/project facts (semantic memory);
- versioned skills (procedural memory);
- candidate-generation and evaluation pipeline;
- relationship/provenance projection.

### Host and delegation plane

- CLI/TUI adapter;
- MCP server and client;
- embedded SDK;
- future app-server/IDE extension;
- delegation envelope, progress, artifacts, approvals, cancellation, and result evidence.

### Developer capability pack

- workspace/files;
- search and code intelligence;
- patch/edit;
- shell and processes;
- Git;
- build/test diagnostics;
- later browser and specialized integrations.

### Policy and execution backends

- mandatory policy decision seam;
- permissive local developer provider;
- host and organization policy adapters;
- host, container, remote, and platform-specific execution backends;
- policy ownership must be explicit, not assumed.

## Corrected V1 boundary

V1 should be larger than a toy agent loop but smaller than the original plan.

V1 includes:

- versioned runtime events and one deterministic agent loop;
- streaming/cancellation-ready inference contract;
- deterministic mock provider, one local provider family, and one cloud path;
- capability registry with lifecycle interception;
- developer tools for read/search/edit/patch/process/Git verification;
- practical developer policy and visible execution posture;
- CLI with streaming progress, cancellation, diff/evidence, and session continuation;
- durable local sessions, artifacts, resume, and search;
- context budgets, prompt tiers, tool-result shaping, reversible retrieval, and metrics;
- manually authored skills with progressive discovery and provenance;
- compact user/project memory with explicit scopes and inspection;
- MCP apprentice surface in VS Code using the same kernel;
- evaluation fixtures covering task success, context cost, resume, and host symmetry.

V1 experiments, disabled by default:

- skill candidate generation after successful workflows;
- graph-backed relationship projection;
- provider routing based on measured task classes;
- Headroom sidecar/proxy/MCP interoperability;
- container or native sandbox backend.

Post-V1:

- automatic skill activation/refinement;
- general autonomous background operation and cron;
- recursive multi-agent teams/swarms;
- browser/computer use;
- organization DLP and centralized governance products;
- shared enterprise knowledge graph;
- general-user capability packs and multi-channel gateway.

## Principal risks in the revised vision

1. **Integration breadth overwhelms the kernel.** Mitigate with one event protocol and conformance tests across hosts.
2. **Context optimization improves token counts but harms task success.** Require paired baseline/optimized evals and reversible transforms.
3. **Learning accumulates stale or unsafe artifacts.** Candidate state, provenance, evaluation, versioning, activation, and retirement are mandatory.
4. **Local models produce unreliable tool calls.** Capability negotiation, constrained schemas, repair limits, and model-specific contract tests are required.
5. **Master/apprentice recursion causes loops or privilege expansion.** Delegation IDs, depth, budgets, attenuation, cancellation, and idempotency are required.
6. **A TypeScript-only process cannot deliver credible isolation.** Keep execution backends separate and describe host mode honestly.
7. **Configuration becomes a substitute for behavior.** Begin with named profiles and inspectable effective state; add fields only with tests.
8. **Future general-platform goals distort developer V1.** Keep kernel nouns neutral while shipping developer capabilities as the first pack.

## Audit conclusion

The reconstruction remains justified. The first vertical slice is useful test scaffolding, not yet an adequate V1 architectural spine. Implementation should remain paused until the revised reconstruction plan, runtime protocol, context invariants, persistence semantics, skill lifecycle, and evaluation matrix are reviewed and accepted.
