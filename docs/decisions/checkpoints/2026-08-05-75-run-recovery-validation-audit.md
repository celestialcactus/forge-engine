# Checkpoint 75: run-recovery validation sufficiency audit

**Date:** 2026-08-05
**Branch:** `feature/cli-run-recovery`
**Base:** implementation `88501dc`, host checkpoint `48b8d3c`
**Scope:** CLI ship-lane increment 6A validation hardening; 6B remains excluded

## Verdict

The current automated envelope is sufficient to accept increment 6A locally. It
proves the intended outer-run persistence and inspection contract through Rust
unit tests, live child-process bridge tests, the complete retained-kernel product
suite, and existing CLI/MCP checks. It is not sufficient to claim current-head
cross-platform acceptance until the hosted Windows/macOS/Ubuntu matrices run.
It also does not prove the separately scoped 6B continuation behavior.

## Claim-to-test map

| 6A claim | Executable evidence | Result |
|---|---|---|
| Run IDs use safe cross-platform storage paths | `hashes_run_ids_into_cross_platform_directory_components` | Passed |
| The request exists before the first event and an immediate crash is blocked | `blocks_a_request_only_crash_window_before_the_first_event` | Passed |
| An existing run ID cannot execute again | sequential duplicate unit test, simultaneous two-creator unit test, and exact duplicate `run.start` child-process replay | Passed; the bridge returned exit 3 with no planner, event, or result frame |
| Events are durable before host notification | live child-process inspection immediately after event 1 | Passed |
| A terminal artifact is published before `run.result` | live result-time inspection plus the unpublished `artifact.json.tmp` crash-window fixture | Passed |
| Incomplete state never replays | request-only, one-event interruption, and temporary-artifact fixtures | Passed as `open_or_interrupted` / `blocked_incomplete` |
| Corrupt state fails closed | request digest tamper, partial frame, literal reordered frames, sequence gap, artifact/event mismatch, and sparse oversized ledger | Passed as `repair_required` |
| Terminal state can return without execution | terminal inspection unit test, CLI recovery smoke in Checkpoint 74, and duplicate-start rejection before planner work | Passed |
| Rust and TypeScript retain one runtime meaning | all 18 retained-kernel parity scenarios plus the full hybrid suite | Passed |
| CLI/MCP integrations still use the rebuilt kernel | full hybrid product suite, including official MCP client and product CLI discovery | Passed |

## Hardening driven by the audit

- A bounded read now uses `take(maximum + 1)` and checks the observed byte count
  after the read. A file that grows after its initial metadata check cannot cause
  an unbounded allocation/read.
- An event and its newline are assembled into one frame buffer before `write_all`
  and synchronization, narrowing the live partial-frame window while retaining
  explicit repair classification for interrupted frames.
- Four missing crash/adversarial cases were added: request-only interruption,
  temporary-but-unpublished artifact, request-content tampering, and concurrent
  duplicate creation. A literal reordered-frame regression was added separately.
- The bridge regression now proves that replaying the same terminal `run.start`
  cannot reach planner work or emit another result.

## Validation results

- `npm run check`: passed; typecheck, 91/91 Node tests, production build.
- Rust format and zero-warning Clippy: passed.
- Full Rust workspace: passed. The core library ran 61 tests: 56 passed and five
  helper tests remained intentionally ignored; all Rust integration suites passed.
- Focused run-store suite: 14/14 passed.
- Focused live run-store bridge suite: 2/2 passed.
- Full hybrid product suite with the exact rebuilt kernel pinned through
  `FORGE_KERNEL_BINARY`: 56/56 passed, zero skipped.
- The previously flaky Windows nested-process cancellation regression was changed
  from a fixed 500 ms startup guess to explicit bounded marker readiness. The
  corrected regression passed three consecutive stress repetitions and the final
  full workspace run.
- `git diff --check`: passed before checkpoint documentation.

## What this does not prove

- Hosted Windows/macOS Node and Windows/macOS/Ubuntu hybrid jobs have not run on
  this branch because it is not published and the saved GitHub CLI credential is
  invalid. macOS behavior therefore remains a hosted gate, not a local claim.
- Checkpoint 74 proves the controlled VS Code path at implementation `88501dc`.
  This audit changes no MCP or CLI presentation contract, but the exact audit head
  has not repeated that UI exercise.
- The digest detects accidental or one-sided request tampering; the store is not a
  cryptographically signed audit log. A privileged actor that rewrites every
  coordinated record is outside this increment.
- The tests simulate precise on-disk crash windows and perform a live kernel kill,
  but do not provide filesystem-wide fault injection for every syscall or a
  universal power-loss guarantee.
- 6B is not implemented: Forge still blocks interrupted provider conversations,
  unresolved tool calls, and ambiguous non-idempotent work instead of resuming.

## Release recommendation

Treat 6A as locally accepted and the test suite as adequate for this iteration.
Do not merge it as cross-platform accepted until the branch is published and both
hosted matrices pass. Before release hardening, add systematic filesystem fault
injection and parser/property tests; they are valuable next-level defenses, not a
reason to block this bounded alpha increment.