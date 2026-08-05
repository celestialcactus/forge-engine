# CLI ship lane 6: outer-run recovery

**Status:** 6A local and controlled VS Code gates passed; hosted pending; 6B not started
**Branch:** `feature/cli-run-recovery`
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
      Local Windows and controlled VS Code are green; hosted remains pending.

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

## Increment 6B: safe continuation transcript

Persist the Rust/host interaction boundary required to reconstruct continuation:
planner requests and validated turns, approval requests and facts, capability
invoke intent and results, and provider planner message/tool-call state. Each
capability descriptor carries explicit replay safety; absence means
non-idempotent. Resume consumes already completed responses, reissues only a
proven-idempotent unresolved action, and blocks all ambiguous non-idempotent work.

### 6B exit gate

- completed provider and capability responses are consumed without another call;
- an unresolved idempotent evidence call may be deliberately retried once;
- an unresolved or completed non-idempotent action is surfaced and never replayed;
- a retained ChangeSet transaction is linked and inspected through its existing
  Rust transaction authority;
- provider continuation state reconstructs exact tool-call correlation;
- restart fixtures prove no duplicated cloud inference, prompt, mutation,
  promotion, Git operation, or external process.

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
