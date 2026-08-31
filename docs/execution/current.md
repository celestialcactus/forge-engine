# ForgeEngine current execution index

**Status:** operational ground truth for active ForgeEngine delivery
**As of:** 2026-08-31
**Accepted implementation baseline:** PR #31 merge `f36a767` (implementation
candidate `e7ba284`)
**Documentation baseline:** the commit containing this file

This file answers what is active now. The
[validated build plan](../architecture/forgeengine-v1-validated-build-plan.md)
defines product direction and durable gates; ADRs define accepted architectural
decisions; slice task files define bounded implementation scope; checkpoints record
immutable evidence. A candidate branch or checkpoint does not become accepted
product state until its exact implementation is merged and its required gates pass.

Consequential new lanes additionally use the
[four-gate delivery workflow](../development/four-gate-delivery-workflow.md).
Product, Architecture, Program Design, and the authorized Vertical Slice packet
must be explicitly approved before implementation. Small local changes use the
documented proportional fast or compact path. Existing CLI8A Package 1 predates
this policy; the combined CLI8A packet is the first full-path application and now
authorizes only prerequisite Slice 0 plus implementation Slices 1–2.

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

Repository/worktree authority is defined by
[ADR-0035](../decisions/ADRs/ADR-0035-canonical-repository-and-worktree-authority.md)
and the [authority workflow](../development/repository-authority.md). A new lane
must contain reconstruction anchor `5fff597` and the fetched `origin/develop`; a
Codex worktree created from the old OneDrive prototype is not authoritative.

## Current release objective

The private **CLI7-ALPHA distribution, onboarding, and effective-configuration
foundation is accepted** through PR #31 and
[Checkpoint 91](../decisions/checkpoints/2026-08-19-91-effective-configuration-hosted-gate.md).
One immutable, redacted, source-attributed configuration now drives every product
entry path on the declared target matrix. Organizational inference governance
belongs to the operator; Forge retains faithful/no-fallback routing and intrinsic
harness security. ADR-0038 and ADR-0039 now lock the bounded CLI8A identity,
authority, capture, and recovery policy. The active branch implements the authorized
Slice 0–2 candidate: Rust owns the canonical ledger/lifecycle, while TypeScript
orchestrates CLI UX. It activates no planner/provider retrieval. Public
distribution still requires contributor-rights attestation and artifact
signing/provenance. Trusted execution has no
Forge-enforced OS containment. Native restricted providers continue independently
and cannot borrow or block trusted-alpha or CLI8 acceptance.

See the [release profiles](../architecture/forgeengine-release-profiles.md) for the
claims permitted at each delivery stage.

## Active lanes

| Lane | Canonical ID | State on 2026-08-29 | Authority and next gate |
| --- | --- | --- | --- |
| Documentation reconciliation | `DOC-GROUND-TRUTH` | Accepted at `5fff597` through PR #25 | Preserve Checkpoint 88 and the execution/release-profile authority during every lane replay. |
| Authority and contract clarification | `ARCH-AUTHORITY` | Accepted through PR #26 (`70a3288`) | Preserve the repository guard, Apache-2.0 alignment, target/config/protocol decisions, memory primer, and system map. |
| Trusted-alpha release | `CLI7-ALPHA` | Private distribution/onboarding foundation accepted through PR #27 (`6cc90c1`) and Checkpoint 90; PR #28 (`2882550`) corrects reported blockers | Preserve the accepted private tester boundary. Rights attestation and artifact signing/provenance remain separate public-distribution gates; no public artifact has shipped. |
| Effective configuration | `CLI7-ALPHA-CONFIG` | Accepted through PR #31 candidate `e7ba284` and Checkpoint 91 | Preserve the fixed files, immutable compiler, source attribution, secret-safe projection, atomic route, monotonic ceilings, and no-fallback behavior. Do not add an organization provider-policy subsystem. |
| Sandbox provider lifecycle | `SBX-PROVIDER-LIFECYCLE` | Independent and unaccepted for production; local managed-Windows/AppContainer conformance exists | Complete disposable-Windows-VM install/upgrade/uninstall/reboot/residue plus macOS/adversarial evidence. Do not advertise `restrictedReady` or promote a provider until the exact gate passes. |
| Attributable learning foundation | `CLI8A-MEMORY-FOUNDATION` | Slice 0–2 candidate `6f37c8c` passes exact MSVC, separate VS Code lifecycle, 16 focused Rust tests, 154 Node tests, and real source-CLI/hybrid evidence; hosted and merge evidence pending | Validate the exact candidate on hosted Windows x64, macOS ARM64/x64, and Ubuntu x64, then checkpoint and merge. Do not begin Slices 3–5, cherry-pick stale candidate `b5effea`, or activate retrieval. |

The stale-base CLI7 candidate was successfully replayed without importing its old
ancestry. The remaining CLI8A candidate is useful source material, not accepted
Forge state; selectively reimplement only behavior that conforms to ADR-0038 on
fresh ancestry.

## Merge order and shared-boundary rule

1. `ARCH-AUTHORITY` is merged and accepted through PR #26.
2. The authoritative `CLI7-ALPHA` replay and hosted gate are merged and accepted
   through PR #27; PR #28 aligns the product-reported remaining blockers.
3. The [ADR-0036 effective-configuration loader/conformance suite](../tasks/SLICE-CLI7-ALPHA-effective-configuration.md)
   is accepted through PR #31 and Checkpoint 91.
4. ADR-0038 and ADR-0039 settle the authorized memory boundary, and the
   [combined four-gate packet](../tasks/CLI8A-MEMORY-FOUR-GATE-REVIEW.md) authorizes
   Slice 0–2. Exact MSVC and separate VS Code product-lifecycle evidence pass at
   `6f37c8c`; hosted target and merge evidence remain. Runtime retrieval remains
   gated by CLI8B.
5. Merge `SBX-PROVIDER-LIFECYCLE` only after its independent VM/provider gate; its
   timing does not redefine the trusted-alpha claim.

Rust run/event/artifact, policy, transaction, recovery, and sandbox-plan schemas are
contested shared boundaries. A lane that needs to change one must first update or
propose the relevant ADR and notify the other lanes. TypeScript adapters may not
create substitute runtime truth. Plan, changelog, and shared workflow edits must be
rebased and reconciled before merge rather than resolved by taking an entire side.

## Decisions required before the next public gate

| Priority | Decision | Why it blocks or bounds work | Decision owner/output |
| --- | --- | --- | --- |
| P0 | Public rights attestation | Apache-2.0 is selected and metadata aligned, but the license cannot prove whether employer or third-party rights apply. | Maintainer/legal or open-source review before package publication. |
| P0 | Public artifact signing and provenance | Private hosted/package evidence does not sign or establish provenance for a published artifact. | Release workflow and exact target evidence before publication. |
| P1 | Sandbox requirement/binding/lifecycle split | The provider must not become a second policy authority or receive two competing launch truths. | ADR-0033 refinement after the current conformance spike. |
| P1 | Protocol implementation | ADR-0037 accepts negotiation and copy-on-write migration; current code still needs handshake/migration fixtures before another public schema bump. | Protocol increment with golden compatibility tests. |
| P1 | Evaluation budgets | Small-model quality, latency, filesystem scans, tokens, retries, and accepted outcome need ceilings to prevent locally efficient-looking regressions. | Shared acceptance matrix before automatic retrieval/routing. |
| P2 | Public extension boundary | MCP, embedded hosts, skills, and future plugins need a declared stable surface without freezing private internals. | Post-alpha API/extension ADR before third-party integration promises. |

## Next three gates

1. Validate the exact CLI8A Slice 0–2 candidate on the declared hosted targets;
   record a checkpoint and merge only if those gates pass. The supported MSVC and
   separate VS Code product-lifecycle gates already pass at `6f37c8c`.
2. After that candidate is accepted and later retrieval authorization is granted,
   run CLI8B
   no-memory/retrieved-memory evaluation, with no automatic retrieval
   until measurable quality and isolation gates pass.
3. Gate reviewed skill-candidate promotion on attributable evidence and the same
   Rust-owned capability, approval, transaction, and artifact authority.

Contributor-rights attestation and artifact signing/provenance remain independent
pre-publication gates. The accepted tester kit may be used privately without
turning its archives into a public release.

The sandbox VM gate remains an independently scheduled fourth gate unless its
evidence invalidates a shared contract, in which case that contract issue must be
resolved before either sandbox or learning integration proceeds.
