# ForgeEngine V1: validated build plan

**Status:** authoritative for V1 planning
**Date:** 2026-07-10
**Last groomed:** 2026-07-30 after hosted and VS Code acceptance of Slice 2E-2
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

Slice 2E is the current delivery focus. Content-addressed staging, the complete
bounded change-operation model, durable transaction coordination/startup recovery,
and cross-platform verifier owner-death handling are accepted. The remaining Slice
2E critical path is complete candidate lifecycle cleanup and one sovereign
transaction CLI workflow over the same Rust authority.

Windows and macOS are Tier-1 product and acceptance platforms. Every Slice 2E
increment must be designed and hosted-tested for both before it is accepted.
Ubuntu remains a Tier-2 compatibility gate because local/server deployments and
CI must not require a platform fork. Context compilation, durable sessions,
learned skills, and provider routing remain behind this functional core.

Slice 2F is the pilot boundary: authenticated host negotiation, policy
distribution and audit export, credential brokerage, at least one real
Forge-restricted execution backend, and a high-level MCP/VS Code mutation
workflow. These capabilities are planned, not silently left to a future rewrite.

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

Robust enforcement remains a platform-specific backend. ADR-0008 now defines the
Rust provider and evidence boundary before a backend is selected: developer-
permission execution records no containment, host-managed execution records an
allowlisted host attestation, and unavailable Forge-restricted execution fails
closed. Windows, macOS, and Linux restricted mechanisms still require separate
spikes and adversarial platform gates.

### Honest current limitations

- No Forge-enforced operating-system sandbox exists yet.
- Host-managed isolation evidence is an allowlisted assertion, not independently
  verified containment; the authenticated host handshake is not yet built.
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
| Complete sovereign transaction CLI | P1, Slice 2E | Extend the thin candidate CLI into one high-level propose → verify → inspect → accept/discard flow. Do not expose raw shell or arbitrary direct-write commands. | A fresh developer can complete the bounded workflow without private test helpers on Windows and macOS; Ubuntu remains compatible. |
| Windows/macOS platform acceptance | P1, every machinery increment | Windows and macOS are Tier 1. Windows gates cover path/case/long-path behavior, replacement semantics, descendant cleanup, and locked files. macOS gates cover default and case-sensitive filesystem semantics where CI permits, atomic rename/durability behavior, process groups, and executable bits. | Local fixtures plus hosted Windows/macOS matrices pass before acceptance. Ubuntu runs as a Tier-2 compatibility matrix. |
| Deterministic supervised verifier process ownership | P1, Slice 2E | Local gate implemented under ADR-0010. Windows creates the verifier suspended, assigns it to a kill-on-close Job Object, then resumes; Unix/macOS uses a pre-exec process group with checked teardown. This is lifecycle control, not security containment. | Repeated nested timeout/cancellation tests pass on hosted Windows and macOS; Windows forced-owner-death proves kill-on-close; any cleanup uncertainty is terminal and explicit. |
| Abrupt macOS/Unix owner-death handling | P1, Slice 2E | **Accepted at `c872a81`.** A packaged Rust watchdog observes parent-pipe EOF, owns the verifier process group, and uses a separate bounded startup acknowledgement. This is lifecycle control, not containment. | Hosted macOS and Ubuntu owner-`SIGKILL` fixtures leave no survivor marker; Windows retains its Job Object path; missing/invalid helper and verifier startup fail closed. |
| High-level MCP/VS Code mutation workflow | P2, Slice 2F | Add only over the accepted transaction contract; never expose file-write or shell primitives. | Official MCP and controlled VS Code tests prove approvals, cancellation, compact evidence, no retry storm, no hidden promotion, and unchanged read-only behavior on failure. |
| Authenticated host handshake and enterprise policy adapter | P2, Slice 2F | Replace the current `host_managed` assertion with authenticated, freshness-bound negotiation. Add policy distribution, durable audit export, and credential brokerage seams without importing host-private state into Rust. | Spoofed, stale, replayed, incomplete, and policy-incompatible attestations fail closed; exported audit facts reconstruct the decision. |
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
5. Complete the local CLI workflow without publishing raw write or shell powers.
6. Pass local/adversarial and hosted Windows/macOS acceptance; retain Ubuntu as a
   compatibility gate. Only then close Slice 2E.
7. Open Slice 2F for authenticated hosts, policy/audit exchange, a minimum real
   restricted backend, and one high-level MCP/VS Code mutation workflow.
8. Resume context compiler, sessions, skills, and provider expansion after the
   engine can reliably finish and recover its core developer-change loop.

This sequence does not pretend sandboxing is optional forever. It prevents an
unfinished sandbox program from delaying the controlled prototype while reserving
and testing the authority seam now. `trusted` remains explicit no-containment,
`host_managed` remains unavailable to an untrusted public caller until Slice 2F,
and `restricted` continues to fail closed until a real provider passes its gate.
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

**Forecast date:** 2026-07-30. Completion is measured by accepted behavioral gates,
not source volume or the number of abstractions present.

| Scope | Estimated complete | Remaining critical path |
| --- | ---: | --- |
| Core runtime and dependable local change machinery | 86% | Complete candidate cleanup/ownership and the public sovereign transaction CLI gate. |
| Shippable standalone CLI alpha | 46% | Core closure plus canonical runtime convergence, one measured local and one direct cloud inference path, interactive multi-turn loop, effective config/doctor, packaging, and clean-install smoke tests. |
| Broader V1 platform | 25% | Context quality gates, durable projections, reviewed skills/memory, symmetric mutation integrations, restricted execution, connectors, and release hardening. |

Assuming one focused implementation lane, working hosted CI, and no material scope
expansion, the current planning ranges are:

- curated evidence-backed CLI demonstration: **2–3 weeks**;
- dependable core local change engine: **2–4 weeks**;
- shippable standalone CLI alpha: **5–8 weeks**;
- broader enterprise pilot with real restricted execution and policy integration:
  **12–16 weeks**.

These are ranges, not promises. Provider-access delays, macOS watchdog complexity,
packaging/signing, or new containment requirements move the dates. Every accepted
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
| Slice 2 developer change loop | 89 / 100 | Full-operation fidelity, process-restart coordination, and abrupt verifier-owner cleanup are accepted on Windows/macOS/Ubuntu. Remaining risk is candidate lifecycle cleanup and public CLI composition. | Finish Slice 2E-3b before claiming a dependable general change loop. |
| Slices 3–5 context, durable state, and skills | 74 / 100 | Direction remains sound, but quality evaluation and storage migrations still need their own gates. | Keep sequential behind Slice 2E so higher-level intelligence does not mask weak machinery. |
| Slices 6–7 VS Code/MCP and provider escalation | 68 / 100 | Standards exist, but host/provider support and streaming semantics remain integration risk. | Read-only VS Code/MCP is accepted; defer MCP mutation and provider expansion until the local change loop closes. |
| Slice 8 hardening/release boundary | 58 / 100 | The provider seam is accepted, but Windows and macOS containment, power-loss durability, and packaging remain substantial platform work. | Implement a minimum Tier-1 restricted backend in Slice 2F; retain full durability/privilege hardening for release. |
| Entire V1 as a single committed scope | 69 / 100 | Strong plan, but enough integration uncertainty remains that a one-shot implementation would be irresponsible. | Stage-gate it; do not build it as one batch. |

## Go/no-go

**Go for Slice 2E-3b.** ChangeSet v2/CAS, the durable coordinator, and abrupt
cross-platform verifier owner-death handling are accepted; they materially reduce
architectural risk but remain private machinery. Complete candidate cleanup and
expose the same Rust authority through one sovereign transaction CLI. Accept the
gate only after Windows and macOS pass; keep Ubuntu green as a compatibility check.

**No-go for parallel context compression, learned memory, skills, multi-provider,
or raw MCP mutation programs.** Those features can make Forge look smarter without
making it more reliable. Slice 2F is the named next boundary for authenticated host
integration and restricted execution; it begins only after Slice 2E can apply,
verify, recover, and explain a representative change set.
## Change-control rule

At every framework, service, or host integration decision we will add:

1. a plain-language checkpoint explaining the user impact and trade-off;
2. an ADR where a durable architectural choice is made;
3. a measurable acceptance or rejection gate;
4. a changelog entry linking the decision, implementation, and validation result.

See `docs/decisions/` for the templates and prior checkpoints.
