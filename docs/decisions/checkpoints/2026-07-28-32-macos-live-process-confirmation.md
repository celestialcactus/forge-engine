# Checkpoint 32: macOS live-process confirmation correction

**Date:** 2026-07-28
**Status:** Accepted
**Exact implementation:** `ff4aedf`
**Branch:** `feature/slice-2e-process-ownership`
**Base:** protected `develop` at `c14edf5e1c668c4c69a5dc02cb17246493087f86`
**Decision:** ADR-0010

## Trigger

The first hosted Slice 2E run found an unconditional Windows-only `Stdio` test
import on macOS and Ubuntu. After that import was platform-gated, Ubuntu passed the
strict Rust stage, while macOS reached the process tests and exposed a real semantic
difference: both nested-tree tests returned `EPERM` while checking
`kill(-process_group_id, 0)` after `SIGKILL`.

Apple documents that a Darwin group signal returns `EPERM` if any group member
cannot be signalled. A killed descendant may also remain as a zombie until its new
parent collects it. The previous Linux-oriented confirmation treated every result
other than `ESRCH` as uncertainty, so it rejected dead-but-not-yet-collected macOS
processes. Weakening the test or treating all `EPERM` results as success would have
hidden a potentially live, unsignalable process and was rejected.

## Correction

- Group termination remains one checked `SIGKILL`; no cleanup signal is ignored.
- macOS now enumerates the target process group with `proc_listpgrppids` and obtains
  `PROC_PIDT_SHORTBSDINFO` for each returned PID.
- Completion requires every member to have disappeared or carry Darwin's `SZOMB`
  status. Any non-zombie member remains live and is polled until the deadline.
- Partial results, capacity exhaustion, PID-inspection uncertainty, and permission
  ambiguity fail explicitly.
- The process list grows from 64 entries to a hard ceiling of 65,536; reaching that
  ceiling fails rather than truncating evidence.
- Linux and other Unix behavior is unchanged and still requires `ESRCH` for the
  process group.

This is a stronger statement than “the process-group record vanished”: Forge now
proves that no listed macOS member can execute. It does not claim that zombie
records have already been reaped by `launchd`.

## Validation so far

- The complete Windows GNU `npm run check:hybrid` gate passed after the import fix:
  Rust format, warnings-as-errors Clippy, all Rust suites/build, TypeScript typecheck,
  37 tests/build, and 27 hybrid/MCP assertions.
- `cargo check --workspace --all-targets --locked --target aarch64-apple-darwin`
  passed against Rust 1.97.1.
- strict macOS-target Clippy passed with `-D warnings`.
- The second hosted run proved the import correction on Ubuntu before the macOS
  behavior correction was added.
- That macOS run also rejected the first Darwin adapter because it interpreted
  `proc_listpgrppids` as returning bytes. Apple's published wrapper divides the
  kernel byte result by `sizeof(int)` and returns a PID count. Forge now clears
  thread-local `errno`, consumes the count directly, and still grows/fails at the
  documented bound.
- The next macOS run passed direct-exit teardown and most repeated cases, then
  exposed a list/detail race: a listed PID lost `pidinfo` state while a zero-signal
  probe still succeeded. Forge now uses libc's SDK-matched Darwin structures and
  constants, clears errno before the probe, treats an existing unknown member as
  conservatively live, and retries until it disappears, reports `SZOMB`, or reaches
  the explicit teardown deadline.
- Hosted cross-platform conformance run `30389804363` passed the packaged Node/CLI
  gate on Windows and macOS.
- Hosted hybrid kernel conformance run `30389805673` passed strict Rust, the
  adversarial ownership tests, TypeScript preservation, hybrid/MCP behavior,
  optimized builds, and bridge latency on Windows, macOS, and Ubuntu.

The protected hosted matrix is the acceptance evidence for this increment.

## Current delivery forecast

Accepted process ownership closes one P1 machinery gate. The authoritative build
plan now estimates the dependable core at **70%**, the standalone CLI alpha at
**43%**, and the broader V1 platform at **25%**. The planning ranges remain **2-3
weeks** for a curated evidence-backed demo, **3-5 weeks** for the dependable local
change engine, **6-9 weeks** for a shippable standalone CLI alpha, and **12-16
weeks** for an enterprise pilot with real restricted execution and policy
integration. These are ranges, not commitments.

## Unchanged limits

This corrects supervised macOS teardown accounting. It does not add containment,
resource limits, or automatic descendant termination after abrupt Forge supervisor
death on Unix. The watchdog/parent-death gate remains open before Slice 2E closes.

## References

- docs/decisions/ADRs/ADR-0010-deterministic-verifier-process-ownership.md
- https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html
- https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.h
- https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h
- https://github.com/celestialcactus/forge-engine/actions/runs/30389804363
- https://github.com/celestialcactus/forge-engine/actions/runs/30389805673
