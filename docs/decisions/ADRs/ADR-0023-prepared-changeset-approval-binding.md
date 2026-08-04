# ADR-0023: Prepared ChangeSet approval binding

- **Status:** Accepted design; implementation on CLI ship lane increment 4B-1
- **Date:** 2026-08-04
- **Scope:** ChangeSet preparation, approval attribution, verifier outcome composition

## Context

Forge already had strong low-level machinery for content-addressed ChangeSet v2
application, candidate worktrees, bounded verification, durable accept/discard, and
recovery. Its public low-level command still had a serious composition defect:
`--approve` authorized only the proposal schema version and selected verifier IDs.
Rust generated the exact ChangeSet after that approval. A file could change between
review and execution, and the retained artifact did not contain the exact approved
call or approval facts.

A nicer prompt cannot repair that boundary. Approval must refer to immutable,
recomputable machinery identity before candidate mutation begins.

## Decision

1. The Rust sovereign-change protocol gains a non-mutating `prepare` operation.
   Preparation canonicalizes paths, observes current tracked-file digests and modes,
   stages content-addressed after-blobs in Forge state, and returns ChangeSet v2. It
   creates no candidate worktree and changes no source-workspace file.
2. The prepared `changeSetId` is the approval subject. The approved capability input
   contains exactly `changeSetId` plus the ordered selected verifier IDs.
3. Approved execution rebuilds the ChangeSet from the proposal and current workspace.
   A different ID fails before candidate preparation, application, or verification.
4. The authoritative change artifact retains the approved capability call, the
   attributable host/user facts, and Rust's resolved allow decision.
5. Rust constructs and evaluates the change outcome with the already accepted
   `OutcomeContract` vocabulary. It requires:
   - exact equality with the prepared ChangeSet ID;
   - one successful attempt for every selected verifier;
   - successful durable candidate registration.
6. `verified` therefore means all three mechanical conditions passed. Failed or
   cancelled verification, a stale prepared identity, or registration failure yields
   `unmet` even when some earlier work succeeded.
7. This breaking private boundary is `forge.kernel.changeset.v3`; the proposal result
   artifact is schema version 2. Old peers fail closed.
8. MCP remains the same seven read-only tools. No generic write or shell capability is
   introduced.

## Why this is a composition increment

The provider may suggest replacement text, but it does not define the ChangeSet,
approval result, verification result, or outcome. TypeScript will use the existing
non-mutating digest-bound change planner to present a human diff, while Rust supplies
the immutable ChangeSet identity and all terminal authority. The interactive CLI
composition is the next 4B increment over this primitive.

## Bounds and honest limitations

- `prepare` may write deduplicated blobs beneath the Forge engine root; it does not
  mutate the governed workspace or create a candidate.
- The interim `forge change propose <json>` command is still expert-facing and is not
  the intended developer UX.
- Preparation does not itself render a diff. The TypeScript change-plan evidence will
  provide the review view and must agree with the Rust-prepared operation identity.
- The returned sovereign artifact is attributable, but one canonical RunArtifact for
  the complete interactive edit lifecycle remains a 4B composition gate.
- Verifiers still use the documented trusted execution posture; this decision adds no
  OS sandbox.
- MCP mutation stays disabled until the local CLI flow is accepted.

## Rejected alternatives

- **Approve only a schema version and check list.** It does not identify the actual
  content or base revision being authorized.
- **Apply to a candidate to obtain a diff before approval.** Candidate mutation before
  consent violates the intended control boundary.
- **Let TypeScript assign the authoritative proposal ID.** It would split change
  authority across runtimes.
- **Create a change-specific success vocabulary.** The canonical outcome contract can
  represent exact identity, verifier success, and registration without a parallel
  assessment system.