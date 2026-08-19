# ForgeEngine current execution index

**Status:** operational ground truth for active ForgeEngine delivery
**As of:** 2026-08-18
**Accepted implementation baseline:** `origin/develop` at `2882550` (PR #28)
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

Repository/worktree authority is defined by
[ADR-0035](../decisions/ADRs/ADR-0035-canonical-repository-and-worktree-authority.md)
and the [authority workflow](../development/repository-authority.md). A new lane
must contain reconstruction anchor `5fff597` and the fetched `origin/develop`; a
Codex worktree created from the old OneDrive prototype is not authoritative.

## Current release objective

The private **CLI7-ALPHA distribution and onboarding foundation is accepted**
through PR #27 and Checkpoint 90. The current implementation gate is ADR-0036
effective-configuration loading and conformance: precedence, monotonic policy
tightening, secret redaction, and effective-source reporting. Public distribution
also requires contributor-rights attestation and artifact signing/provenance.
Trusted execution has no Forge-enforced OS containment. Native restricted providers
continue independently and cannot borrow or block trusted-alpha acceptance.

See the [release profiles](../architecture/forgeengine-release-profiles.md) for the
claims permitted at each delivery stage.

## Active lanes

| Lane | Canonical ID | State on 2026-08-18 | Authority and next gate |
| --- | --- | --- | --- |
| Documentation reconciliation | `DOC-GROUND-TRUTH` | Accepted at `5fff597` through PR #25 | Preserve Checkpoint 88 and the execution/release-profile authority during every lane replay. |
| Authority and contract clarification | `ARCH-AUTHORITY` | Accepted through PR #26 (`70a3288`) | Preserve the repository guard, Apache-2.0 alignment, target/config/protocol decisions, memory primer, and system map. |
| Trusted-alpha release | `CLI7-ALPHA` | Private distribution/onboarding foundation accepted through PR #27 (`6cc90c1`) and Checkpoint 90; PR #28 (`2882550`) corrects reported blockers | Implement/test ADR-0036 effective configuration. Rights attestation and artifact signing/provenance remain separate public-distribution gates; no public artifact has shipped. |
| Sandbox provider lifecycle | `SBX-PROVIDER-LIFECYCLE` | Independent and unaccepted for production; local managed-Windows/AppContainer conformance exists | Complete disposable-Windows-VM install/upgrade/uninstall/reboot/residue plus macOS/adversarial evidence. Do not advertise `restrictedReady` or promote a provider until the exact gate passes. |
| Attributable learning foundation | `CLI8A-MEMORY-FOUNDATION` | Candidate commit `b5effea` remains stale-base, replay-required, and runtime-inactive | After the configuration-conformant standalone alpha gate, settle the memory decisions below, replay only the bounded additive diff onto fresh `origin/develop`, run real Rust tests, then review separately. Automatic retrieval and skill activation remain out of scope. |

The stale-base CLI7 candidate was successfully replayed without importing its old
ancestry. The remaining CLI8A candidate is salvageable implementation work, not
accepted Forge state; replay only its bounded diff onto fresh ancestry.

## Merge order and shared-boundary rule

1. `ARCH-AUTHORITY` is merged and accepted through PR #26.
2. The authoritative `CLI7-ALPHA` replay and hosted gate are merged and accepted
   through PR #27; PR #28 aligns the product-reported remaining blockers.
3. Implement and validate the ADR-0036 effective-configuration loader/conformance
   suite as the next bounded lane.
4. Settle the four memory policy choices, then replay and validate
   `CLI8A-MEMORY-FOUNDATION`; integration may be prepared in
   parallel, but runtime retrieval remains gated by CLI8B evaluation.
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
| P0 | Effective configuration implementation | Precedence and monotonic policy tightening are accepted in ADR-0036; runtime fixtures and `doctor` source/redaction output remain open. | Release-lane implementation and tests. |
| P0 | Public artifact signing and provenance | Private hosted/package evidence does not sign or establish provenance for a published artifact. | Release workflow and exact target evidence before publication. |
| P1 | Sandbox requirement/binding/lifecycle split | The provider must not become a second policy authority or receive two competing launch truths. | ADR-0033 refinement after the current conformance spike. |
| P1 | Memory policy choices | Claim/observation identity, append-only corrections, and no implicit scope widening are recommended; normalization, preference promotion, privacy purge, and expiry defaults remain open. | Review the memory primer and settle with CLI8 fixtures before replay. |
| P1 | Protocol implementation | ADR-0037 accepts negotiation and copy-on-write migration; current code still needs handshake/migration fixtures before another public schema bump. | Protocol increment with golden compatibility tests. |
| P1 | Evaluation budgets | Small-model quality, latency, filesystem scans, tokens, retries, and accepted outcome need ceilings to prevent locally efficient-looking regressions. | Shared acceptance matrix before automatic retrieval/routing. |
| P2 | Public extension boundary | MCP, embedded hosts, skills, and future plugins need a declared stable surface without freezing private internals. | Post-alpha API/extension ADR before third-party integration promises. |

## Next three gates

1. Implement ADR-0036 effective configuration and pass precedence, monotonic-
   tightening, source-reporting, secret-redaction, and hosted conformance fixtures.
2. Settle memory policy, then replay and validate only the bounded additive `CLI8A`
   observation foundation on fresh `origin/develop`.
3. Run CLI8B no-memory/retrieved-memory evaluation, with no automatic retrieval
   until measurable quality and isolation gates pass.

Contributor-rights attestation and artifact signing/provenance remain independent
pre-publication gates. The accepted tester kit may be used privately without
turning its archives into a public release.

The sandbox VM gate remains an independently scheduled fourth gate unless its
evidence invalidates a shared contract, in which case that contract issue must be
resolved before either sandbox or learning integration proceeds.
