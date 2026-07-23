# ForgeEngine Capability Radar

Date: 2026-07-10. Status: research conclusion; no dependency or service adoption implied.

## Thesis

ForgeEngine should not compete by accumulating the longest feature list. Its differentiating paradigm is a **software-evidence runtime**: deterministic repository facts, inspectable context plans, validated change transactions, replayable trajectories, and outcome-based adaptation make every model—especially local models—more capable and cheaper to use.

The model remains responsible for ambiguity, tradeoffs, synthesis, and intent. Deterministic systems establish facts, constrain operations, and verify outcomes.

## Classification method

- **Core now:** changes the event protocol, artifacts, context, persistence, or host contracts.
- **V1 product:** required for a genuinely useful daily developer workflow, but can be built over the core.
- **Experiment:** promising, bounded, independently evaluable, and removable.
- **Defer:** valuable but would broaden the product or force premature operational complexity.

## Capability radar

| Capability | Classification | Forge-native treatment | Why it matters |
|---|---|---|---|
| Versioned runtime events and artifacts | Core now | Canonical event stream, artifact references, trace metadata | Makes host adapters, replay, evidence, learning, and recovery coherent |
| Context compiler | Core now | Typed context items, budgets, protected regions, transformations, retrieval, measurement | Optimizes complete cost-to-accepted-outcome, not single-turn token count |
| Repository intelligence | Core now | Filesystem, Git, search, parsers, language-server facts, diagnostics, test evidence | Gives local/cloud models structured ground truth instead of raw repository text |
| Capability virtualization | Core now | Discoverable capability groups and task-scoped tool exposure | Avoids tool overload and unnecessary context cost |
| Task/change transaction | Core now | Plan, patch proposal, validation, evidence, checkpoint, apply/reject | Treats code changes as reviewable artifacts rather than incidental tool calls |
| Replayable trajectories | Core now | Exact input/context/action/artifact/config trace with replay support | Enables regression tests, debugging, skill evaluation, and routing evaluation |
| Workspace snapshot identity | Core now | Repository, revision, dirty state, worktree, toolchain/config metadata | Makes results, replay, and validation meaningful |
| Deterministic kernel and mock provider | Core now | Provider-neutral state machine and contract suite | Allows architecture validation without vendor behavior |
| CLI with streaming, cancellation, and evidence | V1 product | First host adapter | Developer delight and debuggability constrain the event model early |
| Read/search/symbol/diagnostic capabilities | V1 product | Read-only repository intelligence pack | Highest-value deterministic evidence for coding tasks |
| Patch/edit, process, Git, test validation | V1 product | Mutable developer capability pack | Completes a useful coding workflow |
| Durable sessions and artifacts | V1 product | Events, snapshots, artifact store, session search | Enables continuation, recovery, evidence, and later learning |
| Manual skills and bounded memory | V1 product | Procedural skills distinct from scoped factual memory | Captures developer workflows without self-modifying behavior |
| MCP apprentice adapter and VS Code validation | V1 product | MCP over same runtime/capability contracts | Proves host neutrality and Codex/Copilot complementarity |
| Local provider plus one cloud path | V1 product | Provider capability contracts and explicit routing records | Validates sovereign-first plus deliberate escalation |
| Worktree-aware tasks | V1 product design; implementation can follow | Workspace snapshot and execution-backend contracts now; Git worktree backend after mutable loop | Needed for safe parallel work and reversible change workflows |
| Structured architect/editor split | Experiment | Planning provider produces an explicit change plan; editing provider/engine executes it | Aider demonstrates useful separation, but it must beat a single-loop baseline |
| Headroom sidecar/proxy integration | Experiment | Context-transform adapter and benchmark harness | Lets Forge test transparent external optimization without importing its architecture |
| Graph relationship projection | Experiment | Rebuildable provenance, dependency, skill, and delegation graph | Valuable for impact analysis and memory; not a V1 source-of-truth database |
| Evaluated routing policy | Experiment | Select provider/strategy by observed outcome/cost data | Better than heuristics, but only after trace and fixture data exist |
| Skill candidate compiler | Experiment | Derive an inert candidate from a successful trace, replay/evaluate, then request activation | Makes “learning” inspectable and reversible |
| Background monitor | Experiment | Structured watch/notification capability bound to a session | High daily value for builds, logs, and CI; requires lifecycle and resource semantics |
| Parallel subagents/worktree teams | Defer | Delegation contract and worktree seam first | Multiples cost, coordination, and failure modes before single-agent reliability is proven |
| Scheduler/cron/messaging gateways | Defer | Future platform capability pack | Changes ownership, notification, and persistence requirements |
| Browser/computer use | Defer | Future execution/capability pack | Broad, risky operational surface unrelated to developer-loop proof |
| Plugin marketplace | Defer | Signed/versioned capability and skill distribution after local lifecycle is proven | Supply-chain and compatibility product in itself |
| Enterprise DLP/governance product | Defer | Policy adapters and audit export seams now | Organization infrastructure should integrate with Forge, not delay local V1 |

## Paradigm-shaping capabilities

### 1. Context plans, not blind prompt assembly

Each inference call should have an inspectable plan:

```text
Exact: user requirements, current diff, failures, policy-relevant instructions
Structured: repository map, diagnostics, symbol/reference facts
Retrievable: complete logs, source files, artifacts, older results
Excluded: irrelevant or superseded items, with a recorded reason
```

This is more powerful than generic compression because it makes context selection explainable, model-aware, and evaluable.

### 2. Repository intelligence as a deterministic evidence layer

Aider demonstrates the value of tree-sitter-backed repository maps, symbol tags, rank-aware selection, syntax checks, and structured edit/validation loops. Claude Code demonstrates language-server-backed definitions, references, call hierarchies, types, implementations, and diagnostics.

Forge should expose language-neutral facts such as `SymbolInfo`, `ReferenceSet`, `Diagnostic`, `FileMap`, `DiffSummary`, and `TestEvidence`. The context compiler consumes those facts before it considers raw source. Parser, language-server, Git, search, and test adapters remain replaceable.

### 3. Change transactions

The unit of mutable work should be a transaction:

```text
Task → planned change → proposed patch → deterministic validation → evidence → apply/reject → checkpoint
```

This makes developer review, worktree isolation, rollback, PR preparation, and later autonomous operation extensions of the same model. It is superior to treating edits, terminal commands, and Git changes as unrelated tools.

### 4. Replayable trajectories

SWE-agent records model output, action, observation, state, exact query, configuration, and environment results; it can replay actions and compare runs. Forge should use the same principle for developer workflows, but its trace must additionally record context-plan and transform decisions, policy/approval decisions, artifact IDs, workspace snapshot, provider profile, and validation evidence.

Trajectories are the substrate for regression testing, outcome evaluation, skill candidates, provider routing, and incident review.

### 5. Outcome-normalized optimization

Forge should optimize for accepted outcomes per total resource—not merely token savings, latency, or number of steps. Every context transform, provider route, skill, and planning strategy must be compared against an unoptimized/simpler baseline on the same task fixture.

```text
accepted task quality / (all model tokens + tool cost + retries + latency + human correction)
```

This guards against a locally efficient compression or routing decision that causes more expensive failure recovery.

### 6. Capability virtualization

Do not expose every tool, skill, MCP server, and operation on every turn. Expose a small stable discovery surface, then load capability groups, detailed schemas, and skill bodies only when relevant. This applies one principle across tools, skills, MCP, and developer roles.

### 7. Learning as compilation

A successful trajectory is evidence, not automatically a skill. Forge should compile it into a candidate procedure, attach provenance and scope, validate/replay it, compare its outcome against a baseline, and require explicit activation. The same approach supports memory candidates, routing policies, and context rules.

### 8. Workspace snapshots and worktree-aware execution

Every task must identify the exact repository, revision, dirty state, worktree, configuration, and toolchain context it used. Git worktrees are a natural later backend for isolated mutable tasks, but the event/artifact model must record this identity from the start.

## What to take from reference systems

| Reference | Transferable principle | Do not copy blindly |
|---|---|---|
| Hermes | Shared agent core across surfaces; progressive skills; bounded/frozen memory; toolsets; session search | Monolithic accumulated lifecycle/configuration coupling |
| Headroom | Typed transform pipeline; protected invariants; reversible retrieval; cross-turn awareness; measurements | Treating a large proxy/SDK stack as a dependency or measuring only token savings |
| Codex | Versioned runtime/app-server protocol; append-oriented traces; dynamic tools; platform-specific execution backends | Claiming equivalent sandboxing from simple command rules |
| Claude Code | Language-server evidence; lifecycle hooks; scoped tools; worktrees; compaction guards | Assuming host permissions govern nested Forge actions |
| Aider | Repository map; ranked symbols; structured patch formats; lint/test repair; architect/editor separation | A single tree-sitter map as a substitute for language-server and validation evidence |
| SWE-agent | Reproducible trajectories; environment snapshots; replay; compare-runs; evaluation separated from generation | Benchmark-only workflows that do not support daily developer experience |
| VS Code | Custom agent roles/handoffs; workspace customizations; MCP/extension tool surfaces | Making VS Code-specific files the kernel's public contract |

## Deliberate non-goals

- A generic vector-RAG index over every repository file is not an early default. It must prove value beyond deterministic repository intelligence and exact retrieval.
- A graph database is not an early source of truth. Relationship projections are sufficient until measured traversals demand more.
- Multiple autonomous agents are not a substitute for clear task/change transactions.
- A marketplace is not a substitute for a secure local skill/capability lifecycle.
- Semantic summaries do not replace exact artifacts.
- A provider abstraction does not justify supporting every provider before contract tests exist.

## Research conclusion

The next implementation work should be Phase 0: specify and test the runtime event protocol, context item/provenance model, task/change transaction, workspace snapshot, trajectory format, evaluation fixture format, and repository-intelligence contracts. These are the smallest set of primitives that enable parity with leading coding harnesses while leaving Forge room to exceed them through outcome-aware context planning and portable host operation.
