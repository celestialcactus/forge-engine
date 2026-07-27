# Slice 2E: change fidelity and transaction coordination

- **Status:** In progress; Increment 2E-0 accepted at `fd3d9eb`
- **Opened:** 2026-07-27
- **Branch:** `feature/slice-2e-change-fidelity`
- **Base:** accepted Slice 2D checkpoint `3b2b62f`
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

## Increment 2E-3: complete sovereign CLI

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
