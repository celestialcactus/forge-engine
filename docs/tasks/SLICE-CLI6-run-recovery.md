# CLI ship lane 6: outer-run recovery

**Status:** 6A/6B exact-head local/controlled VS Code gates and atomic-initialization local/controlled VS Code gates passed; hosted Windows/macOS/Ubuntu pending.
**Branch:** `feature/cli-safe-continuation` (stacked on `feature/cli-run-recovery`)
**Base:** merged `develop` at `e09826a` (PR #23)

## Objective

Make a Forge run inspectable after host or kernel restart without pretending that
an in-memory provider conversation can already be resumed. Persistence must follow
the canonical Rust event order and must never cause a completed or ambiguous
non-idempotent operation to run again.

## Existing accepted foundation

- Rust owns the only run lifecycle, logical sequence, policy decision, capability
  admission, outcome assessment, and terminal `RunArtifact`.
- The bridge streams each Rust-authored event before returning one matching
  terminal artifact.
- Governed ChangeSet transactions already have their own durable, idempotent Rust
  recovery journals. They remain authoritative for mutation state.
- Provider planner messages, pending provider tool-call IDs, and bridge
  request/response boundaries are currently memory-only.
- `~/.forge` or an explicit `FORGE_ENGINE_ROOT` already supplies the product state
  root, but outer runs are not stored there.

## Gap audit

1. A completed run disappears when CLI output or chat history is lost.
2. A kernel/host crash can leave no durable indication of the last Rust event.
3. Persisting events in TypeScript after receipt leaves a crash window between Rust
   state transition and host append.
4. `RunArtifact` events do not contain enough provider-specific continuation state
   to reconstruct pending tool messages safely.
5. An interrupted capability may have executed even when no result was recorded;
   replay safety must be explicit rather than inferred from a capability name.
6. Existing ChangeSet journals solve mutation recovery, not the outer inference
   run. They must be referenced, not replaced by a second transaction mechanism.

## Increment 6A: durable Rust run ledger and inspection

[ADR-0029](../decisions/ADRs/ADR-0029-append-before-notify-run-ledger.md)
defines a filesystem-backed source log under the engine root. The Rust bridge
creates the request record before running, appends and synchronizes every canonical
event before notifying the host, and atomically seals the matching terminal
artifact before returning `run.result`.

The first recovery surface is inspection, not automatic continuation. It reports
one of:

- `terminal`: the request, event trace, and artifact validate and the artifact can
  be returned idempotently without provider or capability execution;
- `open_or_interrupted`: a valid prefix exists but no terminal artifact is sealed;
- `repair_required`: bounds, schema, identity, sequence, or artifact/event parity
  failed validation.

### 6A exit gate

- [x] run IDs map to cross-platform SHA-256 paths rather than raw filenames;
- [x] duplicate run IDs cannot overwrite or append to an existing record;
- [x] request identity is durable before `run.started`;
- [x] every event is durable before the host observes it;
- [x] terminal artifact publication is atomic and validates against exact events;
- [x] truncated, reordered, oversized, mismatched, and corrupted records report
      `repair_required` without deletion or replay;
- [x] terminal inspection performs zero planner, approval, or capability work;
- [x] incomplete inspection explicitly blocks automatic continuation;
- [x] CLI `forge runs inspect <run-id>` and `doctor` expose the effective store;
- [ ] local, hosted Windows/macOS/Ubuntu, and controlled VS Code gates pass.
      The current local Windows head is green, and controlled VS Code passed at
      `88501dc`; hosted matrices and an optional exact-audit-head UI repeat remain.

Local evidence is recorded in
[Checkpoint 73](../decisions/checkpoints/2026-08-05-73-durable-run-ledger-local-gate.md):
91/91 Node tests and build, zero-warning Rust clippy, the full Rust workspace,
56/56 retained-kernel hybrid tests, nine adversarial store regressions, and live
append-before-notify/seal-before-result ordering tests pass. The full hybrid gate
caught and drove a correction to partial token-usage validation before checkpoint.

[Checkpoint 74](../decisions/checkpoints/2026-08-05-74-durable-run-ledger-vscode-gate.md)
records the controlled host proof at exact implementation `88501dc`: VS Code
discovered and selected exactly seven Forge tools, one fresh chat made one summary
call in three seconds, and a separate CLI process returned that exact run as a
validated seven-event terminal artifact without executing work.

[Checkpoint 75](../decisions/checkpoints/2026-08-05-75-run-recovery-validation-audit.md)
maps every 6A acceptance claim to executable evidence, adds the missing crash,
concurrency, tamper, and literal reorder regressions, and records the exact local
result: 91/91 Node tests, the full Rust workspace, and 56/56 hybrid product tests
pass. It accepts 6A locally while retaining the hosted cross-platform gate.

## Increment 6B: safe continuation transcript

[ADR-0030](../decisions/ADRs/ADR-0030-durable-interaction-transcript-and-safe-continuation.md)
defines the implemented continuation path through the existing `Slice0Runtime`.
Rust persists host-interaction intents before send and validated completions before
use. Resume replays those completions through the same runtime, verifies the
reproduced event prefix exactly, and appends only beyond the crash frontier. There
is no recovery runtime or child logical run.

### 6B-1: transcript and classification

- bridge capability descriptors declare `read_only_retryable` or
  `non_idempotent`; absence fails closed as non-idempotent;
- a bounded continuation manifest and interaction log bind planner, approval, and
  capability intent/completion frames;
- the provider planner exports and validates a restorable message/tool-call
  checkpoint shared by Ollama and OpenAI transports;
- run inspection validates the transcript and classifies safe, retryable,
  ambiguous, non-idempotent, unavailable-checkpoint, and corrupt frontiers;
- classification is independently inspectable; live resume is exposed only through
  the validated 6B-2 path.

### 6B-2: deterministic replay and live continuation

- an OS file lock serializes execution/resume and releases on process death;
- the original request re-enters the same runtime with recorded completions;
- reproduced events must exactly equal the durable prefix and are not appended
  twice;
- only a new safe frontier may call a live integration; an unresolved read-only
  capability requires deliberate retry permission;
- CLI resume and restart fixtures prove no duplicated cloud request, approval,
  mutation, promotion, Git operation, or process.

### 6B exit gate

- [x] completed provider, approval, and capability responses are consumed without
      another host call;
- [x] an unresolved explicitly retryable evidence call may be deliberately retried
      once total, and an interrupted retry becomes permanently blocked;
- [x] unresolved non-idempotent work is surfaced and never replayed;
- [ ] retained ChangeSet transaction identity is not yet cross-linked from the
      outer interaction record; the outer capability blocks safely and the
      existing Rust ChangeSet journal remains authoritative;
- [x] provider continuation state reconstructs exact tool-call correlation;
- [x] local child-crash fixtures prove no duplicated inference, approval, or
      capability work and zero invocation of an unresolved non-idempotent adapter;
- [x] initial run state is privately staged and atomically directory-published;
      lock acquisition creates no authoritative run, abandoned staging is invisible,
      and a clean retry is allowed;
- [x] controlled VS Code exact-head gate passes after restarting the MCP server on
      the bridge v9 build;
- [ ] hosted Windows/macOS/Ubuntu exact-head gates pass.

Local exact-head evidence is recorded in
[Checkpoint 76](../decisions/checkpoints/2026-08-05-76-safe-run-continuation-local-gate.md):
zero-warning Rust formatting and clippy, the full Rust workspace, 92/92 Node tests
and build, 59 retained-kernel hybrid scenarios, packaged CLI smoke, direct replay
unit proof, adversarial crash/tamper/retry fixtures, and the controlled one-call VS
Code gate pass. Atomic initialization hardening is recorded separately in
[Checkpoint 77](../decisions/checkpoints/2026-08-05-77-atomic-run-initialization-local-gate.md):
26 focused run-store tests and the full Rust/Node/hybrid gate pass, including
Windows-compatible close-before-rename behavior and orphaned-staging retry proof.

## Whole-lane exit

- canonical events/artifacts survive process restart;
- valid terminal runs replay deterministically without executing work;
- resumable continuation uses a durable interaction transcript;
- unsafe or corrupt states fail closed with actionable repair evidence;
- CLI, embedded, and later MCP/session surfaces reuse the same store contract;
- SQLite and graph views remain derived projections, not competing authorities.

## Honest non-goals

- power-loss-safe filesystem transaction claims beyond the explicitly tested
  file/directory synchronization boundary;
- cross-device or cloud synchronization;
- SQLite query projections, full-text search, or graph storage in 6A;
- automatic retry of ambiguous provider calls or mutations;
- conversation branching, compression, memory, or skills;
- replacing ChangeSet transaction journals.
