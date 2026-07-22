# Open Architectural Decisions

These decisions should not be silently resolved by an implementation agent.

## 1. V1 product boundary

- **Options:** library-only orchestration kernel; local CLI product; IDE/MCP service; all three.
- **Current behavior:** partial library modules plus an inert CLI scaffold; no engine composition root (`src/index.ts`, `src/cli/index.ts`).
- **Plan position:** simultaneously targets a CLI, embedded engine, MCP client, MCP server, and IDE/Copilot integration.
- **Tradeoffs:** multiple surfaces multiply security, packaging, lifecycle, and test obligations.
- **Recommendation:** human confirmation required; default recommendation is one local CLI backed by a small library API, with server/IDE surfaces post-V1.

## 2. Meaning of sovereign mode

- **Options:** local-model preference; no cloud model calls; process-wide zero network; isolated/offline execution with local-only persistence/telemetry.
- **Current behavior:** `ModelRouter` selects the local model string only (`src/core/agents/model-router.ts`).
- **Plan position:** promises absolute isolation and zero external data flow.
- **Tradeoffs:** stronger meanings require provider allowlisting, telemetry shutdown, sandbox networking, MCP policy, artifact pinning, and denial tests.
- **Recommendation:** define sovereign as a process-wide fail-closed information-flow invariant, or rename the current feature to `local-model-preferred`.

## 3. Provider abstraction and version policy

- **Options:** AI SDK v4-compatible providers; migrate all providers/core to AI SDK v6; internal provider interface with adapters; support only one provider in V1.
- **Current behavior:** core uses AI SDK v4; locked Ollama package requires v6, causing `npm ci` failure.
- **Plan position:** broad provider strings and interchangeable local/cloud slots.
- **Tradeoffs:** broad early support increases compatibility and credential/egress scope; a private interface reduces vendor leakage but adds adapter work.
- **Recommendation:** choose one compatible generation and one local plus at most one cloud adapter for V1; document upgrade policy and contract tests.

## 4. Runtime routing and failover

- **Options:** explicit user-selected model only; deterministic rule routing; heuristic routing; learned classifier; provider failover chains.
- **Current behavior:** constructor-selected mode and a task-length/file-count heuristic; no failover.
- **Plan position:** customizable slots, dynamic routing, CLI overrides, and failover chains.
- **Tradeoffs:** automation affects cost, privacy, determinism, and output quality; fallback can silently cross sovereignty boundaries.
- **Recommendation:** V1 should use explicit deterministic routing with no cross-boundary fallback. Add heuristic routing only with observable policy decisions and evaluation data.

## 5. Permission and approval model

- **Options:** static role/category allowlist; per-tool policy; capability tokens; interactive approvals; policy-as-code.
- **Current behavior:** only role/category visibility works; config approval levels have no executor (`src/core/types.ts`, `src/config/schema.ts`).
- **Plan position:** role allowlist plus middleware and “God Mode.”
- **Tradeoffs:** visibility reduces accidental calls but is not authorization; interactive approval complicates unattended runs; trusted bypass can nullify enterprise claims.
- **Recommendation:** retain role visibility as defense in depth, add centralized per-invocation authorization, and require an explicit human-approved execution profile. Do not ship a generic bypass named trusted/God Mode.

## 6. Execution isolation boundary

- **Options:** no shell in V1; host process with prompts/denylist; container sandbox; VM/microVM; external execution service.
- **Current behavior:** arbitrary host `child_process.exec()` (`src/tools/bash.ts`).
- **Plan position:** future Docker/DevContainer sandbox controlled by a flag.
- **Tradeoffs:** denylists are bypassable; containers improve isolation but require hardened profiles; stronger isolation costs portability and latency.
- **Recommendation:** remove/disable model-controlled shell from V1 unless a separately enforced sandbox and adversarial denial suite are acceptance criteria. Human input required on target platforms.

## 7. Filesystem policy

- **Options:** repository-only; explicit read/write roots; disposable workspace; broad host access with approvals.
- **Current behavior:** read/write resolve arbitrary relative or absolute paths with no containment.
- **Plan position:** constraint middleware and workspace semantics, but no complete symlink/platform policy.
- **Tradeoffs:** repository-only is safer but may limit monorepos and generated artifacts; configurable roots need canonicalization and reparse-point handling.
- **Recommendation:** explicit immutable read roots and narrower write roots, evaluated inside the sandbox after canonical path resolution.

## 8. Egress, DLP, and credential ownership

- **Options:** managed gateway only; direct provider SDKs with managed secrets; user keys; offline only; per-tool network allowlists.
- **Current behavior:** provider calls bypass `EgressPolicyEnforcer`; MCP inherits environment; DLP does not filter prompts.
- **Plan position:** managed provider policy, DLP, egress allowlists, with optional trusted bypass.
- **Tradeoffs:** direct SDK use simplifies setup but distributes policy; gateways centralize control but reduce sovereignty and add dependency.
- **Recommendation:** human decision required. Regardless of option, route all egress through one enforceable boundary and minimize credential exposure to child processes.

## 9. MCP trust model and dual-path scope

- **Options:** MCP client only; server only; both; postpone MCP.
- **Current behavior:** unrestricted stdio client adapter only (`src/core/tools/mcp-adapter.ts`).
- **Plan position:** both client and Forge-as-server/IDE path.
- **Tradeoffs:** MCP expands arbitrary-code, schema, authentication, consent, and lifecycle surfaces.
- **Recommendation:** postpone server mode; if client mode remains, require approved manifests, isolated launch, reduced environment, declared capabilities, and schema validation.

## 10. Configuration contract and precedence

- **Options:** one `forge.yaml`; global plus repo YAML; TypeScript API only; environment/CLI overlays.
- **Current behavior:** `~/.agent-engine/config.yaml` plus `.agent/config.yaml`, merged by custom security rules; runtime never loads them.
- **Plan position:** `forge.yaml` primary, TS supported, CLI/environment overrides.
- **Tradeoffs:** more sources improve convenience but make effective policy harder to explain and audit.
- **Recommendation:** choose a canonical Forge namespace and publish a field-by-field precedence table. Security settings may only tighten downstream; runtime should print effective config with secret redaction.

## 11. Persistence scope and semantics

- **Options:** no durable V1 state; append-only checkpoints; transactional SQLite; external store plugin.
- **Current behavior:** SQLite result/checkpoint writes are separate; resume loads only a `running` latest snapshot; final status is not persisted.
- **Plan position:** two-tier SQLite plus in-memory state, crash resume, histories, memory, and compression cache.
- **Tradeoffs:** durable state helps recovery but creates idempotency, migration, privacy, locking, corruption, and retention obligations.
- **Recommendation:** keep only transactional run/checkpoint persistence in V1. Define exactly-once/at-least-once semantics and terminal state before adding general memory.

## 12. Memory, consolidation, and adaptive reasoning

- **Options:** omit from V1; retain CCR only; basic user-controlled memory; full cognitive taxonomy and adaptive strategies.
- **Current behavior:** tables and partial CCR exist; consolidation extraction is empty; adaptive reasoning is absent.
- **Plan position:** broad v0.3/v0.4 roadmap mixed into current schema and phases.
- **Tradeoffs:** these features are evaluation-heavy and retain sensitive data; premature implementation distracts from safety and reproducibility.
- **Recommendation:** post-V1 roadmap. Remove them from baseline acceptance except possibly a bounded, opt-in tool-output cache with TTL/quota.

## 13. Compression cache privacy and correctness

- **Options:** in-memory only; encrypted per-workspace disk cache; SQLite plaintext; content-addressed external store.
- **Current behavior:** plaintext SQLite, 64-bit hash prefix, no TTL/quota/namespace (`src/core/compression/ccr-store.ts`).
- **Plan position:** reversible persistent cache injected into model tools.
- **Tradeoffs:** reversibility improves context efficiency but stores exactly the content redaction may have intended to hide.
- **Recommendation:** human decision on persistence. Default to in-memory, thread-scoped, size-bounded cache; never persist secrets by default.

## 14. Telemetry versus security audit

- **Options:** opt-in OTel only; local structured audit log; both; managed audit backend.
- **Current behavior:** partial OTel spans and default localhost exporter; no authoritative audit log.
- **Plan position:** OTel spans described as auditability.
- **Tradeoffs:** telemetry is sampled/transport-dependent and may leak content; audit logs need integrity, actor identity, retention, and access control.
- **Recommendation:** separate the concepts. Keep telemetry opt-in; define minimal durable security decision events if enterprise audit is a V1 requirement.

## 15. Public API stability and packaging

- **Options:** declare current exports experimental; stabilize selected library API; CLI-only internal modules.
- **Current behavior:** broad barrel exports expose partial persistence/compression abstractions; package lacks an `exports` map and CLI entry behavior.
- **Plan position:** prescribes files but not compatibility or release policy.
- **Tradeoffs:** stabilizing too early locks in concrete SQLite and AI SDK types; changing silently harms adopters.
- **Recommendation:** mark 0.x API experimental, define a small intentional entry surface, add package smoke tests, and avoid stability claims until E2E baseline passes.
