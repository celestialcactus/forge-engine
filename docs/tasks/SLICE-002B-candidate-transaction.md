# Slice 2B: Rust-authoritative candidate transaction

- **Status:** Increment 2B-1 local gate passed; Increment 2B-2 pending
- **Opened:** 2026-07-22
- **Branch:** feature/slice-2b-change-transaction
- **Predecessor:** SGU-004 accepted at 69d2b743fc472ff00658c108f74450286f9044f8
- **Does not complete:** final promotion into the active developer workspace

## Objective

Turn an accepted Slice 2A proposal into a verified isolated candidate while Rust
owns manifest validation, final policy resolution, phase ordering, cancellation,
recovery, and terminal transaction status.

## Why the application manifest is required

The Slice 2A proposal artifact contains digests and a bounded review diff, but not
the complete replacement payload. That makes it excellent review evidence and an
insufficient executable artifact. Slice 2B adds an internal manifest containing
canonical path, before digest, after digest, and exact replacement text. Rust must
recompute both replacement digests and proposal identity before any adapter work.

The manifest is internal transaction input. It must not be copied into compact MCP
evidence or treated as a new public tool result.

## Increment 2B-1: transaction authority

Required deliverables:

1. Rust schema and validation for the application manifest.
2. Rust-owned authorization using SGU-004 ApprovalFacts.
3. One ordered candidate transaction phase record subordinate to RunArtifact.
4. Adapter evidence validation for boundary identity, applied paths/digests, and
   policy-named verification.
5. Automatic recovery after post-boundary failure or cancellation.
6. Explicit cleanup failure without false recovery claims.
7. No TypeScript transaction state machine and no MCP surface expansion.

Acceptance:

- verified candidates end in verified_candidate and are not promoted;
- denial and invalid manifests invoke no boundary adapter;
- apply failure, verification failure, malformed evidence, and cancellation
  produce deterministic recovery evidence;
- cleanup failure is terminal;
- Rust formatting, Clippy, tests, TypeScript checks, hybrid conformance, and build
  remain green.

## Increment 2B-2: clean-revision worktree adapter

Required deliverables:

1. Bind the repository root, clean status, HEAD revision, snapshot, and every
   before digest before creating a boundary.
2. Create a detached worktree with fixed Git arguments and no shell.
3. Apply replacement content only inside that worktree.
4. Re-read every applied file and prove after digests.
5. Resolve a policy-owned verification check ID to a fixed executable and argument
   vector; never accept a model-authored command string.
6. Bound output and time, distinguish timeout from cancellation, and implement a
   tested descendant-process strategy on Windows, macOS, and Linux.
7. Emit final candidate diff and cleanup/retention evidence.
8. Preserve the active workspace byte-for-byte.

Acceptance:

- clean matching fixtures verify on all three hosted operating systems;
- dirty, stale, untracked-dependent, missing-tool, timeout, cancellation, failed
  verification, and cleanup-failure fixtures remain explicit;
- official MCP and controlled VS Code tests still expose seven read-only tools.

## Deferred promotion gate

Moving a verified candidate into the active workspace requires a separate policy
decision and a fresh digest/revision comparison. It is not implicit in successful
verification and is not authorized by this task.

## Rollback rule

If transaction authority cannot remain in Rust, or if the candidate adapter can
mutate the original workspace before promotion, keep Slice 2A as the shipped
control and remove the incomplete mutation path. Do not expose a generic write or
shell tool as a shortcut.
