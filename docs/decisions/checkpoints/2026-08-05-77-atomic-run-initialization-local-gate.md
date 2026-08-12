# Checkpoint 77: atomic run initialization local gate

**Date:** 2026-08-05
**Branch:** `feature/cli-safe-continuation`
**Decision:** accept the local atomic-initialization hardening and controlled VS Code gates; retain hosted acceptance

## Objective

Close the earliest process-crash window in the Rust run store. Lock acquisition and
sequential creation of final-path files could previously leave a directory that
looked like a run before `request.json`, continuation state, and event storage were
all initialized.

## Implemented boundary

- Per-run OS lock files now live under the non-authoritative `.locks` namespace;
  acquiring a lock does not create the hashed authoritative run directory.
- Rust creates `request.json`, `continuation.json`, `interactions.jsonl`, and
  `events.jsonl` in a private, short-token staging directory.
- Every initial file and the staging directory are synchronized before publication.
- Append handles are closed before rename so Windows does not have to rename a
  directory containing Forge-owned open files.
- One directory rename publishes the complete initial record. Append handles are
  reopened only from the final authoritative path.
- A graceful pre-publication error removes staging. A process-crash-style abandoned
  staging directory remains private, is not inspectable as a run, and does not block
  a clean retry with the same run ID.
- Concurrent creators still permit exactly one authoritative record.

No bridge version, TypeScript contract, event schema, or `RunArtifact` changed.

## Validation

- Focused `forge-core` run-store suite: **26 passed, 0 failed**.
- Focused TypeScript/Rust recovery bridge suite: **5 passed, 0 failed**.
- Full `npm run check:hybrid`: **passed in 132.7 seconds**:
  - Rust formatting and clippy with warnings denied;
  - full Rust workspace, including `forge-core` **69 passed / 5 helper tests ignored**
    and `forge-kernel` **8 passed**;
  - TypeScript typecheck, **92/92 Node tests**, and production build;
  - hybrid suite **59 total: 53 passed, 6 explicitly skipped** because those
    scenarios require the separately supplied `FORGE_KERNEL_BINARY` fixture.
- Controlled VS Code after restarting the workspace MCP server: **passed in 5
  seconds** with exactly one `Forge Workspace Summary` call, run
  `run:6b19387d-cd41-408a-89fb-e6f5c742a103`, snapshot
  `workspace:bc577f765c323788`, 359 files, requested truncation, verified outcome,
  completed run status, and the seven canonical ordered events. No built-in tool or
  repository mutation was used.
- The first full-gate attempt did not reach validation because the npm child shell
  could not find `cargo`. Rerunning with the pinned gnullvm toolchain and linker on
  `PATH` passed; this was an environment setup issue, not a repeated product failure.

## Complications found and corrected

The first draft held `interactions.jsonl` and `events.jsonl` open while renaming the
staging directory. That was unsafe for Windows. The implementation now closes both
handles before publication and reopens them afterward. The initial staging name was
also shortened to avoid adding unnecessary Windows path-length pressure.

## Honest limits

1. Hosted Windows/macOS/Ubuntu has not run against this exact head.
2. This gate covers process-crash visibility and the explicit file-sync/rename
   boundary. It does not claim arbitrary power-loss durability. In particular,
   directory fsync is not exposed by this implementation on Windows.
3. Abandoned private staging is harmless to run authority and retry, but automatic
   age-bounded cleanup and `doctor` reporting are not implemented yet.
4. A failure reopening append handles after successful publication reports an
   error, but leaves a complete inspectable record that can be resumed; it does not
   roll the authoritative directory back.
5. The outer interaction record still does not explicitly cross-link an interrupted
   non-idempotent capability to its in-progress ChangeSet transaction. Replay blocks
   safely and the ChangeSet journal remains authoritative.

## Next gate

Run the exact head on hosted Windows/macOS/Ubuntu, decide the proper progress-channel
contract for outer-run-to-ChangeSet linkage, add bounded orphan-staging diagnostics,
and then continue release packaging and the developer alpha test kit.
