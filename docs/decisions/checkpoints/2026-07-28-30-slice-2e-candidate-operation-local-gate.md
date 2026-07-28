# Checkpoint 30: ChangeSet v2 candidate-operation local gate

**Date:** 2026-07-28
**Status:** Local gate passed; hosted acceptance pending
**Branch:** `feature/slice-2e-candidate-operations`
**Base:** protected canonical `develop` at `00e30dea2e12777b7fc30152c74600a104fb0e79`

## Decision

Accept the candidate-side adapter as Increment 2E-1a local evidence. Do not accept
Increment 2E-1 or Slice 2E as complete until the full operation algebra can be
promoted and durably reconciled on Tier-1 platforms.

The adapter remains Rust authority. TypeScript, MCP, the CLI, and the active
workspace contract are unchanged.

## Implemented boundary

- `RepositoryPathIdentity` inventories tracked Git paths, preserves canonical
  repository spelling, and uses repository `core.ignorecase` semantics instead of
  unconditional lowercasing.
- The adapter requires a clean repository at the exact approved HEAD and matching
  workspace snapshot before it creates an external detached worktree.
- Manifest validation now rejects Forge/Git control paths and ancestor/descendant
  file conflicts that cannot coexist in one candidate tree.
- Before mutation, Rust revalidates manifest identity, every staged CAS blob, the
  original workspace state, source digest/mode preconditions, target absence, and
  ignored/symlink path hazards.
- Create, replace, delete, move/rename, repository executable-mode intent, and
  bounded binary/text content apply only inside the candidate worktree.
- Returned evidence contains deterministic operation order, complete
  workspace-relative paths, before/after digests and modes, blob digest, unchanged
  original-workspace status, and a bounded application diff.
- Any application failure removes the candidate worktree and clears the in-memory
  boundary. Explicit discard remains available after success.

## Adversarial evidence

Six focused integration tests prove:

1. every ChangeSet v2 operation applies together while the governed workspace stays
   byte-for-byte unchanged;
2. repository case aliases collide and unproven new non-ASCII paths fail closed on
   a case-insensitive repository;
3. ignored targets are rejected before candidate creation;
4. a same-size external source edit after prepare aborts and removes the candidate;
5. same-size staged-blob corruption after prepare aborts and removes the candidate;
6. `.git`/`.forge` control paths and file ancestor/descendant conflicts fail closed.

The complete local `npm run check:hybrid` gate passes Rust formatting, warnings-as-
errors Clippy, all Rust suites, Rust build, TypeScript typecheck, 37 TypeScript tests,
production build, and 27 hybrid/MCP assertions. The seven public MCP tools remain
unchanged and read-only.

## Audit finding: process ownership

One earlier complete Rust run reported a surviving Windows verifier descendant in
`timeout_and_in_flight_cancellation_are_distinct_and_recover`. Three immediate
isolated repeats and the subsequent complete Rust and hybrid gates passed. The
current Windows implementation invokes `taskkill /PID ... /T /F` and does not own
the process tree with a kernel primitive, so the intermittent observation remains a
real reliability gap rather than dismissed test noise.

Deterministic Windows Job Object ownership, paired with macOS process-group tests,
is now a P1 Slice 2E acceptance gate. This is about cancellation and cleanup
correctness; it does not claim filesystem/network sandboxing.

## Honest limits

- ChangeSet v2 still cannot mutate or promote into the active workspace. The
  accepted v1 existing-text candidate lifecycle remains the only promotion path.
- The v2 boundary is in-memory. It has no durable lease, write-ahead transaction
  record, startup reconciliation, or abrupt-kernel-death recovery yet.
- Path identity is repository-backed, not a native per-directory case/Unicode query.
  New non-ASCII targets therefore fail closed on case-insensitive repositories.
- Windows stores executable-mode intent in the Git candidate index; Windows has no
  POSIX executable bit. Cross-platform promotion semantics remain unaccepted.
- Worktree-add partial-failure reconciliation and decomposition of the large adapter
  module remain maintainability/recovery work for the coordinator increment.
- CAS garbage collection, global quotas, schema migration, repair tooling, and
  power-loss durability are not implemented.
- No public mutation API, MCP write tool, generic shell, authenticated host
  handshake, Forge-enforced sandbox, or unrestricted file-write capability was
  added.

## Next gate

1. obtain hosted Windows/macOS Tier-1 and Ubuntu compatibility evidence for this
   exact feature head;
2. add durable candidate ownership and startup reconciliation for v2;
3. implement all-or-recoverable active-workspace publication with fresh per-path
   identity checks and fault injection;
4. replace best-effort Windows process cleanup with proven process-tree ownership;
5. only then connect the full v2 lifecycle to the high-level sovereign CLI.