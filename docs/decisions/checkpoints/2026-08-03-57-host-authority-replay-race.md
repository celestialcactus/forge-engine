# Checkpoint 57: Host-authority replay race

**Date:** 2026-08-03
**Branch:** feature/cli-live-loop
**State:** bounded correction implemented; hosted cross-platform rerun pending

## Failure observed

A documentation-only PR-head rerun failed the macOS hybrid job in
`host_authority::tests::concurrent_consumers_allow_exactly_one_success`. The same
code parent had passed minutes earlier. Exactly one concurrent consumer succeeded,
but the losing consumer sometimes returned a pending-file read error instead of the
contractual replay rejection.

## Root cause

The ledger checked that the pending challenge existed and then read it. A winning
consumer could atomically create the consumed record and remove the pending record
between those operations. The losing consumer therefore observed the correct
single-consumer outcome but reported it through an unstable filesystem error.

## Bounded correction

- Before classifying a missing or unreadable pending record, recheck the consumed
  record.
- Validate the persisted signature, transcript, identity, controls, and timing
  before returning `Host challenge replay was rejected.`
- Preserve fail-closed errors when consumed evidence is missing, corrupt, or
  disappears during validation.
- Race two consumers 32 times and require exactly one success plus exactly one
  exact replay rejection per iteration.

No provider, CLI, policy, event, or artifact contract changed.

## Validation

- `cargo fmt --all -- --check` passed.
- Local Rust compilation remains unavailable because this Windows machine lacks
  MSVC `link.exe`; this is the already recorded machine prerequisite, not a new
  compiler failure.
- `npm run check` passed typecheck, 57/57 tests, and production build.
- The real Rust regression and full product matrix must pass on hosted Windows,
  macOS, and Ubuntu before this correction is accepted.
