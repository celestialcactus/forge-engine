# ForgeEngine V1: validated build plan

**Status:** authoritative for V1 planning
**Date:** 2026-07-10
**Last groomed:** 2026-08-17 after repository/contract authority clarification
**Supersedes for execution planning:** `forgeengine-v1-reconstruction-plan.md`
**Historical only:** `forgeengine-proposed-plan-v2.md` and `docs/archive/prototype/`

## How to use this plan

This document is the V1 architecture and roadmap authority; it is intentionally not
the live branch dashboard. The [current execution index](../execution/current.md)
records the accepted implementation baseline, active lanes, dependencies, merge
order, and unresolved decisions. The
[release profiles](forgeengine-release-profiles.md) define which product and
containment claims are permitted at each delivery stage. The
[clarified decision register](forgeengine-clarified-decision-register.md) and
[system map](forgeengine-v1-system-map.md) provide the current human-readable
decision summary and architecture diagram.

Runtime schemas and tests describe implemented behavior, accepted ADRs describe
durable decisions, this plan describes scope and gates, slice tasks bound an
increment, and checkpoints preserve evidence. A candidate branch does not become
accepted state until its exact implementation is merged and its required gates pass.

## The V1 promise

ForgeEngine is a **software-evidence runtime** for a developer workspace. It can
run independently, orchestrate a provider, be exposed as an MCP apprentice, or be
embedded by another host. In every mode it creates the same inspectable record of
what evidence was selected, what capability acted, what changed, and whether the
result was verified.

It is sovereign-first: local execution and local models are first-class choices.
It is not isolationist: a user or host policy may deliberately escalate a task to a
cloud provider. In V1 Forge complements Codex, Copilot, IDEs, and organization
harnesses by making their interaction with a workspace more evidence-driven and
controllable. Those integrations are an adoption path, not a permanent product
dependency or ceiling.

The delivery amendment in `forgeengine-v1-demo-and-interop-plan.md` prioritizes a
demonstrable prototype by 2026-08-22: TypeScript remains the high-velocity tool,
workflow-definition, provider, MCP, and IDE integration layer; Rust owns final
policy resolution, workflow execution state, evidence ordering, and the machinery
required for baseline sovereign operation.

## Design invariants

1. **One kernel, many hosts.** CLI, MCP, IDE, cloud-hosted master, and embedded
   modes consume the same run protocol and capability contracts.
2. **Evidence before prose.** Search, symbols, diagnostics, git state, test output,
   and snapshots are deterministic inputs. The model interprets evidence rather
   than fabricating repository facts.
3. **Context is compiled, not merely shrunk.** Each supplied item has provenance,
   a budget class, a reason, and an optional reversible representation.
4. **Every action has an artifact.** Runs, context plans, capability requests,
   results, approvals, patches, and verification outcomes can be replayed or
   inspected.
5. **Capabilities are virtualized.** Hosts declare or grant capabilities; the core
   does not assume terminal, filesystem, network, or provider access.
6. **Learning is reviewable.** Observations may become skill candidates, but only
   explicit promotion changes a reusable skill in V1.
7. **Security is layered.** Early V1 prevents obvious foot-guns and exposes
   approvals/intent. Strong process/filesystem/network isolation is a separately
   testable hardening layer, not a claim made by the initial TypeScript runtime.
8. **Interoperability is bidirectional.** Forge can be exposed as an apprentice or
   consume another harness's tools without importing host-private state into the
   kernel. Delegations carry origin, depth, budget, cancellation, and idempotency.
9. **One policy authority.** TypeScript may collect host policy facts and user
   consent; Rust resolves and records the final Forge allow, deny, or ask outcome.

## V1 vertical slices

The numbers below describe capability maturity, not the immediate execution order.
Each slice is independently useful and has an objective exit gate. We do not start
the next slice because its source files compile; we start it because the prior
slice has usable behavior, trace evidence, and a passing fixture.

| Slice | User-visible outcome | Core work | Exit gate |
| --- | --- | --- | --- |
| 0. Protocol and fixtures | A developer can inspect a stable, simulated run. | Define event vocabulary, IDs, run state machine, cancellation, error/retry semantics, artifact schema, fixture workspaces, golden traces. | Golden traces cover success, denied approval, tool error, cancellation race, and budget exhaustion; type-level and behavior tests pass. |
| 1. Deterministic kernel | `forge run` can execute a scripted plan against read-only workspace evidence and explain its result. | Run coordinator, capability registry, approval interface, read/search/git/diagnostic evidence adapters, streamed events, deterministic provider. | The same fixture/run inputs produce the same ordered trace and context plan on repeated runs. |
| 2. Developer change loop | Forge can propose, apply, and verify a small patch with full evidence. | Patch artifact, explicit write capability, process/test capability, change transaction, rollback/reporting boundaries, worktree design spike. | A fixture task produces a reviewable diff, test result, and final evidence summary; failed verification leaves a clear recoverable state. |
| 3. Context compiler | Forge chooses bounded, attributable context for a task. | Context item model, token/size budgets, deterministic selection, tiering, transforms, retrieval handles, metrics. | Baseline and compiled context are compared on fixtures; no transform is enabled by default without meeting the quality gate. |
| 4. Sessions and projections | A run can resume, be inspected, and be replayed without relying on chat history. | Append-only events/artifacts, SQLite projections, workspace snapshot identity, trace export/replay. | A recorded fixture run replays deterministically and projections reconstruct its current state. |
| 5. Skills and bounded memory | A developer can load a reviewed workflow skill and inspect why it applied. | Skill manifest/provenance/scope, progressive disclosure, memory observations, candidate/promote workflow. | A skill improves a fixture workflow without hidden prompt injection; every applied instruction is attributable. |
| 6. VS Code MCP apprentice | VS Code can ask Forge for evidence and invoke a bounded workflow. | MCP server, capability advertisement, cancellation/progress mapping, `.vscode/mcp.json` sandbox fixture. | MCP conformance and the VS Code fixture demonstrate cancellation, errors, trace links, and no host-specific core fork. |
| 7. Providers and escalation | A user can select local or cloud execution under an explicit policy. | One local provider adapter, one cloud adapter, streaming/tool-call normalization, provider policy, cost/latency telemetry. | Identical capability scenario passes provider conformance tests; escalation is explainable and opt-in. |
| 8. Hardening and release | A developer can rely on documented, tested runtime boundaries. | Windows and macOS process/filesystem isolation backends, migration/upgrade, packaging, observability, recovery, compatibility matrix. | Threat-model claims are backed by platform tests and release gates; unsupported boundaries are documented as such. |

### Current delivery focus

Slices 0 and 1 are accepted. Slice 2A through Slice 2D are accepted: Forge can
propose bounded text replacements, verify them in an isolated worktree, retain the
candidate, and explicitly promote or discard it through Rust-owned authority.

Slice 2E is accepted. Content-addressed staging, the complete bounded
change-operation model, durable transaction coordination/startup recovery,
cross-platform verifier owner-death handling, terminal candidate cleanup, and one
sovereign `forge change propose|inspect|accept|discard` workflow now share the
same Rust authority. [Checkpoint 38](../decisions/checkpoints/2026-07-30-38-sovereign-cli-hosted-and-vscode-gate.md)
records the hosted and VS Code gate.

Windows and macOS remain Tier-1 product and acceptance platforms. Ubuntu remains
a Tier-2 compatibility gate because local/server deployments and CI must not
require a platform fork. Advanced context compilation, automatic retrieval,
learned skills, provider expansion, and broader durable projections remain behind
this functional core; the accepted local/cloud paths and bounded run recovery are
not reopened by that sequencing.

The current short gate is `ARCH-AUTHORITY`, after which the critical path returns to
`CLI7-ALPHA`, the clean-install trusted developer alpha described in the
[execution index](../execution/current.md). Native
restricted execution continues as the independent `SBX-PROVIDER-LIFECYCLE` lane;
an additive `CLI8A-MEMORY-FOUNDATION` candidate may be prepared in parallel but
cannot become runtime-active before its evaluation and integration gates.

Slice 2F remains the native-isolation hardening boundary. Slice 2F-1 is accepted: provider
authority is explicit and raw host/restricted claims fail closed. Slice 2F-2a is
also accepted: Forge can issue, strictly verify, durably consume, and later re-audit
a short-lived host-signed challenge bound to capability, policy, provider, and
controls. Slice 2F-2b is accepted on `develop` at merge `6bc2bfb`: Rust derives the
exact transaction/policy bindings, an authenticated provider turns consumed
evidence into a one-use grant, and transaction v2 carries the bounded host exchange.
Native Windows/macOS/Ubuntu and controlled VS Code gates passed. Slice 2F-3 still
must prove a minimum Windows/macOS restricted backend adversarially, but ADR-0017
moves that substantial platform program off the critical path for a clearly labeled
trusted developer alpha.

## Near-term CLI ship lane

This lane remains the immediate execution priority. In current execution terms its
open increment is `CLI7-ALPHA`; earlier numbers below are retained as capability
history, not active branch names. The broader V1 slices remain authoritative
capability goals.

1. **Kernel convergence — accepted and merged as PR #15 (`1fcab25`).** One canonical Rust runtime/capability/event/artifact/
   policy authority; TypeScript remains integration and an explicitly named
   conformance fixture. **Exit:** CLI and MCP cannot silently fall back to a second
   coordinator, product smoke uses Rust, and missing-kernel state is actionable.
2. **Real inference path — accepted and merged as PR #16 (`e865de5`).** One measured local Ollama family and one
   direct OpenAI Responses transport use normalized text/tool/usage/finish evidence
   with explicit routing and no fallback. The canonical `TaskPlanner` bridge is
   retained; the fake inventory-backed `forge run` and superseded public candidate
   surface are removed. OpenAI was transport-conformant rather than live-accepted
   at that merge because no cloud credential was present; credentialed live
   acceptance is recorded under increment 3. **Exit achieved:** hosted Windows/macOS/Ubuntu,
   exact-kernel product, live local text/tool, cancellation/error conformance, and
   controlled VS Code gates pass.
3. **Live CLI loop — accepted and merged as PR #17 (`0441d865`; implementation `5b8d226`).**
   Validated provider text streams in human mode, canonical Rust lifecycle status
   remains authoritative, --json stays terminal-only, and Ctrl+C/deadline
   cancellation share one abort path. Ollama now declares an 8K context, uses
   deterministic agent sampling, projects compact read evidence, and rejects
   printed tool-protocol envelopes. Plain forge auto-discovers local Ollama, shows
   effective state, and accepts repeated independent prompts and slash controls.
   Live Qwen text, repeated one-tool continuation, JSON isolation, timeout cleanup,
   typecheck, 58 tests, and build pass locally. A measured 0.5B/1.5B/3B/7B ladder
   also removed locator-only pseudo-context, reduced the 7B one-read input about
   29.5%, and established task-specific floors without adding automatic routing.
   An earlier two-tool Qwen stress case stopped early and hallucinated. The
   corrected synthetic two-tool flow now passes through both Qwen 7B and OpenAI,
   but runtime completion is still not outcome verification. **Exit:** a developer launches plain
   forge, sees effective provider/model/workspace state, completes an
   evidence-backed repository task interactively without reconstructing flags, and
   the hosted plus controlled VS Code gates pass. **Controlled VS Code achieved:**
   one summary call returned the canonical evidence/event projection without a
   retry loop. **Hosted achieved:** exact implementation `5b8d226` passed Node on
   Windows/macOS (Actions run `30867433664`) and the real Rust-kernel/TypeScript
   product on Windows/macOS/Ubuntu (Actions run `30867433674`). Credentialed
   synthetic OpenAI text, bounded-read, and search-to-read gates pass. Increment 3
   is accepted and merged; increment 4 now proceeds on its own feature branch.
4. **Developer capability pack - accepted and merged through PR #20 (`2ff5669`; implementation `1cc1e3f`).** Bounded read/search, patch/edit, process/test,
   Git status/diff, and verification over the accepted authority. Add an explicit
   outcome-verification state that distinguishes a valid terminal planner turn from
   an evidence-grounded accepted result; do not infer correctness from model prose.
   The 4A foundation now adds Rust-authoritative bounded outcome contracts,
   RunArtifact v2, bridge v4, and explicit `not_evaluated` / `verified` / `unmet`
   states. Exact-head hosted Windows/macOS/Ubuntu, 39/39 local hybrid, product
   smoke, and controlled one-call VS Code gates are green at `be2069a`. Increment
   Increment 4B-1 prepared identity/approval binding and 4B-2 interactive edit
   composition are accepted on `feature/cli-edit-verification-composition`.
   Exact-head hosted Windows/macOS/Ubuntu, a full promoted Qwen flow, and a
   controlled seven-tool VS Code regression are green at implementation `bbf119e`.
   Increment 4B-3a implements RunArtifact v3, bridge v5, Rust-authored
   digest-bound prior-capability context, and bounded typed capability evidence;
   exact-head Node Windows/macOS and real hybrid Windows/macOS/Ubuntu gates are
   accepted at `4ac3346`. Increment 4B-3b removes the post-terminal edit handoff:
   a CLI-only governed capability performs review, explicit decisions,
   verification, and promotion/discard/retain before the still-open Rust run
   completes. Exact implementation `1cc1e3f` passed the 79-test local gate, Node
   Windows/macOS, real hybrid Windows/macOS/Ubuntu, an exact-kernel live Qwen
   promoted transaction, and a controlled one-call seven-tool VS Code gate. See
   [CLI ship lane 4](../tasks/SLICE-CLI4-developer-capabilities.md),
   [ADR-0024](../decisions/ADRs/ADR-0024-model-plan-and-rust-change-composition.md),
   [ADR-0025](../decisions/ADRs/ADR-0025-rust-owned-capability-context-and-lifecycle.md),
   [Checkpoint 64](../decisions/checkpoints/2026-08-04-64-interactive-edit-accepted.md),
   [Checkpoint 65](../decisions/checkpoints/2026-08-04-65-rust-owned-capability-context-local-gate.md),
   and [Checkpoint 66](../decisions/checkpoints/2026-08-04-66-governed-edit-lifecycle-local-gate.md).
   **Exit:** a representative change is proposed, reviewed, verified, accepted or
   discarded, and fully attributed without generic raw powers; unsupported claims
   cannot silently inherit an accepted verification state.
5. **Approval and control - accepted through 5C.** Visible
   allow/ask/deny, approval callbacks, cancellation, timeouts, iteration/tool
   budgets, and honest execution posture. Increment 5A proves cancellation-safe
   human waits. Increment 5B adds RunArtifact v4, bridge v6, Rust-owned
   pre-admission capability ceilings, cumulative provider-reported input/output
   ceilings, exact usage counters, fail-closed missing usage, and direct-kernel
   turn validation; it is merged on `develop` through PR #22 at `74308ca`.
   Increment 5C removes fixed product policy mappings and exposes exactly three
   fact-producing profiles: developer, review, and locked. An embedded review
   callback receives the exact call and Rust-authored context; missing callbacks
   remain unresolved ask/no-invoke. Rust is still the only decision authority.
   Local 91/91 tests, build, focused exact-kernel parity, live Qwen 1.5B grant and
   decline, and a one-call seven-tool controlled VS Code regression pass. Exact
   implementation `2941948` then passed hosted Node Windows/macOS and hybrid
   Windows/macOS/Ubuntu, closing the 5C gate.
   See [CLI ship lane 5](../tasks/SLICE-CLI5-approval-control.md),
   [ADR-0026](../decisions/ADRs/ADR-0026-cancellation-safe-approval-callbacks.md),
   [ADR-0027](../decisions/ADRs/ADR-0027-rust-owned-execution-budgets.md),
   [ADR-0028](../decisions/ADRs/ADR-0028-product-approval-profiles.md), and
   [Checkpoint 71](../decisions/checkpoints/2026-08-05-71-policy-profile-and-host-callback-local-gate.md), and
   [Checkpoint 72](../decisions/checkpoints/2026-08-05-72-policy-profile-hosted-acceptance.md).
   **Exit:** denial, cancellation, timeout, and exhaustion are deterministic through
   CLI and embedded-host fixtures, and the exact head passes hosted Tier-1/Tier-2
   conformance.
6. **Recovery state - 6A/6B, atomic initialization, and ChangeSet cross-link local/VS Code gates passed.**
   Bridge v10 keeps request, canonical events, terminal artifact, capability replay
   descriptors, and a bounded interaction transcript under the Rust run authority.
   `forge runs resume` re-enters the same `Slice0Runtime`, consumes recorded
   completions without host calls, suppresses the exact durable event prefix, and
   appends only new events. One deliberately authorized evidence retry is allowed;
   ambiguous provider/approval work and all unresolved non-idempotent work block.
   Initial lock acquisition no longer creates an authoritative run directory. Rust
   builds and synchronizes the complete initial ledger in a private directory,
   closes Windows-sensitive handles, then publishes it with one directory rename.
   For governed change, the workflow now waits for Rust to durably acknowledge a
   typed registered ChangeSet transaction checkpoint before asking for promotion,
   retention, or discard. Inspection exposes that authoritative journal reference;
   the outer non-idempotent capability is still never replayed.
   See [CLI ship lane 6](../tasks/SLICE-CLI6-run-recovery.md),
   [ADR-0029](../decisions/ADRs/ADR-0029-append-before-notify-run-ledger.md),
   [ADR-0030](../decisions/ADRs/ADR-0030-durable-interaction-transcript-and-safe-continuation.md),
   [Checkpoint 76](../decisions/checkpoints/2026-08-05-76-safe-run-continuation-local-gate.md),
   [Checkpoint 77](../decisions/checkpoints/2026-08-05-77-atomic-run-initialization-local-gate.md),
   and [Checkpoint 78](../decisions/checkpoints/2026-08-06-78-changeset-recovery-checkpoint-local-gate.md).
   **Exit:** exact-head hosted Windows/macOS/Ubuntu pass. Orphaned staging and
   registered-but-never-finalized ChangeSet policy remain release-hardening work,
   not parallel runtime work.
7. **Release hardening.** Clean install, Windows boundary decisions, `doctor`,
   smoke tests, packaging, effective config, and verified docs. **Exit:** fresh
   Windows and macOS environments install and run the documented trusted alpha
   workflow. Native restricted providers are separately accepted platform gates and
   cannot block this exit or borrow acceptance from it.

## Post-alpha differentiated learning lane

This becomes the product critical path immediately after the clean-install trusted
alpha gate. Native sandboxing remains required platform work, but proceeds as a
bounded commodity-provider lane under
[ADR-0034](../decisions/ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md);
it does not hold memory, context, or reviewed-skill discovery behind custom OS
engineering. Execution details and acceptance fixtures are tracked in
[Slice CLI8](../tasks/SLICE-CLI8-differentiated-learning-loop.md).

This is dual-track sequencing, not abandonment of sandbox completion. The managed
Windows and macOS provider gates continue through bounded compatibility and
adversarial increments using established patterns. A trusted alpha may ship with an
explicit no-containment posture; a restricted beta or enterprise-ready claim may not
ship until the relevant native provider gates pass.

The sandbox wraps governed capability execution, not local inference by default.
Provider acceptance therefore measures both containment and end-to-end local-model
efficiency: setup/launch latency, materialized bytes, tool compatibility, retries,
corrective turns, total task tokens, and accepted outcomes versus trusted execution.
Full workspace/toolchain copying per invocation and mandatory remote policy services
are incompatible with the sovereign-first default.

1. **Attributable candidate memory.** Derive typed observations from exact user,
   run, capability, workspace, and verification evidence. Every observation carries
   scope, provenance, confidence, freshness, and correction/deletion behavior.
2. **Measured contextual retrieval.** Select or omit observations through the
   context compiler and compare accepted task quality, corrective turns, latency,
   and total tokens against a no-memory baseline. Token reduction alone is not an
   acceptance metric.
3. **Pattern-to-skill candidate.** Detect repeated, generalizable workflow structure
   and produce an inspectable skill candidate with its supporting runs and limits.
4. **Reviewed promotion and reuse.** A developer can edit, accept, reject, retire,
   and audit the candidate. Only promoted skills may be reused, and reuse must pass
   through the same capability, policy, transaction, and evidence contracts.
5. **Differentiation gate.** On a controlled repeated-workflow fixture, accepted
   memory and a promoted skill improve outcome quality or effort without hidden
   instructions, evidence loss, extra corrective turns, or higher total task cost
   beyond the declared budget.

Automatic unreviewed skill activation, opaque developer profiling, and memory that
cannot be attributed or corrected are not accepted shortcuts.

### Deferred but retained platform slices

The first context-compilation, scoped-memory, and reviewed-skill loop is promoted to
the post-alpha critical path above. More advanced compression/retrieval, durable
projections/search, MCP/VS Code mutation symmetry, first-party connectors and
messaging, automation, a broader UI, native restricted execution beyond its bounded
provider lane, and future generalized platform surfaces remain planned. They must
reuse the same run, evidence, policy, capability, and artifact contracts; none may
create a parallel runtime inside Forge. Project Sybil is a separate sovereign
agent-orchestration project with its own runtime, repository, roadmap, and release
gates. It is neither a Forge slice nor Forge's eventual product form.

The [Grok Bot competitive review](../audit/2026-08-13-grok-bot-sybil-pattern-review.md)
records transferable product lessons for Sybil: canonical task threads that continue
across surfaces, portable persistent execution cells, reviewed
demonstration-to-routine compilation, durable schedules and proactive triggers,
API/MCP-first application control with an evidence-producing browser/computer
fallback, and typed multi-worker delegation. The corresponding
[Project Sybil working specification](project-sybil-working-spec.md) defines their
independent order and gates.

These are lessons and optional interoperability candidates, not downstream Forge
features or reasons to expand the current CLI slice. Forge continues proving
attributable memory and reviewed skills for developer workflows. Sybil separately
decides which resulting concepts, protocols, evaluations, or components fit its own
platform. Within Sybil, a single persistent worker and restart/cross-surface
continuity precede schedules, UI operation, or multiple workers. Multi-worker
execution must beat a single-worker baseline after counting coordination calls,
context, latency, recovery failures, and total cost.

## Historical first build target: Slice 0 and the narrow Slice 1 spine

This was the deliberate initial vertical slice and is retained to explain the
accepted sequencing. Slices 0 and 1 are complete; current work is listed above.

```text
fixture workspace
    -> deterministic evidence adapters (tree/search/git)
    -> context-plan artifact
    -> scripted provider response
    -> read-only capability result
    -> ordered run-event log + final summary
```

It deliberately excludes real cloud credentials, automatic compression, database
migrations, unreviewed skills, mutation, terminal execution, and VS Code runtime
integration. Those are not omissions; they keep the protocol measurable before it
becomes expensive to change.

### Slice 0 acceptance cases

- successful run with streamed events and a final artifact index;
- request denied before a capability executes;
- tool/capability failure represented without corrupting run state;
- cancellation requested before completion and after completion (both legal);
- context budget exceeded with a transparent, recoverable result;
- repeated run on the same fixture produces equivalent trace and evidence plan;
- an external host adapter can consume the event stream without importing core
  implementation details.

## Context compiler contract

The compiler has five stages, each independently observable:

1. **Collect:** obtain provenance-bearing evidence from deterministic tools,
   explicit user input, skills, and prior run artifacts.
2. **Classify:** label item type, volatility, authority, relationship to task, and
   whether a tool request/result must remain atomic.
3. **Plan:** choose the minimum sufficient evidence under an explicit budget.
4. **Represent:** use original material, deterministic summaries, structured
   excerpts, or an optional reversible transform. Failure leaves the original
   material available.
5. **Measure:** record selected/omitted material, retained evidence, tokens/bytes,
   latency, provider cost, turns, verification outcome, and user correction.

The operational metric is **cost to accepted outcome**, not compression ratio. A
transform that saves tokens but causes an additional model turn or a failed edit is
a regression.

## State and storage decision

Use an append-only event/artifact log as the source of history and SQLite as a
local query projection. Keep the first schemas simple and migratable. A graph is
an optional projection derived from files, symbols, references, runs, and skills;
it is not the source of truth and does not justify a graph database in V1.

This supplies the useful part of event sourcing—replay, auditability, and multiple
views—without prematurely adopting distributed-event complexity. It also makes a
future cloud sync or enterprise retention adapter possible without changing the
kernel's semantic model.

## Security posture for V1

The initial local-developer profile favours informed, visible control rather than
heavy enterprise friction. It must still provide:

- explicit capability intent and approvals for mutation/process/network actions;
- provenance, traceability, and clear host/provider boundaries;
- no implication that an in-process rule is a containment boundary;
- adapter points for organisational egress, DLP, identity, and audit systems.

Robust enforcement remains a platform-specific backend. ADR-0008 and ADR-0014 now
define the Rust provider, capability, and evidence authority before a backend is
selected: developer-permission execution records no containment, raw host-managed
assertions fail closed, and unavailable Forge-restricted execution fails closed.
Windows and macOS restricted mechanisms still require separate spikes and
adversarial platform gates; Ubuntu remains a compatibility target behind the same
provider contract.

### Honest current limitations

- No production-selectable Forge-enforced operating-system sandbox exists yet. A
  Windows AppContainer preview now passes nine focused local boundary tests, but it
  remains `setup_required` and its launcher is conformance-only.
- The managed-provider follow-up now composes Forge-owned process/memory Job limits,
  and the same fresh five-control schema-v4 corpus passes 17/17 on managed Windows
  and 17/17 on AppContainer with clean lifecycle/ACL/recovery evidence. This is not
  readiness: both remain `setup_required`. Schema-2 payload/hash/license/NOTICE and
  lifecycle orchestration are prepared and locally verified, but VM install/reboot/
  real-upgrade/uninstall, hosted Windows, broader credential channels, and macOS
  gates remain open. The SRT application dependency remains absent. See Checkpoints
  82-84.
- Managed Windows, AppContainer, and the shared provider-conformance path are
  evaluation modules under ADR-0033. They independently reproduce useful public
  architecture, patterns, and obvious structural ideas in Forge's authority model;
  they do not copy external implementation source verbatim. Any later substantial
  source reuse is a separate adoption and legal/provenance decision.
- The AppContainer preview now projects policy-owned Node/npm/Git/Cargo/compiler and
  shell paths under protected `.forge-toolchain` with read/execute-only grants and
  passes the shared compatibility corpus without changing external executable ACLs.
  Its bounded positive-grant/root-path design, broader credential coverage, package,
  and hosted evidence remain production blockers; see ADR-0033 and Checkpoint 83.
- Host-managed isolation is unavailable through the baseline provider. The signed,
  freshness/replay-bound challenge ledger is accepted, but no executing provider
  or host/kernel negotiation bridge consumes it yet.
- The Rust kernel still inherits the host environment and operating-system
  permissions. Slice 2D clears and reconstructs the verification child environment
  from a small baseline plus explicit policy values/names; exact implementation
  `1339f53` passed hosted Windows, macOS, and Ubuntu conformance. This is exposure
  reduction, not sandboxing.
- The seven MCP tools remain read-only. No MCP mutation tool, generic shell/write
  tool, public workspace-write capability, or public transaction API exists.
- Slice 2C persists opaque candidate leases and provides the hosted-accepted,
  trusted-only `forge.kernel.transaction.v1` bridge (`fa9898f`). Slice 2D adds the
  private `forge.kernel.candidate.v1` inspection/promotion/discard bridge and a thin
  experimental `forge candidate` CLI. Exact implementation `8693684` passed local
  and hosted Windows, macOS, and Ubuntu conformance.
- Promotion is bounded to existing regular files. It uses Git applicability checks,
  exact-byte atomic replacement, durable recovery backups/journals, fresh approval,
  and revision/path/digest revalidation. It is process-crash recoverable, not a
  power-loss filesystem transaction, and external editors do not honor Forge's
  advisory repository lock.
- ChangeSet v2 has hosted-accepted candidate and active-workspace adapters for every
  accepted operation plus a durable Rust coordinator for promotion, rollback, and
  startup reconciliation. This is process-crash recovery, not a power-loss
  transaction. Repository identity uses tracked Git spelling plus
  `core.ignorecase`; new non-ASCII paths fail closed on case-insensitive
  repositories until native Unicode identity semantics are proven on Windows and
  macOS.
- CLI ship-lane 7A now cleans exact unpublished staging only under the repository
  publication lock and exposes a bounded Rust-owned transaction audit. Published
  prepared work is review-due after 24 hours but is never age-deleted. The local
  gate passes; exact-head hosted Windows/macOS/Ubuntu and controlled VS Code remain
  pending.
- The accepted process-ownership gate replaces Windows `taskkill` with a suspended,
  pre-execution-assigned, kill-on-close Job Object. On Unix, a packaged Rust
  watchdog uses parent-pipe EOF and a dedicated process group to terminate the
  ordinary verifier hierarchy after abrupt Forge death. Hosted Windows/macOS/Ubuntu
  lifecycle and release gates pass. This controls lifecycle, not permissions; a
  deliberately trusted verifier may still attempt to escape the group.

### Prototype-first priority policy

Priority is based on the fastest route to a trustworthy developer proof. “Later”
must still have a named architectural home and an objective entry gate:

- **P0 — demo blocker:** the controlled prototype cannot demonstrate its core
  claim without it.
- **P1 — functional-first-pass blocker:** required before Forge is described as a
  dependable local developer change loop.
- **P2 — pilot blocker:** required before a broader IDE or enterprise apprentice
  pilot.
- **P3 — hardening/release:** required before production durability, containment,
  or privilege-reduction claims.

| Gap | Priority and slice | Decision | Required gate |
| --- | --- | --- | --- |
| Complete change-operation fidelity | P1, Slice 2E | Build now in Rust as `ChangeSet v2`: create, replace, delete, move/rename, executable-mode intent, and bounded binary content. Symlinks are rejected until an explicit policy exists. Content is staged in a SHA-256-addressed store instead of embedded in control messages. | Deterministic manifests reject traversal, duplicate/colliding paths, stale digests, move conflicts, malformed blobs, symlinks, and platform case collisions. Equivalent input has one identity on Windows and macOS. |
| Durable transaction coordinator | P1, Slice 2E | **Accepted at `8c29037`.** Rust owns the synchronized manifest/before-images/transition journal, startup reconciliation, fresh per-path identity checks, rollback, cancellation, and terminal evidence. | Hosted Windows/macOS/Ubuntu fault gates prove process-restart recovery and non-destructive repair-required outcomes. Power-loss durability and repair tooling remain P3 release work. |
| Complete sovereign transaction CLI | P1, Slice 2E | **Accepted at `16c5569`.** One Rust-owned ChangeSet v2 service now composes propose, inspect, explicit accept/discard, durable verification evidence, restart reconciliation, and terminal candidate cleanup. TypeScript remains transport/presentation. | Hosted Windows/macOS/Ubuntu hybrid gates execute the disposable-repository flow; failure fixtures clean candidates; a controlled seven-tool VS Code read-only regression remains one-call and mutation-free. |
| Windows/macOS platform acceptance | P1, every machinery increment | Windows and macOS are Tier 1. Windows gates cover path/case/long-path behavior, replacement semantics, descendant cleanup, and locked files. macOS gates cover default and case-sensitive filesystem semantics where CI permits, atomic rename/durability behavior, process groups, and executable bits. | Local fixtures plus hosted Windows/macOS matrices pass before acceptance. Ubuntu runs as a Tier-2 compatibility matrix. |
| Deterministic supervised verifier process ownership | P1, Slice 2E | Local gate implemented under ADR-0010. Windows creates the verifier suspended, assigns it to a kill-on-close Job Object, then resumes; Unix/macOS uses a pre-exec process group with checked teardown. This is lifecycle control, not security containment. | Repeated nested timeout/cancellation tests pass on hosted Windows and macOS; Windows forced-owner-death proves kill-on-close; any cleanup uncertainty is terminal and explicit. |
| Abrupt macOS/Unix owner-death handling | P1, Slice 2E | **Accepted at `c872a81`.** A packaged Rust watchdog observes parent-pipe EOF, owns the verifier process group, and uses a separate bounded startup acknowledgement. This is lifecycle control, not containment. | Hosted macOS and Ubuntu owner-`SIGKILL` fixtures leave no survivor marker; Windows retains its Job Object path; missing/invalid helper and verifier startup fail closed. |
| High-level MCP/VS Code mutation workflow | P2, Slice 2F | Add only over the accepted transaction contract; never expose file-write or shell primitives. | Official MCP and controlled VS Code tests prove approvals, cancellation, compact evidence, no retry storm, no hidden promotion, and unchanged read-only behavior on failure. |
| Authenticated host handshake and enterprise policy adapter | P2, Slice 2F | **Accepted through provider/bridge composition on `develop` at merge `6bc2bfb`.** Rust derives capability/policy bindings, grants are single-use, and transaction v2 carries the host exchange. Policy distribution, credential brokerage, and durable audit export beyond the local ledger remain later platform work. | Spoofed, stale, replayed, incomplete, cross-capability, and policy-incompatible attestations fail closed; exported audit facts reconstruct the decision. |
| Minimum Forge-restricted execution backend | P2, CLI ship lane 7 / Slice 2F | **Sequenced by ADR-0031/0033; managed-Windows spike complete, production gate open.** AppContainer passes nine native cases; the temporary managed SRT machinery passes the 17-case four-control corpus but cannot represent Forge resource ceilings. Implement one Rust-owned managed adapter composed with Forge's Job/resource authority, then run same-corpus AppContainer/managed evidence in the VM lab. Continue Seatbelt/signed-helper evaluation on macOS and bubblewrap on Linux. | Separate adversarial Windows and macOS filesystem/process/network/credential/resource tests support every advertised control. Missing or partial representation prevents launch; compilation/configuration cannot make doctor ready. Ubuntu follows behind the same provider contract. |
| Power-loss and filesystem durability | P3, release | Harden the journal/CAS design with crash and power-loss-oriented fault injection, directory durability, corruption detection, and repair tooling. Prefer Git object identity and small Forge journals over a bespoke content database. | Abrupt-termination tests at every durable transition either recover the exact transaction or report an explicit, non-destructive repair state. |
| Reduced OS identity/privilege | P3, release | Add platform-specific token/credential reduction after containment semantics are stable. Environment minimization remains defense in depth, not a permission boundary. | Platform tests prove effective permissions and descendant cleanup rather than inferring them from configuration. |

A **generic shell tool, unrestricted file-write tool, or model-authored verification
command is not a deferred feature**. It remains outside the architecture because it
would bypass the transaction and policy model. Forge can add more high-level
operations without adding an authority escape hatch.

### Revised implementation sequence

The accepted Slice 2A–2D path already provides bounded text proposal, worktree
verification, durable candidate leases, environment minimization, and explicit
promotion/discard. Continue as follows:

1. Define and validate Rust `ChangeSet v2` plus a content-addressed blob store.
2. Add create/replace/delete/move/mode/binary adapters behind the existing policy
   and evidence boundary; keep symlinks explicitly unsupported.
3. Guarantee supervised verifier process-tree teardown on Tier-1 platforms and
   close abrupt-owner behavior without claiming security containment.
4. Add the durable transaction coordinator, startup reconciliation, concurrent-edit
   checks, and graceful cancellation artifact.
5. **Accepted:** complete the local CLI workflow without publishing raw write or
   shell powers.
6. **Accepted:** pass local/adversarial and hosted Windows/macOS acceptance and
   retain Ubuntu as a compatibility gate, closing Slice 2E.
7. **Accepted:** bind execution evidence to a validated provider capability
   descriptor and retire raw host-managed assertions.
8. **Accepted:** issue, strictly verify, and durably consume a signed single-use
   host challenge bound to provider, capability, policy, and controls.
9. **Accepted:** wire Rust-derived transaction bindings and verified evidence into
   an executing host-managed provider plus bounded host/kernel negotiation frames.
10. Converge the CLI and MCP product surfaces on the Rust runtime; remove implicit
    TypeScript production fallback.
11. Build the measured inference and live CLI ship lane on that one authority.
12. Complete bounded ChangeSet retention/audit, compile restricted policy into one
    effective sandbox plan, then prove the managed/fallback Windows hierarchy and
    macOS Seatbelt preview as separately accepted native increments. Retain the
    signed App Sandbox helper as the durable macOS release decision and Linux
    bubblewrap as the Tier-2 backend. Keep every provider unavailable and fail-closed
    until its own host gate passes.
13. Add one high-level MCP/VS Code mutation workflow over the accepted transaction
    authority, without publishing raw shell or write powers.
14. Begin the bounded context/memory/reviewed-skill learning loop immediately after
    the standalone CLI gate. Expand providers and advanced platform surfaces on
    separate measured lanes; native sandbox completion does not block the learning
    loop.

This sequence does not pretend sandboxing is optional forever. It prevents an
unfinished sandbox program from delaying the controlled prototype while reserving
and testing the authority seam now. `trusted` remains explicit no-containment,
`host_managed` remains unavailable until the executing provider/bridge passes Slice
2F-2b, and `restricted` continues to fail closed until a real provider passes its
Slice 2F-3 gate.
## Research spike and gate status

These are bounded investigations with a decision, not open-ended feature research.
A pending spike runs immediately before the increment that needs it. Accepted work
is not repeated unless new evidence invalidates its checkpoint.

| Gate | Spike | Status | Decision it must answer |
| --- | --- | --- | --- |
| Slice 2 | Windows worktree/process boundary | Accepted; Checkpoints 11, 17, and 18 | Can Forge use a safe, debuggable worktree/process execution model across supported Windows, macOS, and Linux environments? |
| Slice 2E | Cross-platform change fidelity and CAS staging | Accepted at `fd3d9eb` and `b930d31`; ADR-0009 and Checkpoints 26/30 | One bounded Rust operation algebra and content-addressed store preserve exact intent across the gated Windows/macOS/Ubuntu cases; explicitly unsupported platform cases fail before mutation. |
| Slice 2E | Deterministic verifier process ownership | Accepted at `ff4aedf`; ADR-0010 and Checkpoints 31–32 | Can Windows and macOS terminate and confirm a nested verifier hierarchy across timeout, cancellation, normal child exit, and cleanup errors, while separately proving Windows owner-death behavior, without calling lifecycle control a sandbox? |
| Slice 2E | Durable transaction coordinator | Accepted at `8c29037`; ADR-0011 and Checkpoints 33–34 | A bounded filesystem manifest, exact before-images, and synchronized transition journal make recognized process-restart states deterministic; ambiguity becomes `repair_required`, without claiming a power-loss transaction. |
| Slice 2E | Unix/macOS abrupt owner death | Accepted at `c872a81`; ADR-0012 and Checkpoints 35–36 | Can a parent-owned liveness pipe, bounded startup acknowledgement, and first-party watchdog terminate the ordinary verifier hierarchy after Forge `SIGKILL` without claiming sandbox containment? Hosted macOS/Ubuntu say yes; Windows retains Job Objects. |
| Slice 2F | Isolation provider authority | Accepted at `ef0a125`; ADR-0014 and Checkpoints 39–40 | Every provider advertises bounded authority; the baseline is trusted-only; unsupported host/restricted profiles and inconsistent evidence fail closed. |
| Slice 2F | Signed host challenge ledger | Accepted at `71a3ec6`; ADR-0015 and Checkpoints 41–42 | A short-lived Ed25519 statement binds provider/capability/policy/controls and is durably single-use across restart and concurrent consumers; provider/bridge composition remains pending. |
| Slice 2F | Authenticated host provider/bridge | Accepted at merge `6bc2bfb`; ADR-0016 and Checkpoints 43-45 | Rust-derived transaction/policy bindings, one-use grants, durable pre-launch revalidation, and bounded transaction v2 exchange compose without giving TypeScript authority or claiming containment. |
| Slice 2F | Restricted execution provider | Contract and local Windows same-plan gate accepted; managed/AppContainer each pass 17/17; production/hosted acceptance pending | Can one compiled policy and conformance contract drive an independently implemented Windows managed/fallback hierarchy, macOS Seatbelt preview, and Linux bubblewrap backend without weakening or duplicating Rust transaction authority? |
| Slice 2 | TypeScript symbols and diagnostics | Accepted for the deterministic read-only path | Which compiler integration supplies symbols and diagnostics without making the kernel IDE-specific? Provider-generated edit fidelity remains behind the transaction proposal contract rather than a new LSP authority. |
| Slice 4 | Local durable store | Pending | Which SQLite binding/migration approach satisfies Windows packaging, replay, and corruption recovery needs? |
| Slice 6 | VS Code MCP interoperability | Read-only tether accepted; mutation workflow pending P2 | Which MCP cancellation/progress/task features are supported by the target VS Code version and transport without expanding into generic write tools? |
| Slice 6 | Existing harness interoperability | Pending P2 | Can MCP represent the target central "agents" harness accurately; if not, what minimal optional adapter maps its tool, cancellation, approval-fact, progress, and trace contracts without creating a second run model? |
| Slice 7 | Provider normalization | Accepted for Ollama plus direct OpenAI through CLI ship-lane increments 2-3; expansion remains gated | The selected local and cloud paths satisfy the stream, tool, cancellation, usage, and error contract without silent cross-boundary fallback. New providers require the same conformance gate. |
| Slices 3/7 | Evaluation harness | Partial; provider and low-compute fixtures accepted, CLI8 retrieval baseline pending | What representative fixture set measures accepted outcome, evidence recall, token/cost, latency, and corrective turns before automatic retrieval or routing is enabled? |

## Prototype and open-source delivery gate

The near-term prototype should demonstrate one evidence-backed workflow through
VS Code/MCP apprentice mode and one sovereign local change loop through the same
Rust transaction authority. The minimum credible loop is evidence selection,
reviewable proposal, isolated apply, bounded verification, inspectable artifact,
and explicit promote or discard. Local/cloud provider routing remains desirable
but must not displace completion of that loop. Integration-specific tools remain
in TypeScript unless measurement proves a machinery reason to move them.

Apache-2.0 is selected for Forge-authored distributions and the root/npm/Cargo/
native-package metadata is aligned under ADR-0036. This resolves the technical
license choice, not contribution ownership. Public promotion still requires the
maintainer to attest that they can license the existing work and to resolve any
employer or third-party rights. Contribution guidance, provenance, dependency-
license review, and third-party notices remain release evidence rather than being
inferred from an SPDX field.

The trusted-alpha matrix is Windows x64 plus macOS ARM64/x64. Ubuntu x64 remains a
compatibility/CI target; Windows ARM64 and Linux ARM64 are deferred. Configuration
uses the ADR-0036 precedence and monotonic-authority rules. Protocol evolution uses
ADR-0037 negotiation and copy-on-write migration. These are accepted contracts;
their runtime/hosted fixtures remain part of the release gate.

## Core completion and delivery forecast

**Forecast date:** 2026-08-17. Completion is measured by accepted behavioral gates,
not source volume or the number of abstractions present.

| Gate group | State | Evidence or open condition |
| --- | --- | --- |
| Canonical runtime, real inference/live loop, governed change, cancellation-safe approvals | Accepted on `develop`; implementation baseline `4e15226` plus documentation baseline `5fff597` (PR #25) | Cross-platform hosted, live-provider, controlled VS Code, transaction, and local sandbox-conformance evidence is recorded by the linked checkpoints. This does not promote restricted execution. |
| 5B execution controls | Accepted and merged on `develop` at `74308ca` | Local, hosted Windows/macOS/Ubuntu, live Qwen, conservative credentialed OpenAI, and one-call controlled VS Code gates pass. See Checkpoints 68-70. |
| 5C policy posture and host callback conformance | Accepted at implementation `2941948` | One fact-producing profile layer serves CLI/service/MCP while Rust alone decides. Local, exact-kernel, live Qwen 1.5B, controlled VS Code, and hosted Windows/macOS/Ubuntu gates pass. See ADR-0028 and Checkpoints 71-72. |
| Minimum outer-run recovery | 6A/6B, atomic initialization, and ChangeSet cross-link local/VS Code gates passed; hosted pending | Rust durably records request/events/artifact plus the bounded interaction transcript. Terminal return and proven-safe same-runtime continuation work locally; ambiguous and non-idempotent frontiers block. Complete initial state is privately staged and atomically published. A pending governed change now carries one durably acknowledged reference to its registered authoritative ChangeSet transaction while the outer capability remains non-replayable. Hosted Windows/macOS/Ubuntu remains open. |
| Transaction retention and isolation truth | 7A local gate and Windows five-control same-plan gate accepted; production/hosted/VS Code pending | Lock-safe transaction retention remains accepted. Managed Windows and AppContainer each pass the fresh 17-case schema-v4 corpus under Rust-owned lifecycle/resource/evidence authority; probe v4 reports both as `setup_required` and restricted-ready false. The separately attributed schema-2 payload/bundle/guest/host lifecycle gate is prepared and locally verifies exact package/hash/license/NOTICE separation. The consolidated branch also passes the complete product, native-package, audit, benchmark, script, and fresh dual-provider local publication gates, but no VM phase or real second-pin upgrade has run. Broader credential channels, hosted Windows, macOS, and VS Code gates remain open. See [ADR-0031](../decisions/ADRs/ADR-0031-transaction-retention-and-native-sandbox-sequencing.md), [ADR-0033](../decisions/ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md), [Checkpoint 83](../decisions/checkpoints/2026-08-12-83-managed-windows-provider-adapter-local-gate.md), [Checkpoint 84](../decisions/checkpoints/2026-08-12-84-packaged-provider-lifecycle-gate-preparation.md), and [Checkpoint 85](../decisions/checkpoints/2026-08-12-85-consolidated-transaction-sandbox-local-gate.md). |
| Installable developer alpha | License and matrix contracts selected; release candidate replay and hosted gate open | ADR-0032 packages exact-version target-native release binaries without postinstall download/build. Apache-2.0 and Windows x64/macOS ARM64/x64 support are selected under ADR-0036. Effective-config implementation, candidate replay, hosted target smokes, rights attestation, signing/notarization/provenance, update tests, and the developer test kit remain open. |
| Differentiated learning loop | Additive CLI8A candidate may be prepared in parallel; activation remains after trusted alpha | Attributable scoped memory, measured retrieval, pattern recognition, and reviewed skill promotion become the product critical path under ADR-0034. Stale-base candidate `b5effea` must be replayed and tested before review. Exit: one repeated-workflow fixture proves quality/effort improvement over a no-memory baseline without hidden instructions or policy bypass. |
| Broader V1 platform | Deferred beyond the bounded learning loop | Advanced compression/retrieval, MCP client/mutation symmetry, connectors, automation, and generalized UI retain their later roadmap gates. Windows/macOS restricted providers continue as a bounded, actively scheduled commodity-platform lane under ADR-0031/0033/0034 and cannot borrow acceptance from trusted mode. |

Percent-complete figures are intentionally not used. They hid the difference
between many finished internal tests and a few still-blocking product gates.

Assuming one focused implementation lane, working hosted CI, and no material scope
expansion, the current planning ranges are:

- accepted kernel/change machinery on `develop`: **complete at merged PR #15 (`1fcab25`)**;
- first real-inference, evidence-backed CLI demonstration: **accepted and merged through PR #16 at `e865de5`**;
- interactive live CLI and credentialed OpenAI multi-turn flow: **accepted and merged through PR #17 at `0441d865`**;
- Rust-authoritative outcome contracts and the 4A gate: **accepted and merged through PR #18 at `742b8c8`**;
- 4B-1 prepared ChangeSet/approval binding: **accepted at `3262e3b`**;
- 4B-2 interactive edit composition: **accepted at implementation `bbf119e` with hosted Windows/macOS/Ubuntu, a full promoted Qwen flow, and controlled one-call VS Code evidence**;
- 4B-3 Rust-owned lifecycle convergence: **accepted at implementation `1cc1e3f` after exact-head hosted Windows/macOS/Ubuntu, an exact-kernel live Qwen promoted transaction, and a controlled one-call seven-tool VS Code gate; merged through PR #20 at `2ff5669`**;
- 5A cancellation-safe approvals: **accepted at implementation `ae746ff` after local 81-test/build, hosted Windows/macOS/Ubuntu, two live Qwen timeout/no-mutation gates, and a controlled one-call seven-tool VS Code gate**;
- 5B Rust-owned execution budgets: **accepted at implementation `3f2774b` after local 86-test/build/audit, hosted Windows/macOS/Ubuntu, live Qwen normal and tiny-budget gates, conservative credentialed OpenAI, and a controlled one-call seven-tool VS Code gate; merged through PR #22 at `74308ca`**;
- 5C product approval profiles: **accepted at implementation `2941948` after local 91-test/build, full 54-test retained-kernel hybrid, live Qwen 1.5B grant/decline, controlled one-call VS Code, and hosted Node/hybrid Windows/macOS/Ubuntu gates**;
- 6A/6B outer-run recovery: **local and controlled VS Code gates pass through bridge v10 with 93 Node tests/build, zero-warning full Rust workspace validation, 62 hybrid scenarios (56 passed and six explicit separate-kernel skips), packaged CLI smoke, deterministic same-runtime replay, one-total evidence retry, OS-owned locking, atomic whole-directory initialization, terminal temporary-artifact recovery, fail-closed ambiguous/non-idempotent frontiers, and a durably acknowledged pending ChangeSet transaction cross-link; the current controlled VS Code gate completed in one Forge call and five seconds; hosted Windows/macOS/Ubuntu acceptance remains pending**;
- shippable standalone CLI alpha: **planning range 5-8 focused working days from the 2026-08-17 reconciliation**, contingent on replaying the release candidate onto current `develop`, implementing the accepted effective-config contract, cross-platform native packaging, rights attestation, and exact-head hosted acceptance; native restricted execution remains a separately gated pilot boundary;
- first attributable memory/retrieval demonstration: **about one focused week after the installable alpha gate**;
- reviewed pattern-to-skill vertical slice: **a further 2-3 focused weeks**, contingent on the evaluation fixture proving better accepted outcomes rather than token reduction alone;
- broader enterprise pilot with real restricted execution and policy integration:
  **12–16 weeks**.

The source-backed
[CLI harness comparison](../audit/2026-08-05-cli-harness-core-comparison.md)
calibrates Forge as a strong narrow evidence/transaction core rather than a mature
CLI peer. With the outer ChangeSet cross-link and bounded transaction-retention
policy now closed at their local gates, the immediate order is exact-head hosted
Windows/macOS/Ubuntu and controlled VS Code acceptance, clean native
packaging/license and the developer alpha test kit, plus separately accepted
     Windows managed/fallback and macOS preview/signed-helper work. The trusted alpha must not wait
for those native providers, but it also must not advertise restricted execution.

These are ranges, not promises. Host key provisioning, Windows/macOS containment
mechanics, packaging/signing, or new boundary requirements move the dates. Every accepted
checkpoint must update the completed gates and forecast rather than silently
claiming progress from implementation volume.
## Confidence and decision gates

The scores are the initial planning confidence that each scope could be built
without material architectural rework—not a prediction of adoption or commercial
success. The decision column is updated as gates close; scores are not inflated
merely because implementation has started.

| Scope | Confidence | Rationale | Decision |
| --- | ---: | --- | --- |
| Architectural direction | 84 / 100 | The kernel, evidence, artifact, and host-neutral seams are strongly supported by independent implementations. | Hold as the V1 direction. |
| Slice 0 protocol and fixture suite | 91 / 100 | Fully under Forge control; no vendor, sandbox, or provider dependency. | Accepted. |
| Slice 1 deterministic read-only spine | 86 / 100 | Small, testable surface with existing provisional scaffolding to replace or keep only where it meets the contract. | Accepted, including the seven-tool MCP tether. |
| Slice 2 developer change loop | 94 / 100 | Full-operation fidelity, process-restart coordination, abrupt verifier-owner cleanup, terminal candidate cleanup, and the public sovereign CLI are accepted on Windows/macOS/Ubuntu. Remaining risk is trusted execution rather than transaction correctness. | Accept Slice 2E; carry authenticated host and restricted-execution boundaries into Slice 2F. |
| Slices 3–5 context, durable state, and skills | 74 / 100 | Direction remains sound, but quality evaluation and storage migrations still need their own gates. The transaction/evidence machinery is now sufficient to begin after the installable alpha gate. | Make the bounded attributable-memory/retrieval/reviewed-skill loop the post-alpha critical path; do not wait for native sandbox promotion. |
| Slices 6–7 VS Code/MCP and provider escalation | 68 / 100 | Standards exist, but host/provider support and streaming semantics remain integration risk. | Read-only VS Code/MCP is accepted; defer MCP mutation and provider expansion until the local change loop closes. |
| Slice 8 hardening/release boundary | 62 / 100 | The provider seam and policy-compilation/provider hierarchy are accepted, but Windows and macOS containment, power-loss durability, signing, and packaging remain substantial platform work. | Implement and behaviorally prove minimum Tier-1 restricted backends in Slice 2F; retain full durability/privilege hardening for release. |
| Entire V1 as a single committed scope | 69 / 100 | Strong plan, but enough integration uncertainty remains that a one-shot implementation would be irresponsible. | Stage-gate it; do not build it as one batch. |

## Go/no-go

**Go for the near-term CLI ship lane while retaining bounded Slice 2F hardening.**
Kernel convergence is merged on `develop` at `1fcab25`.
The same Rust-owned ChangeSet v2 authority now applies,
verifies, durably records, reconciles, accepts, discards, cleans up, and explains a
representative change set through the public CLI on Windows/macOS/Ubuntu. Slice 2F-1
through Slice 2F-2b are accepted, while raw host assertions still fail closed.
CLI and MCP now use that one Rust authority. The real-inference feature passes
hosted, exact-kernel product, and controlled VS Code gates and is merged on
`develop` through PR #16. The live CLI and credentialed OpenAI multi-turn gates
are merged through PR #17 at `0441d865`. Rust-authoritative outcome contracts are
merged through PR #18 at `742b8c8`. The prepared ChangeSet/approval boundary is
accepted at `3262e3b`; increments 4B-2 and 4B-3 passed hosted cross-platform, live
promoted Qwen, and controlled VS Code gates before merging through PR #20 at
`2ff5669`. Rust-owned execution budgets are accepted through PR #22 merge
`74308ca`. Increment 5C now has one product fact layer across CLI,
service, and MCP, with Rust still resolving every final decision. Implementation
`2941948` passed the local, exact-kernel, live Qwen 1.5B, controlled VS Code, and
hosted Node/hybrid Windows/macOS/Ubuntu gates and is accepted as increment 5C.
Current `develop` is PR #25 merge `5fff597`; it contains the consolidated PR #24
implementation baseline `4e15226` plus the documentation ground-truth correction.
CLI ship-lane 7A passes the full local Rust/Node/exact-kernel hybrid and source-built
CLI smoke gate with bounded transaction audit and truthful isolation readiness;
hosted/VS Code acceptance is still open.
`restricted` remains fail-closed until a
separately proven Windows/macOS backend passes adversarial gates; the trusted developer alpha must name that
limitation.

**Go for the bounded attributable-memory, measured-retrieval, and reviewed-skill
vertical slice immediately after the standalone CLI gate; do not wait for native
sandbox promotion.** Broad compression, connector, automation, generalized UI, and
raw MCP mutation programs remain no-go until that learning slice proves value. No
raw shell or file-write MCP tool is permitted; any future host mutation and every
promoted skill must reuse the accepted transaction contract.

## Change-control rule

At every framework, service, or host integration decision we will add:

1. a plain-language checkpoint explaining the user impact and trade-off;
2. an ADR where a durable architectural choice is made;
3. a measurable acceptance or rejection gate;
4. a changelog entry linking the decision, implementation, and validation result.

See `docs/decisions/` for the templates and prior checkpoints.
