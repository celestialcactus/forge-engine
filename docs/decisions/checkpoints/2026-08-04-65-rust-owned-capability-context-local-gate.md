# Checkpoint 65 - Rust-owned capability context local gate

**Date:** 2026-08-04
**Branch:** `feature/cli-rust-lifecycle-continuation`
**Base:** merged `develop` at `1f0d792` (PR #19)
**Status:** increment 4B-3a local gate green; hosted Rust acceptance pending

## Result

The canonical run contract now has the information required to authorize and
execute a governed edit before the run terminates:

- RunArtifact advances from schema 2 to schema 3.
- The private child-process bridge advances from v4 to v5.
- Rust constructs a versioned capability context from the ordered prior
  capability calls and results.
- Rust records a compact basis containing run, snapshot, context-plan, ordered
  prior-call IDs, and a SHA-256 digest over lexicographically key-sorted canonical
  JSON observations.
- The identical logical context crosses the approval and capability-invocation
  boundaries.
- Capability results may retain a bounded typed evidence envelope. The existing
  change-plan capability now emits `forge.workspace.change.plan.v1` evidence, and
  lifecycle extraction no longer parses authoritative plan truth from text.
- Duplicate call IDs and invalid or oversized structured evidence fail closed.
- MCP remains exactly seven read-only tools.

The TypeScript runtime still mirrors these rules only as a differential oracle.
Rust remains the product artifact and event authority.

## Local validation

- `npm run check`: passed.
- TypeScript typecheck: passed.
- TypeScript tests: 78/78 passed.
- Production TypeScript build: passed.
- Rust formatting: passed with the pinned 1.97.1 gnullvm toolchain.
- Focused context/evidence tests prove ordered prior evidence, current-call
  exclusion, digest calculation, policy/invocation equality, typed plan evidence,
  invalid schema rejection, duplicate-call rejection, and the Rust 4 MiB bound.

## Local Rust limitation

This machine currently has Rust toolchains but neither the Visual C++ linker nor
the earlier LLVM-MinGW linker executable. Local `cargo check` therefore stops
before compiling Forge source. This is a workstation toolchain limitation, not a
passing Rust result. Increment 4B-3a is not accepted until the hosted
Windows/macOS/Ubuntu matrix compiles, lints, and tests the exact commit.

## Other observed debt

A clean `npm ci` reports three moderate and two high dependency advisories from
the current lockfile. This increment did not change dependencies. The advisories
need a bounded dependency review before release hardening; they do not justify an
unreviewed `npm audit fix --force` during a runtime-contract change.

## Next gate

After exact-head hosted Rust conformance passes, increment 4B-3b will replace the
post-`run.completed` CLI handoff with a CLI-only governed change capability. It
must reuse ChangeSet v2, retain exact consent and transaction evidence in the v3
RunArtifact, and leave MCP mutation disabled.
