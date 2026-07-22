# ForgeEngine V1: demo and harness interoperability plan

**Status:** accepted delivery amendment; subordinate to the validated V1 build
plan for architectural invariants
**Date:** 2026-07-22
**Target:** demonstrable engineering prototype by 2026-08-22

## Delivery intent

The next month optimizes for a coherent, useful Forge experience rather than for
maximizing the amount of Rust or the number of partially implemented features.
The prototype must demonstrate that Forge can improve an engineer's existing
workflow while preserving an inspectable account of evidence, actions, local or
cloud execution, and verification.

The near-term enterprise adoption path is **apprentice-first**. An organization
should be able to expose Forge's evidence, local compute, context planning, and
verification capabilities to an existing host or central agent harness without
replacing that host. This adoption priority does not make apprentice mode a
separate runtime or a permanent product ceiling: standalone, master, apprentice,
and embedded operation continue to use the same Rust authority and artifacts.

## Product boundary for the prototype

Rust and TypeScript are not peer runtimes with duplicated business state.

| Rust authority | TypeScript integration layer |
| --- | --- |
| Run, session, and workflow execution state | MCP, VS Code, and host presentation |
| Final policy resolution and enforcement | User-consent prompts and host-policy facts |
| Scheduling, budgets, cancellation, and correlation | Workflow definitions and rapidly changing orchestration adapters |
| Evidence/event ordering and terminal artifacts | Provider SDKs and tool implementations |
| Durable state, recovery, and process supervision foundations | TypeScript compiler intelligence and other ecosystem-specific capabilities |
| Baseline sovereign operations required by the standalone CLI | Experimental strategies behind a Rust-requested capability boundary |

TypeScript may define a workflow, propose a step, execute an integration-specific
tool, or return host and user approval facts. Rust decides whether the step is
permitted, schedules it, applies budgets and cancellation, and determines what
becomes authoritative run state. New product features should normally be built in
TypeScript when integration velocity is the dominant concern. They move into Rust
only when required for authority, baseline sovereign operation, measured
performance, recovery, or process isolation.

The one-child-process-per-run bridge remains spike scaffolding. A production host
should use a supervised long-lived Rust kernel with request isolation and
backpressure, while the standalone Rust CLI should be able to use the same kernel
crate without a mandatory Node sidecar.

## Demonstration story

The prototype should tell one end-to-end story:

1. An engineer invokes Forge from VS Code or another tool harness.
2. Forge obtains bounded deterministic workspace evidence rather than asking the
   model to rediscover repository facts.
3. A user-visible policy deliberately keeps suitable work local or escalates an
   allowed step to a cloud provider.
4. Forge performs a bounded workflow and records which capability acted.
5. Forge reports what changed, how it was verified, and the complete run and
   workspace provenance.
6. The same attributable result can be inspected through the Forge CLI without a
   host-specific runtime fork.

The demo does not require full enterprise policy distribution, a marketplace,
general multi-agent teams, a final sandbox implementation, or a completed
platform UI.

## Existing harness compatibility

Forge must complement established developer and enterprise harnesses, including
an organization-specific central "agents" harness, without importing their
private state or tool semantics into the kernel.

Compatibility has two directions:

- **Forge as apprentice:** expose bounded Forge capabilities and evidence through
  MCP first, with another thin host adapter only when the target harness has a
  materially different interface.
- **Forge as master or peer:** import external tools through a capability adapter;
  Rust still authorizes, correlates, budgets, and records their invocation.

The adapter contract must map, at minimum:

- stable capability identity, description, and input/output schema;
- invocation, progress, cancellation, timeout, and bounded result semantics;
- host/user approval facts without delegating final Forge policy authority;
- origin, delegation ID, depth, budget, and idempotency metadata;
- evidence and trace links that retain the originating harness and Forge run IDs.

Master/apprentice is a relationship for one delegation, not a global mode. Forge
must reject or bound delegation loops and privilege expansion. The first
organization-harness spike begins by inspecting its actual protocol and tool
contract; Forge will not guess at or permanently encode an internal proprietary
API. MCP remains the default public compatibility surface.

## What "better" means

Forge does not win by exposing more tools or forcing adoption of another chat
surface. A comparative harness fixture should measure:

- accepted developer outcome and verification success;
- complete evidence, run, snapshot, and capability provenance;
- model turns and corrective turns;
- tool calls, filesystem scans/reads, and host retries;
- context and wire bytes;
- local versus cloud inference use and estimated cost;
- p50/p95 completion latency;
- recovery after cancellation, denial, or tool failure.

A feature is not considered an improvement when it saves tokens in one call but
increases corrective turns or reduces accepted outcome quality.

## Four-week delivery sequence

| Window | Outcome | Gate |
| --- | --- | --- |
| Foundation | Close the hybrid spike on hosted Windows, macOS, and Linux; correct policy ownership; record the long-lived-kernel decision; choose the repository license. | Same commit passes protocol, Rust, TypeScript, MCP, packaging, and cross-platform tests. |
| Apprentice utility | Retain the seven bounded Forge tools, add the smallest useful workflow surface, and specify the external-harness adapter against MCP plus an actual target-harness audit. | VS Code and a protocol-level harness fixture complete without host-specific kernel behavior or recovery loops. |
| Local/cloud story | Demonstrate one useful local-compute path and one deliberate cloud escalation behind the same policy and evidence contracts. | Conformance proves provider choice, approval facts, cost/latency evidence, cancellation, and equivalent terminal artifacts. |
| Demo hardening | Package, document, rehearse, and benchmark the CLI plus apprentice flow on representative developer fixtures. | A clean-machine guide reproduces the demo; known limitations and unsupported security claims are explicit. |

The windows are goals, not permission to bypass slice gates. If a foundation gate
fails, scope is reduced before architectural correctness is traded for demo
breadth.

## Open-source and company-fork gate

Forge is intended to be publicly forkable and commercially extensible. Before
public prototype promotion:

1. choose an OSI-approved permissive license with company legal/open-source
   review; Apache-2.0 is the current technical recommendation because it includes
   explicit patent terms, while MIT remains the existing manifest declaration;
2. add the complete root `LICENSE` text and make package/Cargo metadata agree;
3. add contribution guidance and a lightweight contribution-provenance policy;
4. document dependency-license review and third-party notices for packaged
   binaries;
5. keep organization-specific adapters and policy packs optional so a company fork
   need not modify the authoritative kernel contracts.

No license is selected merely by this planning document. Until a root license is
committed, manifest metadata alone must not be presented as completed open-source
licensing.

## Immediate next gate

SGU-003 passed its hosted Windows/macOS/Ubuntu matrix and exact-branch VS Code
test. SGU-004 now implements the smallest remaining authority correction:
TypeScript supplies integration results, user-consent results, and host-policy
facts; Rust produces the final policy decision and authoritative artifact. The
one-process-per-run bridge remains available as a conformance transport while the
long-lived lifecycle is designed separately from the one-month demo critical path.
