# Checkpoint 66 - governed edit inside the Rust lifecycle local gate

**Date:** 2026-08-04
**Branch:** `feature/cli-rust-lifecycle-continuation`
**Base:** merged `develop` at `1f0d792` (PR #19)
**Status:** increment 4B-3a hosted-accepted; 4B-3b local gate green; exact-head hosted and live-product gates pending

## Result

The plan-only/post-terminal edit seam is removed from the interactive product
path. A policy-enabled CLI task now registers one CLI-only
`workspace.change.execute` capability inside the still-open canonical Rust run.
The model must first read every complete target, then submit the complete desired
UTF-8 content once. Forge performs these steps before `run.completed`:

1. Rust constructs and records the approval basis from ordered prior observations.
2. The TypeScript capability uses that immutable context to prove complete target
   coverage at the same snapshot and SHA-256 base.
3. The existing plan adapter produces the bounded digest/diff review.
4. The existing Rust ChangeSet v2 machinery prepares the exact operation.
5. The developer visibly approves or declines candidate execution.
6. The configured trusted verifier runs against the isolated candidate.
7. A second visible choice accepts, discards, or retains the verified transaction.
8. The capability returns bounded typed evidence, the provider continues, Rust
   assesses the outcome, and only then emits `run.completed`.

No second mutation engine or TypeScript terminal aggregate was added. The
authoritative RunArtifact retains the original call input; typed execution evidence
retains the review paths/digests/diff, context basis, verification, approval,
transaction, and promotion status without duplicating replacement bodies.

## Contract hardening

Prior capability observations were already turn-bounded and digest-bound, but not
byte-bounded. Rust and the TypeScript differential runtime now reject a serialized
prior-observation context above 4 MiB before policy or adapter work. This stays
below the 8 MiB host output-frame ceiling and prevents a long evidence wave from
creating an unbounded kernel-to-host request.

## Surface boundary

- Interactive CLI with an explicit verification policy: seven evidence tools plus
  the CLI-only governed change capability.
- One-shot CLI without that policy: seven read-only evidence tools.
- MCP/VS Code: still exactly seven read-only tools; no mutation tool was exposed.
- The outer capability approval permits entry into the registered guarded flow; it
  does not claim developer consent. Exact candidate execution and promotion remain
  separately bound to visible developer decisions in Rust ChangeSet artifacts.

## Validation

### Accepted 4B-3a contract checkpoint

Exact implementation `4ac3346` passed:

- Node Windows/macOS cross-platform run `30938191923`;
- real Rust-kernel/TypeScript Windows/macOS/Ubuntu run `30938194060`;
- Rust format, strict clippy, Rust tests/build, TypeScript behavior, hybrid parity,
  product smoke, optimized builds, and process-bridge latency gates.

### Current 4B-3b local checkpoint

- `npm run check`: passed.
- TypeScript tests: 79/79 passed.
- TypeScript typecheck and production build: passed.
- focused governed lifecycle tests: 8/8 passed.
- Rust formatting with pinned 1.97.1: passed.
- `git diff --check`: passed.
- Added a real-kernel hybrid regression for Windows/macOS/Ubuntu; it is not called
  passed until the hosted matrix runs the exact head.

The local governed test proves the change result occurs before `run.completed`,
the context basis contains the prior complete-file read and excludes the current
call, accepted evidence reports `workspacePromoted=true`, and the seven-tool MCP
surface remains unchanged.

## Honest remaining gates

- The current source cannot be linked on this workstation because no compatible
  Windows linker is installed. Hosted CI remains the native compile/test authority.
- The current test uses deterministic provider and ChangeSet adapters for lifecycle
  composition. Exact Rust-kernel hybrid, real Qwen, and real CLI transaction tests
  are still required on the exact implementation.
- Decline and the existing candidate verification/accept/discard state machine are
  covered locally, but cancellation while waiting for interactive input needs a
  live CLI gate rather than a fixture claim.
- Trusted verification is not an OS sandbox. This increment reuses the accepted
  candidate/worktree boundary and does not strengthen containment.
- Crash-resumable inference and replay remain the later Recovery-state lane.

## Next gate

Push the exact implementation, require the Node Windows/macOS and real hybrid
Windows/macOS/Ubuntu matrices, then run a disposable Qwen edit through the product
CLI. The source workspace must change only after Rust reports promotion. Finally,
repeat the controlled VS Code seven-read-only-tool tether before accepting 4B-3.
