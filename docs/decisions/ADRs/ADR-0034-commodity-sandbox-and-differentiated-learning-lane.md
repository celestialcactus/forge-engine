# ADR-0034: Treat sandboxing as a commodity boundary and prioritize the learning loop

**Date:** 2026-08-11
**Status:** Accepted for roadmap sequencing
**Scope:** Product allocation after the transaction/evidence core and trusted alpha gate

## Context

Forge has spent a substantial implementation cycle establishing one Rust-owned
transaction, policy, recovery, and evidence authority and proving that an operating-
system provider can consume its compiled plan. That authority is necessary: memory,
skills, and model behavior must not create an alternate mutation or execution path.

Native sandbox implementation is not, however, Forge's intended product
differentiator. Filesystem/process/network containment is becoming a standard agent
CLI capability. Codex, Anthropic Sandbox Runtime, Gemini CLI, and the platform vendors
already demonstrate recurring provider patterns. Continuing to optimize a novel
AppContainer design before developers can exercise Forge's learning behavior would
misallocate the critical path.

Forge's intended differentiation is the semantic bridge between a developer and a
workspace:

- evidence-derived, scoped memory with provenance and correction;
- domain and architecture knowledge accumulated across useful work;
- retrieval that improves outcomes rather than merely reducing prompt tokens;
- recognition of repeated, generalizable workflows;
- proposed skills that a developer can inspect, edit, accept, reject, and retire;
- measured reuse of accepted knowledge and skills across local and cloud inference.

## Decision

### 1. Sandboxing is a required platform capability, not the innovation lane

The shared Rust `EffectiveSandboxPlan`, provider status, evidence digest, transaction
authority, and fail-closed readiness rules remain authoritative. Platform providers
must implement those contracts and may not create a second runtime.

Implementation should adopt established operating-system and open-source patterns:

- Windows: prioritize a dedicated low-privilege identity, broker/runner, restricted
  token, Job Object, additive/recoverable workspace grants, WFP egress fence, and
  explicit proxy. Retain AppContainer as an optional strict/conformance backend.
- macOS: use a Seatbelt preview behind the provider contract, then make the signed
  helper decision from measured compatibility and release evidence.
- Linux: use bubblewrap/native namespace and seccomp mechanisms rather than a custom
  containment runtime.

Public designs may inform an independent Forge implementation. Literal source reuse
requires an explicit license, NOTICE, provenance, upgrade, and maintenance decision.
An external provider may be integrated as an explicitly identified preview adapter
when that is the fastest honest route; it cannot be relabeled as Forge-native
enforcement.

Architecture and obvious composition patterns that Forge reproduces during this
lane are explicitly called **evaluation modules**. They may reproduce a sensible
dedicated-identity/WFP/broker structure, an AppContainer/Job structure, or a
provider-manager lifecycle in an original Forge arrangement. They do not copy
external source verbatim or import another project's policy authority. Each module
must cite its influence, published API or platform documentation, license and
dependency surface, Forge-specific changes, and unpromoted status under ADR-0033's
provenance rules.

### 2. Continue sandbox completion as a bounded parity lane

The current custom AppContainer implementation is frozen at conformance quality
unless a failing provider-contract test requires correction. This freezes one
experimental implementation direction, not the sandbox program. Restricted
execution remains required for Forge's enterprise-ready posture and must reach
production acceptance on Windows and macOS.

Sandbox work continues through established provider patterns, explicit compatibility
tests, and bounded exit gates. It remains `setup_required` until those gates pass. It
does not delay the clearly labeled trusted developer alpha or prevent the learning
lane from beginning, but the learning lane also cannot be used to waive restricted-
execution acceptance for a restricted beta or enterprise pilot.

The bounded sandbox lane is:

1. a short managed-Windows feasibility and compatibility spike;
2. selection or rejection using Node/npm, Git, PowerShell, Cargo, filesystem,
   credential, network, descendant, recovery, and latency evidence;
3. an explicit preview adapter only after packaged `doctor` and hosted gates pass;
4. macOS/Linux providers using the same contract;
5. production promotion only after the relevant adversarial platform gate.

This is a parallel product-parity lane, not a deferred eventuality. Planning should
alternate bounded sandbox milestones with learning/tool milestones instead of
allowing either program to consume the other indefinitely.

Security claims remain exact: `trusted` means no Forge-enforced OS containment, and
unavailable or partial providers fail before restricted execution.

### 3. Move the product critical path to one evaluated learning loop

After the clean-install trusted alpha gate, the next execution priority is a narrow
end-to-end loop:

1. derive candidate observations only from attributable run/workspace/user evidence;
2. type and scope observations as workspace, repository, organization, or developer
   knowledge with confidence, freshness, and provenance;
3. retrieve candidate knowledge through the context compiler and record why it was
   selected or omitted;
4. measure whether retrieval improves accepted outcome quality, corrective turns,
   latency, and total tokens rather than optimizing token count alone;
5. detect repeated workflow structure and emit a skill candidate;
6. require developer review/edit/promotion before the candidate becomes reusable;
7. prove an accepted skill improves a repeated fixture without hiding its sources,
   bypassing policy, or creating a parallel execution path.

Automatic unreviewed skill activation, opaque profile inference, and memory that
cannot be corrected or attributed are out of scope for this first loop.

### 4. Preserve sovereign and small-model efficiency

Sandboxing applies to capability processes that can affect the workspace, operating
system, network, or credentials. It does not wrap the inference/control plane by
default. A local Ollama or equivalent provider remains a first-class local service;
Forge performs policy compilation, transaction coordination, sandbox launch, and
evidence normalization outside the model's reasoning loop.

Provider integration must preserve these constraints:

- no mandatory cloud control plane, telemetry service, or remote policy decision;
- no mandatory full workspace or toolchain copy on every capability invocation;
- no long sandbox policy, ACL, or platform-mechanism transcript in model context;
- expose a compact effective capability posture and deterministic actionable errors;
- preflight provider/toolchain availability in `doctor` instead of asking the model
  to diagnose infrastructure failures through repeated attempts;
- cache safe immutable setup where possible while binding per-run grants and evidence
  to the exact effective plan;
- record setup latency, process-launch latency, bytes/materialization work, command
  latency, retries, corrective turns, and total task tokens;
- reject a provider/profile as a default when its compatibility failures or overhead
  materially worsen accepted small-model task outcomes versus trusted execution.

Borrowed implementations or patterns remain local, pinned, inspectable providers
behind the Forge contract. Provider substitution must not alter the transaction,
memory, skill, or evidence model and must not make sovereign operation depend on a
vendor service.

## Consequences

- The prior transaction/evidence work is retained and becomes the trustworthy data
  source and execution boundary for learning features.
- Native containment no longer blocks differentiated product discovery, while
  restricted beta and enterprise-readiness claims remain blocked on native provider
  acceptance.
- Forge accepts a short-term feature gap versus mature sandbox implementations and
  labels it instead of disguising trusted execution.
- The team must maintain evaluation fixtures for memory accuracy, retrieval value,
  contamination, staleness, correction, and skill transfer—not just unit tests.
- Sandbox dependencies or borrowed patterns remain replaceable provider details;
  memory, skill, evidence, and transaction contracts remain Forge-owned.

## Exit gates

The first differentiated learning slice is accepted only when:

- every stored and retrieved observation has provenance, scope, confidence, and a
  correction/deletion path;
- deliberately stale, conflicting, irrelevant, and poisoned observations are
  rejected or clearly surfaced;
- retrieval beats a no-memory baseline on accepted outcome quality without increasing
  corrective turns or total task cost beyond the declared budget;
- a repeated workflow produces a reviewable skill candidate, never an automatic
  hidden instruction;
- promotion, edit, rejection, retirement, and reuse are inspectable events;
- the accepted skill measurably improves the repeated task through the existing CLI
  and canonical runtime.

The sandbox parity lane is accepted for default local use only when the same
representative local-model fixture reports provider setup/launch overhead,
tool-compatibility failures, model retries, corrective turns, and end-to-end latency
against trusted execution. Raw containment strength alone is not sufficient product
acceptance.

## Forecast posture

The trusted installable alpha remains the immediate release gate. A first visible
memory/retrieval demonstration should follow within roughly one focused week of that
gate; the reviewed pattern-to-skill vertical slice is planned as a further two to
three focused weeks. These are planning ranges, not acceptance substitutes.

The native restricted provider proceeds as a separately measured, continuously
scheduled platform-parity lane. Its schedule may not silently consume the
differentiated-learning allocation, and the learning lane may not silently remove
its Windows/macOS completion gates, without a new decision record.

## Spike checkpoint: 2026-08-11

The first commodity-provider spike supports `adapt`, not immediate `adopt`:
`@anthropic-ai/sandbox-runtime@0.0.71` offers a useful replaceable execution
mechanism and a published API, but its Windows backend requires a dedicated local
user, WFP policy, and ACL setup that was not present in the bounded environment.
The temporary adapter therefore remained `setup_required` and produced no
containment result. The full matrix and exact measurements are recorded in
[Checkpoint 81](../checkpoints/2026-08-11-81-commodity-sandbox-conformance-spike.md).

## Spike completion: 2026-08-12

Approved local setup unblocked the Windows probe. The Rust-owned 17-plan corpus
passed 17/17 through the temporary SRT machinery with no per-command retry or
fallback. Representative shell, Node/npm, Git, and Cargo/rustc commands succeeded;
filesystem/network/credential and lifecycle negatives also passed with clean
ACL/recovery/process residue. Final mean setup/reset/launch costs were
1,196.59/1,116.80/325.05 ms, and the projected compatibility fixture was 632.9 MB.

These measurements reinforce the allocation decision: adapt mature machinery
behind Forge's contract, but do not turn a research-preview TypeScript package into
Forge's policy/runtime authority. Resource limits and same-corpus native-provider
parity remain open, the root application dependency was removed, and production
readiness stays false. See
[Checkpoint 82](../checkpoints/2026-08-12-82-commodity-sandbox-conformance-completion.md).

## Rust-owned adapter gate: 2026-08-12

The next parity increment closed the two local gaps named above: Forge now composes
process-count and memory ceilings in its own Job Object around the managed provider,
and both Windows candidates execute the exact same five-control corpus. Managed and
AppContainer each passed 17/17 with clean lifecycle and residue evidence. The cold
managed mean was 8,940.12 ms/case versus 1,972.14 ms/case for AppContainer, so
compatibility does not erase the setup/reset performance debt.

The package remains evaluation machinery outside the application dependency graph,
and production selection remains closed. This result strengthens `adapt`; it does
not move sandbox engineering back onto the differentiated-learning critical path.
The next parity gate is packaging/install/reboot/uninstall and same-corpus execution
inside the disposable Windows lab. See
[Checkpoint 83](../checkpoints/2026-08-12-83-managed-windows-provider-adapter-local-gate.md).

The schema-2 packaged lifecycle path is now prepared and locally verified without
machine mutation. It keeps exact third-party archives/licenses/NOTICE separate,
labels the managed Windows, AppContainer, and conformance paths as evaluation
modules, and preserves Rust authority. Actual disposable-VM evidence and a real
second-pin upgrade remain absent, so restricted readiness and promotion stay closed.
This narrows operational uncertainty without moving sandbox work back onto the
differentiated-learning critical path. See
[Checkpoint 84](../checkpoints/2026-08-12-84-packaged-provider-lifecycle-gate-preparation.md).
