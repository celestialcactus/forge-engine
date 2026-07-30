# Slice 2E: change fidelity and transaction coordination

- **Status:** In progress; Increments 2E-0 (`fd3d9eb`), 2E-1a (`b930d31`), verifier process ownership (`ff4aedf`), 2E-2 (`8c29037`), and 2E-3a (`c872a81`) accepted; Increment 2E-3b CLI/candidate cleanup remains
- **Opened:** 2026-07-27
- **Active branch:** `feature/slice-2e3-owner-death`; next branch will be Slice 2E-3b
- **Current base:** protected canonical `develop` at `6a25a51`
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu
- **Does not add:** generic shell, unrestricted file writes, symlink mutation, public MCP mutation, authenticated host-managed execution, or an unproven sandbox claim

## Why this slice exists

Slice 2D proves that Forge can safely finish one bounded text-replacement candidate.
That is a real vertical slice, but not yet a dependable general change engine. A
normal developer task may create a file, delete obsolete code, rename a module,
change an executable bit, or update a bounded non-text asset. Concurrent editors,
host cancellation, and process restart must not turn those operations into silent
partial state.

This slice strengthens the underlying machinery before context compression, memory,
skills, or additional providers can hide its weaknesses.

## Authority boundary

Rust owns operation validation, content identity, platform publication, transaction
state, conflict decisions, recovery, cancellation outcome, and terminal evidence.
TypeScript owns proposal/workflow ergonomics, CLI/MCP/IDE transport, and presentation.
It may stage bytes through the bounded private protocol; it may not declare those
bytes valid, applied, recovered, or promoted.

## Increment 2E-0: ChangeSet v2 contract and CAS staging

1. Define a versioned, deterministic Rust manifest with bounded operations:
   create, replace, delete, move/rename, executable-mode intent, and bounded binary.
2. Reference after-content by a SHA-256 `BlobRef`; do not embed large content in the
   control manifest or lifecycle record.
3. Store blobs outside the governed workspace with atomic create, digest validation,
   collision/corruption detection, and bounded size/count/aggregate limits.
4. Reject traversal, absolute paths, malformed UTF-8 paths, NULs, duplicate targets,
   source/destination collisions, move cycles, stale before-digests, and no-ops.
5. Reject symlink operands explicitly until a separate symlink policy is accepted.
6. Make ChangeSet identity independent of host JSON formatting and filesystem
   enumeration order.

### Platform rules

- Do not lowercase every path. Resolve case/collision semantics from the governed
  repository/filesystem boundary.
- Windows gates cover drive/UNC rejection at the manifest boundary, reserved names,
  separator normalization, case collisions, long-path behavior, locked files, and
  exact atomic publication.
- macOS gates cover case-insensitive default volumes and case-sensitive volumes
  where available, Unicode/path identity behavior, executable bits, process groups,
  rename semantics, and directory sync behavior.
- Ubuntu runs the same semantic contract as a compatibility check; it must not
  become a separate authority model.

## Increment 2E-1: operation adapters

Apply every accepted operation only inside the recoverable candidate boundary.
Application evidence includes the exact operation kind, canonical paths, before and
after identities, blob identity, and bounded diff/summary. Active-workspace
promotion revalidates the same identities and preserves an all-or-recoverable result.

### Increment 2E-1a: candidate-side application

The local gate now supplies a repository-backed path identity and applies create,
replace, delete, move/rename, repository executable-mode intent, and bounded
binary/text blobs only inside an external detached worktree. Rust revalidates the
clean base revision, snapshot, per-path content/mode preconditions, and CAS bytes
before mutation. It returns exact operation/path/digest/mode evidence plus a bounded
Git diff, proves the original workspace stayed unchanged, and removes the candidate
on a failed application.

This is deliberately not the active-workspace promotion gate. Exact implementation
`b930d31` passed hosted Windows/macOS Tier-1 and Ubuntu compatibility conformance.
Promotion of the full operation algebra, durable candidate ownership across kernel
death, startup reconciliation, and fault-injected publication remain under the
following 2E-1/2E-2 work.

### Cross-cutting P1 gate: verifier process ownership

The local gate replaces Windows `taskkill` with suspended pre-execution assignment
to a Rust-owned kill-on-close Job Object and confirms zero active processes after
teardown. Unix/macOS process-group errors and completion are now checked rather
than ignored. Nested timeout, cancellation, and Windows owner-death stress tests
pass locally. Hosted Tier-1/compatibility evidence is pending; macOS abrupt Forge
owner death remains a named gap. See ADR-0010, the process-ownership task, and
Checkpoint 31.

## Increment 2E-2: transaction coordinator

1. Add a small append/durable write-ahead state machine for prepared, applying,
   applied, verifying, verified, promoting, promoted, discarding, discarded,
   recovering, recovered, and explicit repair-required outcomes.
2. Reconcile incomplete records at kernel startup before accepting a conflicting
   lifecycle request.
3. Bind a transaction to repository identity, base revision, workspace generation,
   and per-path identities. A third-party edit causes a conflict, never overwrite.
4. Keep repository locks advisory and document that fact. Correctness comes from
   fresh identity checks and idempotent recovery, not the lock alone.
5. Add graceful duplex cancellation. Abrupt host death remains reconstructable on
   the next startup.

### Increment 2E-2 accepted result

The Rust coordinator now registers one bounded transaction manifest, exact
before-images, and an append-oriented transition journal outside the governed
workspace. Promotion uses deterministic operation order, fresh identity and
absence checks, advisory repository/transaction locks, per-operation verification,
and immediate rollback when a synchronous operation or final verification fails.
A new coordinator instance reconciles recognized interrupted states into one
terminal artifact; corruption or unrecognized developer divergence becomes
`repair_required` and is never silently overwritten.

Hosted run `30511168400` passed the Rust/hybrid gate on Windows, macOS, and Ubuntu;
run `30511168395` passed Windows/macOS TypeScript conformance. Windows executable
create/mode changes and case-only active renames remain fail-before-mutation rather
than being misrepresented as portable. This gate proves process-restart recovery,
not a power-loss transaction. The coordinator is still a private Rust API: public
CLI/MCP mutation and complete candidate cleanup remain later increments.

## Increment 2E-3a: abrupt Unix/macOS verifier owner death — accepted

The packaged Rust watchdog uses a parent-owned liveness pipe, bounded verifier
startup acknowledgement, and one dedicated process group. Hosted run
`30551820932` passed on Windows, macOS, and Ubuntu; Node run `30551821183` passed
on both Tier-1 platforms. The macOS/Ubuntu owner-`SIGKILL` fixture left no survivor
marker, Windows retained Job Objects, and a controlled seven-tool VS Code summary
completed with one call. See ADR-0012 and Checkpoints 35–36.

This is lifecycle ownership, not sandbox containment. Deliberate process-group
escape and permission restrictions remain Slice 2F.

## Increment 2E-3b: complete sovereign CLI

Provide one high-level local flow that can propose/stage, verify, inspect, accept,
or discard a transaction. The CLI transports and renders Rust artifacts. It does
not expose an arbitrary command, arbitrary direct write, or a TypeScript policy
shortcut.

## Acceptance gates

- deterministic unit/property-style fixtures for valid and invalid operation graphs;
- CAS corruption, duplicate, partial-create, and bounds tests;
- same-size and same-timestamp concurrent-edit fixtures;
- injected failure and cancellation at every durable coordinator transition;
- process-restart reconciliation without silent partial success;
- Windows locked-file, case-collision, separator, replacement, and process cleanup tests;
- macOS case/mode, process-group, rename, and durability tests;
- Ubuntu compatibility matrix;
- complete local CLI acceptance in disposable repositories;
- existing TypeScript, Rust, hybrid, seven-tool MCP, and VS Code read-only regressions remain green.

## Rollback rule

If one operation cannot preserve exact identity and recoverability on both Tier-1
platforms, keep that operation private/unsupported. Do not weaken the manifest,
move authority into TypeScript, or expose direct writes to satisfy the demo.
