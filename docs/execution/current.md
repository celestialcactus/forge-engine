# ForgeEngine current execution index

**Status:** operational ground truth for active ForgeEngine delivery
**As of:** 2026-09-01
**Accepted implementation baseline:** PR #33 (implementation candidate `26f011e`)
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
authorizes prerequisite Slice 0 plus implementation Slices 1–3. Slices 4–5 remain
unapproved.

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
harness security. ADR-0038 and ADR-0039 lock the bounded CLI8A identity,
authority, capture, and recovery policy. Slices 0–2 are accepted through PR #32 and
[Checkpoint 92](../decisions/checkpoints/2026-08-31-92-cli8a-memory-slice-0-2-hosted-gate.md):
Rust owns the canonical ledger/lifecycle, while TypeScript orchestrates CLI UX.
Slice 3 is accepted through PR #33 candidate `26f011e` and
[Checkpoint 93](../decisions/checkpoints/2026-09-01-93-cli8a-memory-slice-3-hosted-gate.md):
current-repository standing grants, ask/auto/off UX, bounded direct-preference
capture, find/explain across restart, content-removing immediate undo, and real TTY
editing pass the local, VS Code, and hosted gates. These slices activate no
planner/provider retrieval. Public
distribution still requires contributor-rights attestation and artifact
signing/provenance. Trusted execution has no
Forge-enforced OS containment. Native restricted providers continue independently
and cannot borrow or block trusted-alpha or CLI8 acceptance.

See the [release profiles](../architecture/forgeengine-release-profiles.md) for the
claims permitted at each delivery stage.

## Active lanes

| Lane | Canonical ID | State on 2026-09-01 | Authority and next gate |
| --- | --- | --- | --- |
| Documentation reconciliation | `DOC-GROUND-TRUTH` | Accepted at `5fff597` through PR #25 | Preserve Checkpoint 88 and the execution/release-profile authority during every lane replay. |
| Authority and contract clarification | `ARCH-AUTHORITY` | Accepted through PR #26 (`70a3288`) | Preserve the repository guard, Apache-2.0 alignment, target/config/protocol decisions, memory primer, and system map. |
| Trusted-alpha release | `CLI7-ALPHA` | Private distribution/onboarding foundation accepted through PR #27 (`6cc90c1`) and Checkpoint 90; PR #28 (`2882550`) corrects reported blockers | Preserve the accepted private tester boundary. Rights attestation and artifact signing/provenance remain separate public-distribution gates; no public artifact has shipped. |
| Effective configuration | `CLI7-ALPHA-CONFIG` | Accepted through PR #31 candidate `e7ba284` and Checkpoint 91 | Preserve the fixed files, immutable compiler, source attribution, secret-safe projection, atomic route, monotonic ceilings, and no-fallback behavior. Do not add an organization provider-policy subsystem. |
| Sandbox provider lifecycle | `SBX-PROVIDER-LIFECYCLE` | Independent and unaccepted for production; local managed-Windows/AppContainer conformance exists | Complete disposable-Windows-VM install/upgrade/uninstall/reboot/residue plus macOS/adversarial evidence. Do not advertise `restrictedReady` or promote a provider until the exact gate passes. |
| Attributable learning foundation | `CLI8A-MEMORY-FOUNDATION` | Slices 0–2 accepted through PR #32 / Checkpoint 92; Slice 3 accepted through PR #33 candidate `26f011e` / Checkpoint 93 | Preserve current-repository `off|ask|auto`, exact developer-ledger standing grants, bounded eligibility, visible attribution, owned TTY editing plus queued pipe ingestion, stream-close protocol parsing, and narrow rewrite-style undo. Preserve inactive retrieval; Slices 4–5 and CLI8B/C remain gated. |

The stale-base CLI7 candidate was successfully replayed without importing its old
ancestry. The stale CLI8A candidate `b5effea` remains reference material only; the
accepted implementation is the ADR-0038/0039-conformant PR #32–33 lineage.

## Merge order and shared-boundary rule

1. `ARCH-AUTHORITY` is merged and accepted through PR #26.
2. The authoritative `CLI7-ALPHA` replay and hosted gate are merged and accepted
   through PR #27; PR #28 aligns the product-reported remaining blockers.
3. The [ADR-0036 effective-configuration loader/conformance suite](../tasks/SLICE-CLI7-ALPHA-effective-configuration.md)
   is accepted through PR #31 and Checkpoint 91.
4. ADR-0038 and ADR-0039 settle the memory boundary, and the
   [combined four-gate packet](../tasks/CLI8A-MEMORY-FOUR-GATE-REVIEW.md) authorizes
   Slice 0–2. PR #32 and Checkpoint 92 accept their exact MSVC, separate VS Code,
   hosted, package, and benchmark evidence. Slice 3 autosave was explicitly
   authorized on 2026-08-31 and is implemented at `afa6e67`; corrected candidate
   `33ee986` closes the PTY echo defect found by the first live pilot, `5c84a97`
   removes its doubled-period undo blemish, and `3849cd0` closes the Linux
   stdout-drain race found by the first corrected hosted attempt. Final candidate
   `26f011e` closes the real Windows TTY Backspace defect while preserving queued
   pipe input. PR #33 and Checkpoint 93 accept the exact local, live VS Code, and
   hosted evidence. Runtime retrieval remains gated by
   CLI8B; Slices 4–5 require new explicit authorization.
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

1. Separately review Slice 4 privacy lifecycle through the four approval gates.
   No Slice 4 implementation is authorized by Checkpoint 93.
2. After Slice 4 authorization and acceptance, separately review Slice 5 context
   preview; it retains its own authorization gate.
3. After complete CLI8A acceptance and later CLI8B authorization, run paired
   no-memory/retrieved-memory evaluation; automatic retrieval remains disabled until
   measurable quality and isolation gates pass. Reviewed skills remain a later
   separately measured CLI8C gate.

Contributor-rights attestation and artifact signing/provenance remain independent
pre-publication gates. The accepted tester kit may be used privately without
turning its archives into a public release.

The sandbox VM gate remains an independently scheduled fourth gate unless its
evidence invalidates a shared contract, in which case that contract issue must be
resolved before either sandbox or learning integration proceeds.
