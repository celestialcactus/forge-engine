# Checkpoint 24: candidate completion loop local gate

**Date:** 2026-07-23
**Status:** local gate accepted; hosted matrices pending
**Branch:** `feature/slice-2d-candidate-promotion`

## Decision checkpoint

Forge now has a bounded completion loop for a previously verified candidate. Rust
reloads the durable candidate lease, reconciles any pending promotion journal,
validates the candidate and active repository again, resolves fresh approval facts
bound to the complete candidate subject, and alone decides inspection, promotion,
discard, recovery, and lifecycle status.

The private protocol is `forge.kernel.candidate.v1`. TypeScript transports the
request and exact Rust artifact. It does not recompute candidate validity or status.
The experimental local surface is deliberately high-level:

- `forge candidate inspect <id> --candidate-parent <path>`;
- `forge candidate accept <id> --candidate-parent <path> --approve`;
- `forge candidate discard <id> --candidate-parent <path> --approve`.

Accept and discard refuse to run without explicit CLI consent. The CLI first obtains
a fresh Rust inspection subject, then binds a unique call and approval facts to that
exact candidate/repository/base/proposal/snapshot/change-set/diff identity. A later
Rust reload and recheck closes the inspection-to-mutation race at the authority
boundary.

## Cross-platform promotion mechanism

The first implementation used a validated `git apply`. Windows tests exposed a real
line-ending defect: Git can preserve the logical patch while changing verified LF
bytes to CRLF. That breaks after-digest evidence and can make rollback reproduce
different bytes.

The accepted local design therefore separates two jobs:

1. Git `apply --check` proves the exact retained binary diff is applicable to the
   clean approved base.
2. Forge creates synced pre-change recovery copies outside the governed repository,
   publishes a durable journal, and atomically replaces each approved existing file
   with the exact verified candidate bytes.
3. Rust verifies every resulting path digest, the exact changed-path inventory, and
   the final Git diff digest before appending the immutable promoted transition.
4. Any terminal failure restores exact pre-promotion bytes. A process interruption
   leaves the journal and backups for reconciliation on the next lifecycle call.

Unix uses same-filesystem rename replacement. Windows uses `ReplaceFileW` with
owned NUL-terminated UTF-16 paths. Replacement files preserve the target permission
bits. The bounded V1 set remains existing regular UTF-8 files only: no create,
delete, rename, symlink, or arbitrary shell/write primitive was added.

## Adversarial evidence

Rust tests cover:

- approval denial and subject replay without active mutation;
- stale/dirty active state;
- candidate content tampering, an extra unapproved path, and a missing approved path;
- exact two-file promotion and idempotent repeated accept;
- fresh-approved restart-safe discard while leaving the promoted active diff visible;
- injected failure after the first of two atomic path replacements, with both paths
  restored to their exact before bytes;
- injected terminal failure after all replacements;
- restart reconciliation after an interrupted apply;
- refusal to overwrite divergent developer content, with recovery state retained.

The complete local `npm run check:hybrid` gate passes:

- Rust format, warnings-as-errors Clippy, 54 active tests, and debug build;
- 37 TypeScript tests, typecheck, and production build;
- 27 hybrid/MCP checks, including direct TypeScript transport and real CLI
  inspect/refusal/accept/discard flows;
- the official MCP client still discovers exactly seven read-only tools.

## Honest remaining boundary

- This is process-crash recovery, not a filesystem or power-loss transaction. File
  and journal contents are synced, and Unix directories are synced; Windows does not
  currently prove directory-metadata durability across sudden power loss.
- The repository lock is advisory among Forge lifecycle calls. External editors and
  Git processes do not honor it. Rust rechecks before every replacement and refuses
  recovery over unrecognized bytes, but no user-space design can make concurrent
  third-party writes impossible without stronger OS/filesystem integration.
- Killing the TypeScript adapter during a lifecycle call terminates the Rust child;
  the next lifecycle call reconciles durable state. Mid-operation cancellation does
  not yet return a graceful Rust terminal artifact.
- The Rust kernel still inherits host environment and OS permissions. Verification
  children have minimized environments, but no Forge-enforced sandbox or privilege
  reduction exists.
- `host_managed` remains an unauthenticated allowlisted assertion and `restricted`
  still fails closed.
- Candidate CLI commands require an explicit kernel binary and candidate-parent
  location. There is not yet a public propose/apply transaction CLI workflow.
- No MCP mutation, generic shell, generic file write, public write capability,
  authenticated host handshake, or enterprise policy distribution was added.

## Hosted gate

Push this exact implementation, then require the existing Windows/macOS TypeScript
matrix and Windows/macOS/Ubuntu hybrid matrix to pass before Slice 2D is accepted.