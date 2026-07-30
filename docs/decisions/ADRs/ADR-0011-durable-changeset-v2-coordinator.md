# ADR-0011: Durable ChangeSet v2 transaction coordinator

- **Status:** proposed
- **Date:** 2026-07-29
- **Owners:** ForgeEngine maintainers
- **Checkpoint:** 2026-07-29-33
- **Supersedes:** none
- **Superseded by:** none

## Context

ChangeSet v2 can validate and apply create, replace, delete, move, mode, text,
and binary operations inside a detached candidate worktree. It cannot yet publish
that operation set into the active workspace or reconstruct an interrupted
publication. The older candidate lifecycle proves restart-safe promotion for
existing text files, but its lease and recovery record cannot represent absent
paths, moves, executable-mode intent, or operation-by-operation progress.

Forge must not acknowledge a successful promotion and later forget it. It must
also refuse to overwrite an editor or another tool that changes an affected path
during publication or recovery. Windows and macOS remain Tier 1; Ubuntu remains a
compatibility gate.

## Decision drivers

- Rust remains the sole authority for mutation, recovery, conflicts, and terminal evidence.
- The coordinator must reuse ChangeSet v2 and candidate evidence rather than define
  a parallel operation model.
- Restart recovery must be deterministic after ordinary process termination.
- External editors do not honor Forge locks, so fresh identity checks—not locking—
  must provide correctness.
- The design must stay small enough for the near-term prototype and avoid an
  unnecessary database dependency.

## Options considered

### Extend the text-only promotion journal in place

This minimizes new files, but overloads a lease whose identity assumes every path
exists both before and after promotion. Moves, creates, deletes, and operation
progress do not fit that contract without weakening its accepted invariants.

### Use Git commits, stash, or the index as the transaction journal

Git supplies valuable content and repository identity, but its mutable index and
user-visible refs are shared developer state. Using them as Forge's only journal
would conflate a developer workflow with Forge recovery and would not encode
approval, cancellation, or repair-required outcomes.

### Add a SQLite/event-store coordinator now

A database can support later projections and search, but it does not remove the
need for filesystem publication, before-images, directory synchronization, or
per-path conflict checks. It adds packaging and migration work before the bounded
transaction semantics are proven.

### Add a bounded filesystem coordinator beside the accepted lease

Keep the immutable ChangeSet v2 manifest and candidate as inputs. Atomically publish
one transaction directory outside the governed workspace containing a bounded
manifest, exact before-images, and an append-oriented transition journal. Reconcile
non-terminal records before accepting a conflicting lifecycle request.

## Decision

Forge will implement the bounded filesystem coordinator.

The Rust coordinator owns registration, fresh repository/path validation,
publication, rollback, cancellation outcome, restart reconciliation, and terminal
artifacts. TypeScript may later transport those artifacts but cannot assign a
terminal state.

Each transaction is bound to the canonical repository, base revision, ChangeSet
identity, candidate boundary, workspace snapshot generation, and exact before/after
path identities. Registration atomically publishes the manifest, before-images,
and initial `prepared` transition. Promotion appends and synchronizes transitions
before mutation, after each verified operation, and before returning a terminal
artifact.

The repository lock is advisory. Immediately before each operation, Forge checks
the affected paths and the absence of unexpected workspace changes. Recovery
accepts only states that are an exact before-state, an exact Forge-produced
after-state, or a documented partial state for the current operation. Any other
state becomes `repair_required`; Forge does not overwrite it automatically.

The first implementation guarantees process-crash/restart reconstruction. It does
not claim a power-loss filesystem transaction. Directory-sync support and its
platform evidence are recorded, but power-loss testing and repair tooling remain
the release-hardening gate.

## Consequences

### Positive

- Full-operation promotion and rollback share the accepted ChangeSet v2 contract.
- Ordinary process interruption has a deterministic recovery path.
- Successful terminal outcomes survive restart because the terminal transition is
  synchronized before acknowledgment.
- Concurrent changes to affected paths fail closed instead of being overwritten.
- The implementation introduces no database or integration-layer policy authority.

### Negative

- Before-images temporarily duplicate bounded affected content outside the workspace.
- Multi-file publication is recoverable, not atomically visible as one filesystem action.
- Journal schema migration and garbage collection become explicit responsibilities.
- Some platform-specific mode and case-only rename behavior may remain unsupported
  until its Tier-1 gate is proven; unsupported cases must fail before mutation.

### Risks and mitigations

- **Torn or corrupt journal:** length bounds, strict schema validation, ordered
  sequence numbers, synchronized appends, and `repair_required` on ambiguity.
- **External editor race:** fresh digest/mode/absence checks before each mutation
  and before rollback; advisory locks are never treated as containment.
- **Coordinator crash between mutation and progress append:** recovery inspects the
  actual per-operation state and rolls back only recognized Forge states.
- **Path escape or symlink substitution:** reuse ChangeSet validation and perform
  no-symlink resolution again at every mutation boundary.

## Validation plan

- Inject interruption before and after every durable transition and every operation.
- Restart a new coordinator instance and prove one terminal recovered artifact.
- Exercise create, replace, delete, move, executable-mode intent, text, and binary.
- Prove same-size concurrent edits, unexpected paths, symlinks, and corrupted
  before-images never get silently overwritten.
- Pass local Rust/hybrid/TypeScript checks plus hosted Windows, macOS, and Ubuntu.
- Re-run the controlled VS Code read-only tether to prove no integration regression.

## Revisit or replacement conditions

- Power-loss testing shows that the filesystem protocol cannot meet the release gate.
- Durable projections/search require a database; that database may index coordinator
  events but must not become a second mutation authority.
- Platform evidence justifies a stronger native transaction primitive behind the
  same Rust contract.

## References

- `docs/architecture/slice-2-change-transaction.md`
- `docs/tasks/SLICE-002E-change-fidelity-and-coordination.md`
- ADR-0009
- ADR-0010