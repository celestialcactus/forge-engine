# ADR-0029: Append-before-notify Rust run ledger

- **Status:** Implemented; local gate passed; hosted and controlled VS Code validation pending
- **Date:** 2026-08-05
- **Scope:** CLI ship-lane increment 6A, Rust bridge, local run history

## Context

Forge produces an authoritative ordered event trace and terminal artifact, but the
outer run currently exists only in process memory and host output. The ChangeSet
machinery has durable recovery, while provider messages and outer run state do not.

Writing received events from TypeScript would leave an authority gap: Rust could
advance state and notify the host immediately before the host crashes, losing the
event. Treating the final artifact alone as resumable would also be false. It lacks
provider-specific pending tool-call identifiers and cannot prove whether an
unrecorded external operation happened.

## Decision

1. Add one bounded filesystem run ledger implemented in Rust and configured by the
   TypeScript integration through the existing engine root.
2. Advance the run bridge protocol for the new persistence contract. Older peers
   fail closed rather than silently ignoring the store.
3. Hash the complete run ID with SHA-256 for directory names. Store the original
   run ID inside every record and reject any mismatch.
4. Persist a versioned start record containing the exact `RunRequest`, registered
   capability IDs, and a canonical request digest before runtime events. Explicit
   replay-safety descriptors remain part of 6B.
5. Append one complete JSON event per line and synchronize it before sending the
   matching `run.event` frame to TypeScript.
6. Atomically publish and synchronize the terminal artifact only after validating
   exact request/run identity, event sequence, terminal status, and event parity.
   Only then send `run.result`.
7. Never reopen a run ID for execution. A duplicate terminal or incomplete record
   is inspected rather than appended to or overwritten.
8. Add a small Rust run-store inspection protocol. It returns bounded structured
   state and an optional validated terminal artifact; TypeScript does not parse raw
   ledger files as authority.
9. Classify a valid unsealed prefix as `open_or_interrupted`, not resumable. Classify
   malformed, mismatched, reordered, truncated, or oversized state as
   `repair_required` without deleting evidence.
10. Defer automatic continuation until 6B persists bridge interactions and provider
    planner state. No incomplete run is automatically restarted in 6A.

## Storage layout

The default root is `<engineRoot>/runs/v1`. A run lives below the first two digest
characters and the full lowercase SHA-256 of its run ID. The bounded record uses:

- `request.json`: create-once start identity;
- `events.jsonl`: append-only canonical Rust events;
- `artifact.json`: atomic terminal seal.

SQLite and graph representations may project these files later. They are not a
source of truth and cannot mutate run state.

## Guarantees

- the host cannot observe a canonical event that the configured Rust ledger did
  not first synchronize;
- terminal artifact inspection executes no provider, approval, or capability code;
- duplicate run IDs cannot overwrite history;
- terminal artifacts must exactly match the stored event trace;
- corruption and incomplete state remain visible and non-destructive;
- Windows and macOS use the same hashed path and schema semantics. Hosted
  cross-platform validation remains an acceptance gate.

## Non-guarantees

- 6A does not continue an interrupted provider conversation.
- Filesystem synchronization is not a claim of universal power-loss atomicity.
- The ledger detects corruption and inconsistency, not a malicious local
  administrator who can rewrite every file and digest.
- It is not an enterprise retention, encryption, signing, or access-control layer.
- It does not supersede ChangeSet transaction recovery.
- File and directory synchronization semantics differ by operating system. 6A
  claims tested process-crash ordering, not universal power-loss durability;
  directory synchronization is used on Unix while Windows relies on synced files
  plus same-volume rename for this gate.

## Rejected alternatives

- **TypeScript event store after bridge receipt.** It creates a persistence gap and
  lets hosts disagree about which events became authoritative.
- **Only save the final artifact.** Interrupted runs remain invisible and terminal
  publication can be lost.
- **Call every incomplete run resumable.** Provider and capability outcomes may be
  unknown; restarting can duplicate cost or side effects.
- **Store run IDs as filenames.** Colons and other characters are not portable and
  permit unsafe path handling.
- **Adopt SQLite as the write authority now.** Packaging/migration complexity is
  unnecessary for the append source log; SQLite remains a later projection.
- **Reuse ChangeSet journals for outer runs.** The subjects and recovery state
  machines differ, and coupling them would create misleading transaction claims.

## Acceptance gates

- Rust unit tests cover create, append, seal, duplicate identity, inspection,
  truncation, sequence mismatch, artifact mismatch, bounds, and corruption;
- bridge tests prove append-before-notify and seal-before-result ordering;
- TypeScript validates the new protocol and never falls back to an unpersisted
  product run;
- CLI terminal inspection returns the same artifact without executing adapters;
- cross-platform hosted Node and Rust/hybrid matrices pass;
- controlled VS Code retains the existing seven-tool, one-call read-only behavior.

## Local implementation evidence

[Checkpoint 73](../checkpoints/2026-08-05-73-durable-run-ledger-local-gate.md)
records the exact local gate: nine Rust run-store regressions, live
append-before-notify and seal-before-result child-process tests, 91/91 Node tests,
the full zero-warning Rust workspace gate, and 56/56 retained-kernel hybrid tests.
The hosted Windows/macOS/Ubuntu and controlled VS Code gates remain pending.

## Deferred

The 6B continuation transcript, explicit capability replay descriptors, safe
idempotent retry, SQLite projections, retention, encryption/signing, and repair
tooling remain separately gated work.
