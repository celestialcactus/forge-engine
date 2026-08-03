# Checkpoint 57: Host-authority replay race

**Date:** 2026-08-03
**Branch:** feature/cli-live-loop
**State:** implementation and integration fixtures corrected; fourth hosted cross-platform rerun pending

## Failure observed

A documentation-only PR-head rerun first failed the macOS hybrid job in
`host_authority::tests::concurrent_consumers_allow_exactly_one_success`. Exactly one
consumer succeeded, but the loser sometimes returned a pending-file read error. A
first defensive recheck plus a 32-iteration regression then exposed the deeper race
on both Ubuntu and macOS: the consumed filename was visible while its JSON still had
zero length. Atomic publication passed those platforms, then Windows exposed that
public IDs containing `:` had historically been interpreted as NTFS alternate data
streams instead of ordinary private ledger filenames.

## Root cause

The ledger used `create_new` directly at the final record path and then wrote the
JSON. This prevented two writers, but it did not prevent readers from observing the
empty or partially written destination. The earlier pending-file race and the later
partial-consumed-record race were two outcomes of the same non-atomic publication
boundary. The filesystem path layer also copied the public `host-challenge:<digest>`
identity directly into a filename; `:` is not a portable filename character.

## Bounded correction

- Serialize and synchronize each ledger record in a same-filesystem private staging
  file.
- Atomically publish the complete immutable file with a no-overwrite hard link, then
  remove the staging name. A competing publisher still receives `AlreadyExists`.
- Preserve the public challenge ID while encoding `:` as `%3A` only in private
  record filenames. The mapping is collision-free because `%` is forbidden in IDs.
- Before classifying a missing or unreadable pending record, recheck and fully
  validate the consumed signature, transcript, identity, controls, and timing.
- Preserve fail-closed errors when evidence is missing, corrupt, or disappears.
- Race two consumers 32 times and require exactly one success plus exactly one
  exact replay rejection per iteration.

No provider, CLI, policy, event, or artifact contract changed.

## Validation

- `cargo fmt --all -- --check` passed.
- Local Rust compilation remains unavailable because this Windows machine lacks
  MSVC `link.exe`; this is the already recorded machine prerequisite, not a new
  compiler failure.
- `npm run check` passed typecheck, 57/57 tests, and production build.
- Hosted run `30860312796` proved that the defensive recheck alone was insufficient:
  Ubuntu and macOS both observed a zero-length in-progress consumed record. That
  evidence drove the atomic-publication correction above.
- Hosted run `30860656367` passed the atomic-publication regression on macOS and
  Ubuntu. Windows rejected hard-link publication to the colon-bearing destination
  with OS error 123, revealing the alternate-data-stream path defect.
- Hosted run `30861034738` passed every core host-authority test, including all 32
  races, on macOS and Ubuntu. Two integration fixtures still hardcoded the retired
  private filename; they now discover and tamper with the single consumed record
  through the ledger directory instead of duplicating storage encoding.
- The corrected real Rust regression and full product matrix must pass on hosted
  Windows, macOS, and Ubuntu before this correction is accepted.
