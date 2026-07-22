# ForgeEngine V1 Reconstruction Plan

Status: proposed for review. This plan supersedes the implementation sequencing in `forgeengine-proposed-plan-v2.md`; it does not make the previous document disappear as historical intent.

## Definition of success

ForgeEngine V1 is successful when a developer can use it daily in VS Code or a terminal to complete real repository tasks with local or approved cloud inference; resume and inspect sessions; reuse skills and scoped memory; observe context/cost decisions; and expose the same governed capabilities to an external host through MCP.

Success is measured by task completion, correctness, latency, context consumption, recovery, and host symmetry—not by file count or feature names.

## Architecture principles

1. One kernel across standalone, master, apprentice, and embedded roles.
2. Runtime location, control relationship, and policy authority are independent.
3. Events and artifacts are the integration language; host UI is an adapter.
4. Context is typed, budgeted, attributable, transformable, and retrievable.
5. Skills, memory, sessions, and compression cache are separate data classes.
6. Developer capabilities are a first-party pack, not kernel primitives.
7. Local developer mode is permissive and transparent; stronger policy is additive.
8. Learning artifacts are proposed, evaluated, versioned, and reversible.
9. Every optimization has a quality baseline and a disable path.
10. An abstraction is accepted only after a second implementation, host mapping, or measured source of variation exists.

## Phase 0: Protocol and evaluation specification

Deliver before additional runtime code:

- versioned runtime-event vocabulary;
- session/turn/capability/provider/artifact/delegation state diagrams;
- error, cancellation, retry, idempotency, and budget semantics;
- context-item and provenance model;
- baseline developer task fixture set;
- evaluation record format;
- host-conformance test plan for CLI and MCP.

Gate: scripted traces can represent successful execution, tool failure, denial/approval, cancellation, context transform/retrieval, interruption/resume, and delegated completion without vendor-specific fields.

## Phase 1: Deterministic kernel

Build:

- runtime state machine;
- event stream;
- inference provider contract;
- capability registry;
- lifecycle interceptors;
- in-memory artifacts and sessions;
- scripted provider;
- deterministic conformance tests.

Gate: all Phase 0 traces execute deterministically; replay produces the same state; cancellation cannot leave an invocation ambiguously completed.

Framework checkpoint: TypeScript package shape, schema representation, and test runner.

## Phase 2: Developer loop and evidence

Build:

- streaming CLI;
- workspace discovery, read, search, patch/edit, process, Git status/diff, and verification capabilities;
- developer policy with a clearly displayed posture;
- approval interaction;
- artifact-backed large outputs;
- task evidence summary.

Gate: complete representative edit-and-test tasks against disposable fixtures; no capability bypasses lifecycle events; failures and partial edits are visible and recoverable.

Framework checkpoint: CLI/TUI library and process-execution API. Sandbox remains a backend decision, not a claimed property.

## Phase 3: Context engine V1

Build:

- typed context items and stable/context/volatile tiers;
- model-aware budget accounting;
- progressive capability disclosure;
- deterministic log/diff/search/structured-output transforms;
- atomic tool-call/result preservation;
- content-addressed original storage and retrieval;
- transform audit mode and savings/quality metrics;
- compaction loop guards.

Gate: optimized and unoptimized runs are compared on the fixture suite. No transform ships enabled when task success regresses beyond an accepted threshold. Parse uncertainty is a no-op.

Framework checkpoint: native transform implementation versus Headroom adapter/sidecar. No direct port is assumed.

## Phase 4: Durable sessions and projections

Build:

- append-oriented session events;
- atomic resumable snapshots;
- idempotent capability invocation records;
- artifact store;
- session search;
- retention/export/delete;
- rebuildable relationship projection for provenance and dependencies.

Gate: crash at every transition boundary and resume without losing a completed result or repeating a non-idempotent invocation. Corrupt projections rebuild from authoritative events/artifacts.

Framework checkpoint: Node SQLite binding and migration layer. Dedicated graph database remains experimental.

## Phase 5: Skills and bounded memory

Build:

- agentskills-compatible discovery;
- metadata-first progressive loading;
- referenced resources and scripts;
- provenance, compatibility, prerequisites, enable/disable, and version tracking;
- compact user, project, and local memory scopes;
- frozen session-start memory snapshot plus live mutation results;
- inspection/edit/export commands.

Gate: hundreds of installed skills do not flood context; a skill can be traced to its source and disabled; memory remains within configured budgets; procedures are not silently stored as facts.

Experiment: generate an inert skill candidate from a successful trace and evaluate it against a replay fixture. No automatic activation.

## Phase 6: MCP and VS Code apprentice path

Build:

- stdio MCP server adapter over the same runtime;
- bounded task, session, artifact, skill, and status tools;
- progress, cancellation, elicitation/approval, and error mapping where protocol support permits;
- portable workspace `.vscode/mcp.json` development configuration;
- MCP protocol and live VS Code smoke tests.

Gate: the same fixture produces equivalent events, artifacts, policy calls, and result semantics through CLI and MCP. Nested internal Forge actions are not falsely described as host-approved.

Framework checkpoint: official MCP SDK version and public tool/resource/prompt design.

## Phase 7: Local/cloud provider path and routing

Build:

- provider capability discovery;
- one local provider family selected through measured compatibility;
- one direct cloud/provider-gateway path;
- explicit routing decision record;
- manual selection, local-first fallback policy, and cost/latency accounting;
- provider contract suite for streaming, tools, structured output, cancellation, usage, and errors.

Gate: local, cloud, and host-provided inference execute the same scripted capability fixtures. Cloud escalation never occurs without an explicit policy decision and visible event.

Framework checkpoint: direct adapters versus shared model SDK; provider selections require compatibility evidence.

## Phase 8: Hardening and V1 release

Build or validate:

- execution backend interface with honest host mode and at least one isolated experimental backend;
- resource limits and process cleanup;
- package installation and upgrade;
- Windows/VS Code matrix;
- configuration profiles and effective-state inspection;
- threat model proportional to shipped capabilities;
- documentation derived from verified commands;
- performance and startup budgets.

Gate: clean package install, full fixture matrix, VS Code smoke, interruption/recovery, offline sovereign run, approved cloud run, MCP apprentice run, and migration test all pass from a packaged artifact.

## Evaluation matrix

Every material feature is evaluated across:

- task success and output correctness;
- repository diff correctness;
- tests/build verification;
- input/output/context tokens;
- latency and startup time;
- local compute and cloud cost;
- number and failure rate of capability calls;
- cancellation and recovery behavior;
- unoptimized versus optimized context;
- CLI versus MCP host equivalence;
- local versus cloud provider behavior.

## ADR backlog before implementation resumes

1. Runtime event protocol and state machine.
2. Artifact and context-item model.
3. Capability schema and lifecycle interception.
4. Evaluation fixture and trace format.
5. TypeScript package/test shape review, including whether ADR-0001 remains accepted.
6. Developer execution posture and approval semantics.
7. Persistence and projection semantics.
8. Skill/memory lifecycle and scope.
9. MCP public surface and host-policy mapping.
10. Provider capability and routing contract.

## Stop conditions

Pause implementation when:

- a framework dictates a public domain model;
- a transform improves token savings but lacks quality evidence;
- CLI and MCP require different kernel behavior;
- a “learning” feature cannot be reverted or evaluated;
- configuration is added for behavior that does not exist;
- a provider-specific workaround leaks into the kernel;
- a capability cannot define cancellation, artifacts, and failure semantics;
- a phase gate cannot be expressed as an executable test.
