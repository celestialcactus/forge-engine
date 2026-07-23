# Checkpoint 22: Slice 2C private transaction bridge local gate

**Date:** 2026-07-23
**Status:** 2C-1 and 2C-2 pass the local Windows gate; hosted Windows/macOS/Linux gate pending
**Branch:** `feature/slice-2c-host-transaction-bridge`

## Decision checkpoint

Forge now has a private TypeScript-to-Rust path for the accepted candidate
transaction. The host sends one bounded `transaction.start` frame over
`forge.kernel.transaction.v1`; Rust remains authoritative for manifest and
approval validation, isolation acceptance, clean-revision preparation, apply,
verification, cancellation interpretation, recovery, retention, terminal status,
and opaque candidate identity.

The existing `forge.kernel.bridge.v2` run protocol remains available. Both
protocols now use bounded newline-delimited input rather than unbounded
`read_line` allocation. The transaction start frame is capped at 24 MiB to contain
the accepted maximum replacement manifest plus envelope overhead. Host reply and
TypeScript terminal-output frames are capped at 8 MiB.

The embedded `RustCandidateTransactionRuntime` owns process lifecycle and
transport only. Trusted verification commands are constructor-time host
configuration represented as an executable plus argument vector, not a shell
string and not per-task model input. TypeScript validates the terminal envelope
and identity but does not recompute policy, success, recovery, or candidate state.

## Failure and authority behavior

- `trusted` verification is the only accepted profile.
- `host_managed` fails before candidate creation because the private protocol has
  no authenticated host handshake.
- `restricted` fails before candidate creation because Forge has no operating-
  system isolation backend.
- malformed starts return a fixed structured error and do not echo replacement
  content;
- a dedicated bounded cancellation reader observes `transaction.cancel` while a
  verifier is running;
- cancellation terminates the verifier process tree through the existing Rust
  machinery, removes the candidate boundary, and returns the authoritative
  cancellation/recovery artifact;
- a successful transaction returns the exact Rust artifact and opaque candidate
  ID while the governed repository remains unchanged.

## Local validation

`npm run check:hybrid` passed on Windows:

- Rust formatting and Clippy with warnings denied;
- 46 active Rust tests, including bounded-frame, authority, redaction,
  cancellation/recovery, candidate lifecycle, transaction, policy, and runtime
  coverage;
- Rust workspace build;
- 37 TypeScript tests and production build;
- 24 hybrid/MCP checks.

The new end-to-end hybrid fixture uses the existing TypeScript change-proposal
capability, sends its complete application manifest through the embedded adapter,
and verifies the change in a Rust-created clean Git worktree. A second fixture
waits until verification is active, aborts from TypeScript, and proves recovery
and original-workspace preservation.

## Honest boundary

- Hosted macOS and Linux conformance is still pending at this checkpoint.
- The private process channel authenticates neither a host nor its claimed
  containment. The adapter deliberately refuses `host_managed`.
- The verification child still inherits Forge's process environment and operating-
  system permissions.
- One Rust child is launched per transaction. A long-lived kernel is deferred
  until measured latency justifies its additional crash and scheduling state.
- There is no promotion flow, candidate CLI, MCP mutation tool, or public write
  capability. The seven MCP tools remain read-only.
- There is no Forge-enforced OS sandbox.

## Next gate

Push this exact local-gate implementation through the hosted Windows, macOS, and
Ubuntu hybrid matrix. If it passes, accept Slice 2C and proceed to the remaining
prototype core loop: environment minimization followed by explicit candidate
promotion/discard and a thin controlled local invocation surface. Do not start
memory, compression, skills, or public mutation work before those mechanics close.