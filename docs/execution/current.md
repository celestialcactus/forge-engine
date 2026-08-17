# ForgeEngine current execution index

**Status:** operational ground truth for active ForgeEngine delivery
**As of:** 2026-08-17
**Accepted implementation baseline:** `origin/develop` at `4e15226` (PR #24)
**Documentation baseline:** the commit containing this file

This file answers what is active now. The
[validated build plan](../architecture/forgeengine-v1-validated-build-plan.md)
defines product direction and durable gates; ADRs define accepted architectural
decisions; slice task files define bounded implementation scope; checkpoints record
immutable evidence. A candidate branch or checkpoint does not become accepted
product state until its exact implementation is merged and its required gates pass.

## Document authority

When documents appear to disagree, use this order:

1. versioned runtime schemas plus tests describe implemented behavior;
2. accepted ADRs describe architectural decisions;
3. the validated build plan describes V1 scope, invariants, and sequencing;
4. this index describes current lanes, dependencies, and merge order;
5. the active slice task describes the bounded change and exit gate;
6. checkpoints and the changelog preserve historical evidence.

An older audit remains useful evidence for the revision it names, but it does not
override a newer accepted checkpoint or this index.

## Current release objective

The critical path is **CLI7-ALPHA: an installable trusted developer alpha**. It must
be easy to install, diagnose, run, update, and remove on the declared Windows and
macOS targets. It must state that trusted execution has no Forge-enforced OS
containment. Native restricted providers continue independently and cannot borrow
or block trusted-alpha acceptance.

See the [release profiles](../architecture/forgeengine-release-profiles.md) for the
claims permitted at each delivery stage.

## Active lanes

| Lane | Canonical ID | State on 2026-08-17 | Authority and next gate |
| --- | --- | --- | --- |
| Documentation reconciliation | `DOC-GROUND-TRUTH` | In review on top of `4e15226` | Merge the Forge/Sybil identity correction, this execution index, release profiles, refreshed plan status, and checkpoint before implementation lanes integrate. |
| Trusted-alpha release | `CLI7-ALPHA` | Candidate commit `a023119` exists, but it was created from stale baseline `aa73e0e`; not merge-ready | Replay the bounded release diff onto the new `origin/develop`, resolve the license/package decisions below, run local plus hosted Windows/macOS/Ubuntu checks, and open a separate PR. |
| Sandbox provider lifecycle | `SBX-PROVIDER-LIFECYCLE` | Active isolated worktree based on `4e15226`; uncommitted and unaccepted | Complete disposable-Windows-VM install/upgrade/uninstall/reboot/residue evidence. Do not advertise `restrictedReady` or promote a provider until the exact gate passes. |
| Attributable learning foundation | `CLI8A-MEMORY-FOUNDATION` | Candidate commit `b5effea` exists, but it was created from stale baseline `aa73e0e`; not merge-ready and not runtime-active | Replay the additive memory foundation onto the new `origin/develop`, settle the memory decisions below, run real Rust tests, then review as a separate PR. Automatic retrieval and skill activation remain out of scope. |

The stale-base candidates are salvageable implementation work, not accepted Forge
state. Their commits must be replayed instead of merging their old branch ancestry.

## Merge order and shared-boundary rule

1. Merge `DOC-GROUND-TRUTH`.
2. Replay and validate `CLI7-ALPHA`; merge it when the trusted-alpha gate passes.
3. Replay and validate `CLI8A-MEMORY-FOUNDATION`; integration may be prepared in
   parallel, but runtime retrieval remains gated by CLI8B evaluation.
4. Merge `SBX-PROVIDER-LIFECYCLE` only after its independent VM/provider gate; its
   timing does not redefine the trusted-alpha claim.

Rust run/event/artifact, policy, transaction, recovery, and sandbox-plan schemas are
contested shared boundaries. A lane that needs to change one must first update or
propose the relevant ADR and notify the other lanes. TypeScript adapters may not
create substitute runtime truth. Plan, changelog, and shared workflow edits must be
rebased and reconciled before merge rather than resolved by taking an entire side.

## Decisions required before the next public gate

| Priority | Decision | Why it blocks or bounds work | Decision owner/output |
| --- | --- | --- | --- |
| P0 | Root project license and rights owner | Public distribution cannot rely on the stale `MIT` package field while the plan names Apache-2.0 only as a candidate. | Project owner with appropriate legal/open-source review; root license plus consistent npm/Cargo metadata and notices. |
| P0 | Supported alpha target/package matrix | Package names, CPU targets, native payload lookup, hosted jobs, and support claims depend on it. | Product/release decision recorded in the release task and profile matrix. |
| P0 | Effective configuration and secret precedence | `doctor`, reproducibility, provider routing, and safe support output need one deterministic rule. | ADR or accepted release contract covering CLI, workspace, user, environment, defaults, redaction, and tightening rules. |
| P1 | Sandbox requirement/binding/lifecycle split | The provider must not become a second policy authority or receive two competing launch truths. | ADR-0033 refinement after the current conformance spike. |
| P1 | Memory semantic identity and lifecycle | Repeated facts, corrections, expiry, deletion, and scope cannot be inferred safely after public data exists. | CLI8A ADR plus fixtures before its merge. |
| P1 | Protocol compatibility and migration window | Run artifacts, bridge messages, ledgers, and future memory records need explicit old-version inspection and upgrade behavior. | Versioning ADR before another public schema bump. |
| P1 | Evaluation budgets | Small-model quality, latency, filesystem scans, tokens, retries, and accepted outcome need ceilings to prevent locally efficient-looking regressions. | Shared acceptance matrix before automatic retrieval/routing. |
| P2 | Public extension boundary | MCP, embedded hosts, skills, and future plugins need a declared stable surface without freezing private internals. | Post-alpha API/extension ADR before third-party integration promises. |

## Next three gates

1. Documentation PR merged and all lanes rebased or replayed from its resulting
   `origin/develop`.
2. `CLI7-ALPHA` clean-install and hosted acceptance, with license and target matrix
   resolved or the distribution explicitly kept private.
3. `CLI8A` foundation plus CLI8B no-memory/retrieved-memory evaluation, with no
   automatic retrieval until measurable quality and isolation gates pass.

The sandbox VM gate remains an independently scheduled fourth gate unless its
evidence invalidates a shared contract, in which case that contract issue must be
resolved before either sandbox or learning integration proceeds.
