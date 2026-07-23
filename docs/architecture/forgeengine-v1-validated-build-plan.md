# ForgeEngine V1: validated build plan

**Status:** authoritative for V1 planning
**Date:** 2026-07-10
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
| 8. Hardening and release | A developer can rely on documented, tested runtime boundaries. | Windows process/filesystem isolation backend, migration/upgrade, packaging, observability, recovery, compatibility matrix. | Threat-model claims are backed by platform tests and release gates; unsupported boundaries are documented as such. |

## The first build target: Slice 0 and the narrow Slice 1 spine

Begin now, but only with this deliberate first vertical slice:

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
- The baseline verification child inherits the Forge process environment and
  operating-system permissions.
- No host-facing transaction CLI, MCP mutation tool, verified-candidate promotion
  flow, or public workspace-write capability exists yet. The current CLI and seven
  MCP tools remain read-only.

## Research spikes that are still required

These are bounded investigations with a decision, not further open-ended feature
research. They occur immediately before the relevant slice, while Slice 0 proceeds.

| Before slice | Spike | Decision it must answer |
| --- | --- | --- |
| 2 | Windows worktree/process boundary | Can Forge use a safe, debuggable worktree/process execution model on the supported Windows versions? |
| 2 | TypeScript editing and diagnostics | Which LSP/TypeScript integration provides symbols and diagnostics without making the kernel IDE-specific? |
| 4 | Local durable store | Which SQLite binding/migration approach satisfies Windows packaging, replay, and corruption recovery needs? |
| 6 | VS Code MCP interoperability | Which MCP cancellation/progress/task features are actually supported in the target VS Code version and transport? |
| 6 | Existing harness interoperability | Can MCP represent the target central "agents" harness accurately; if not, what minimal optional adapter maps its tool, cancellation, approval-fact, progress, and trace contracts without creating a second run model? |
| 7 | Provider normalization | Can the selected local and cloud providers satisfy Forge's stream, tool, cancellation, and error contract? |
| 3/7 | Evaluation harness | What representative fixture set measures accepted outcome, evidence recall, token/cost, latency, and corrective turns? |

## Prototype and open-source delivery gate

The near-term prototype should demonstrate one evidence-backed workflow through
VS Code/MCP apprentice mode, a corresponding CLI inspection path, deliberate
local/cloud execution, and complete run provenance. It should not delay working
utility to port integration-specific tools to Rust.

Before public promotion, the repository must contain a complete root license and
consistent package/Cargo metadata. Apache-2.0 is the current technical candidate
for an enterprise-forkable project because of its explicit patent terms; MIT is
the existing manifest declaration. License selection requires an explicit owner
decision and appropriate company legal/open-source review. Contribution guidance,
provenance, dependency-license review, and third-party notices follow the selected
license rather than being inferred from package metadata.

## Confidence and decision gates

The scores indicate confidence that the slice can be built without material
architectural rework—not a prediction of adoption or commercial success.

| Scope | Confidence | Rationale | Decision |
| --- | ---: | --- | --- |
| Architectural direction | 84 / 100 | The kernel, evidence, artifact, and host-neutral seams are strongly supported by independent implementations. | Hold as the V1 direction. |
| Slice 0 protocol and fixture suite | 91 / 100 | Fully under Forge control; no vendor, sandbox, or provider dependency. | Begin now. |
| Slice 1 deterministic read-only spine | 86 / 100 | Small, testable surface with existing provisional scaffolding to replace or keep only where it meets the contract. | Begin immediately after Slice 0. |
| Slices 2–5 developer loop, context, durable state, skills | 76 / 100 | Design is clear, but editing fidelity, storage, and evaluation quality need targeted spikes. | Build sequentially behind gates. |
| Slices 6–7 VS Code/MCP and provider escalation | 68 / 100 | Standards exist, but host/provider support and streaming semantics remain integration risk. | Do not start before protocol conformance fixtures. |
| Slice 8 hardening/release boundary | 55 / 100 | Windows containment and production packaging deserve a dedicated design/test pass. | Research and prototype before making enforcement claims. |
| Entire V1 as a single committed scope | 69 / 100 | Strong plan, but enough integration uncertainty remains that a one-shot implementation would be irresponsible. | Stage-gate it; do not build it as one batch. |

## Go/no-go

**Go for Slice 0 now.** Additional broad research is not the highest-value action:
we have enough validated direction to make the core falsifiable. The right next
work is building the protocol, fixture repository, event trace tests, and
read-only deterministic spine.

**No-go for a full V1 build sprint.** Do not start mutation, compression, storage,
MCP, provider routing, or sandbox work in parallel. Each should follow only after
the evidence and conformance gate immediately before it.

## Change-control rule

At every framework, service, or host integration decision we will add:

1. a plain-language checkpoint explaining the user impact and trade-off;
2. an ADR where a durable architectural choice is made;
3. a measurable acceptance or rejection gate;
4. a changelog entry linking the decision, implementation, and validation result.

See `docs/decisions/` for the templates and prior checkpoints.
