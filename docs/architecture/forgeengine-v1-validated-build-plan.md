# ForgeEngine V1: validated build plan

**Status:** authoritative for V1 planning
**Date:** 2026-07-10
**Last groomed:** 2026-08-03 after kernel-convergence hosted and VS Code acceptance
**Supersedes for execution planning:** `forgeengine-v1-reconstruction-plan.md`
**Historical only:** `forgeengine-proposed-plan-v2.md` and `docs/archive/prototype/`

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
require a platform fork. Context compilation, durable sessions, learned skills,
and provider routing remain behind this functional core.

Slice 2F is the current core hardening boundary. Slice 2F-1 is accepted: provider
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

This is the immediate execution priority. It turns the accepted protocol and change
machinery into something another developer can install, understand, and use. The
broader V1 slices remain authoritative capability goals.

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
4. **Developer capability pack — standalone 4A/4B core accepted on the feature branch.** Bounded read/search, patch/edit, process/test,
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
5. **Approval and control - active on `feature/cli-approval-control`.** Visible
   allow/ask/deny, approval callbacks, cancellation, timeouts, iteration/tool
   budgets, and honest execution posture. Increment 5A makes both governed-change
   approval waits cancellation-safe without changing the Rust protocol or MCP
   surface; its 81-test local gate is green. Independent Rust-owned capability and
   inference-usage budgets remain 5B, followed by explicit product policy/host
   callback conformance in 5C. See
   [CLI ship lane 5](../tasks/SLICE-CLI5-approval-control.md),
   [ADR-0026](../decisions/ADRs/ADR-0026-cancellation-safe-approval-callbacks.md),
   and [Checkpoint 67](../decisions/checkpoints/2026-08-04-67-approval-cancellation-local-gate.md).
   **Exit:** denial, cancellation, timeout, and exhaustion are deterministic and
   recoverable through CLI and embedded-host fixtures.
6. **Recovery state.** Append-oriented local events/artifacts, idempotency and
   recovery, and resume without duplicating completed non-idempotent work.
   **Exit:** restart fixtures resume or report repair state without repeating an
   accepted mutation or external action.
7. **Release hardening.** Clean install, Windows boundary decisions, `doctor`,
   smoke tests, packaging, effective config, and verified docs. **Exit:** fresh
   Windows and macOS environments install and run the documented alpha workflow.

### Deferred but retained platform slices

Context compilation/compression/retrieval, reviewed skills, scoped memory, durable
projections/search, MCP/VS Code symmetry, first-party connectors and messaging,
automation, a broader UI, native restricted execution, and future generalized
platform surfaces remain planned. They must reuse the same run, evidence, policy,
capability, and artifact contracts; none may create a parallel runtime. Project
Sybil is tracked separately as a future exploration and is not Forge V1 authority.

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

- No Forge-enforced operating-system sandbox exists yet.
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
| Minimum Forge-restricted execution backend | P2, Slice 2F | Implement and advertise only boundaries proven on Tier-1 platforms. Keep unsupported controls fail-closed. This is necessary for a credible pilot, but it must not block the controlled trusted-mode prototype. | Separate adversarial Windows and macOS process/filesystem/network tests support each advertised control; Ubuntu support may follow behind the same provider interface. |
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
12. Prove the minimum Windows/macOS restricted backend as a separately accepted
    hardening program; keep it fail-closed until then.
13. Add one high-level MCP/VS Code mutation workflow over the accepted transaction
    authority, without publishing raw shell or write powers.
14. Resume context compiler, sessions, skills, and provider expansion after the
    standalone CLI gate.

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
| Slice 2F | Restricted execution provider | Pending; Windows/macOS Tier-1 | Which process/filesystem/network controls can Forge independently prove and package on both enterprise desktop platforms? |
| Slice 2 | TypeScript symbols and diagnostics | Accepted for the deterministic read-only path | Which compiler integration supplies symbols and diagnostics without making the kernel IDE-specific? Provider-generated edit fidelity remains behind the transaction proposal contract rather than a new LSP authority. |
| Slice 4 | Local durable store | Pending | Which SQLite binding/migration approach satisfies Windows packaging, replay, and corruption recovery needs? |
| Slice 6 | VS Code MCP interoperability | Read-only tether accepted; mutation workflow pending P2 | Which MCP cancellation/progress/task features are supported by the target VS Code version and transport without expanding into generic write tools? |
| Slice 6 | Existing harness interoperability | Pending P2 | Can MCP represent the target central "agents" harness accurately; if not, what minimal optional adapter maps its tool, cancellation, approval-fact, progress, and trace contracts without creating a second run model? |
| Slice 7 | Provider normalization | Pending | Can the selected local and cloud providers satisfy Forge's stream, tool, cancellation, and error contract? |
| Slices 3/7 | Evaluation harness | Pending; do before enabling transforms/providers by default | What representative fixture set measures accepted outcome, evidence recall, token/cost, latency, and corrective turns? |

## Prototype and open-source delivery gate

The near-term prototype should demonstrate one evidence-backed workflow through
VS Code/MCP apprentice mode and one sovereign local change loop through the same
Rust transaction authority. The minimum credible loop is evidence selection,
reviewable proposal, isolated apply, bounded verification, inspectable artifact,
and explicit promote or discard. Local/cloud provider routing remains desirable
but must not displace completion of that loop. Integration-specific tools remain
in TypeScript unless measurement proves a machinery reason to move them.

Before public promotion, the repository must contain a complete root license and
consistent package/Cargo metadata. Apache-2.0 is the current technical candidate
for an enterprise-forkable project because of its explicit patent terms; MIT is
the existing manifest declaration. License selection requires an explicit owner
decision and appropriate company legal/open-source review. Contribution guidance,
provenance, dependency-license review, and third-party notices follow the selected
license rather than being inferred from package metadata.

## Core completion and delivery forecast

**Forecast date:** 2026-08-04. Completion is measured by accepted behavioral gates,
not source volume or the number of abstractions present.

| Scope | Estimated complete | Remaining critical path |
| --- | ---: | --- |
| Core runtime and dependable local change machinery | 99% | The active-run governed edit lifecycle is accepted; deterministic live cancellation/control budgets and crash recovery remain separate ship-lane gates. |
| Shippable standalone CLI alpha | 88% | Live Qwen/OpenAI, interactive outcome authority, verified edit composition, hosted cross-platform, and controlled VS Code gates pass. Approval/control UX, recovery, packaging, and clean-install smoke remain open. |
| Broader V1 platform | 28% | Context quality gates, durable projections, reviewed skills/memory, symmetric host integrations, restricted execution, connectors, and release hardening. |

Assuming one focused implementation lane, working hosted CI, and no material scope
expansion, the current planning ranges are:

- accepted kernel/change machinery on `develop`: **complete at merged PR #15 (`1fcab25`)**;
- first real-inference, evidence-backed CLI demonstration: **accepted and merged through PR #16 at `e865de5`**;
- interactive live CLI and credentialed OpenAI multi-turn flow: **accepted and merged through PR #17 at `0441d865`**;
- Rust-authoritative outcome contracts and the 4A gate: **accepted and merged through PR #18 at `742b8c8`**;
- 4B-1 prepared ChangeSet/approval binding: **accepted at `3262e3b`**;
- 4B-2 interactive edit composition: **accepted at implementation `bbf119e` with hosted Windows/macOS/Ubuntu, a full promoted Qwen flow, and controlled one-call VS Code evidence**;
- 4B-3 Rust-owned lifecycle convergence: **accepted at implementation `1cc1e3f` after exact-head hosted Windows/macOS/Ubuntu, an exact-kernel live Qwen promoted transaction, and a controlled one-call seven-tool VS Code gate**;
- shippable standalone CLI alpha: **3–5 weeks**;
- broader enterprise pilot with real restricted execution and policy integration:
  **12–16 weeks**.

These are ranges, not promises. Host key provisioning, Windows/macOS containment
mechanics, packaging/signing, or new boundary requirements move the dates. Every accepted
checkpoint must update the completed gates and forecast rather than silently
preserving an obsolete percentage.
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
| Slices 3–5 context, durable state, and skills | 74 / 100 | Direction remains sound, but quality evaluation and storage migrations still need their own gates. | Keep sequential behind Slice 2E so higher-level intelligence does not mask weak machinery. |
| Slices 6–7 VS Code/MCP and provider escalation | 68 / 100 | Standards exist, but host/provider support and streaming semantics remain integration risk. | Read-only VS Code/MCP is accepted; defer MCP mutation and provider expansion until the local change loop closes. |
| Slice 8 hardening/release boundary | 58 / 100 | The provider seam is accepted, but Windows and macOS containment, power-loss durability, and packaging remain substantial platform work. | Implement a minimum Tier-1 restricted backend in Slice 2F; retain full durability/privilege hardening for release. |
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
merged through PR #18 at current `develop` head `742b8c8`. The prepared
ChangeSet/approval boundary is accepted at `3262e3b` after exact-head hosted
Windows/macOS/Ubuntu and exact Windows-kernel product gates. Increment 4B-2 is
accepted at `bbf119e` after hosted cross-platform, full promoted Qwen, and
controlled one-call VS Code gates. Increment 4B-3 is accepted at exact implementation `1cc1e3f`: the governed
transaction now completes before the authoritative Rust lifecycle terminates, and
the exact head passed hosted Windows/macOS/Ubuntu, live Qwen promotion timing, and
controlled one-call seven-tool VS Code gates.
`restricted` remains fail-closed until a
separately proven Windows/macOS backend passes adversarial gates; the trusted developer alpha must name that
limitation.

**No-go for parallel context compression, learned memory, skills, connector,
automation, generalized UI, or raw MCP mutation programs before the standalone CLI
gate.** Those features can make Forge look smarter without making it usable. No raw
shell or file-write MCP tool is permitted; any future host mutation must reuse the
accepted transaction contract.

## Change-control rule

At every framework, service, or host integration decision we will add:

1. a plain-language checkpoint explaining the user impact and trade-off;
2. an ADR where a durable architectural choice is made;
3. a measurable acceptance or rejection gate;
4. a changelog entry linking the decision, implementation, and validation result.

See `docs/decisions/` for the templates and prior checkpoints.
