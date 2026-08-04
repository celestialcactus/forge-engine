# Checkpoint 66 - governed edit inside the Rust lifecycle accepted

**Date:** 2026-08-04
**Branch:** `feature/cli-rust-lifecycle-continuation`
**Base:** merged `develop` at `1f0d792` (PR #19)
**Exact implementation:** `1cc1e3f`
**Status:** increment 4B-3 accepted; standalone governed edit lifecycle green on hosted Windows/macOS/Ubuntu, live Qwen, and controlled VS Code

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

### Local contract and behavior

- `npm run check`: typecheck, 79/79 tests, and production build passed.
- Focused governed lifecycle tests: 8/8 passed.
- Rust formatting with pinned 1.97.1 passed.
- `git diff --check` passed.
- The real-kernel hybrid regression proves the change result occurs before
  `run.completed`, the context basis contains the prior complete-file read and
  excludes the current call, accepted evidence reports `workspacePromoted=true`,
  and the seven-tool MCP surface remains unchanged.

### Exact-head hosted cross-platform gate

Exact implementation `1cc1e3f` passed:

- Node Windows/macOS Actions run `30955324195`;
- real Rust-kernel/TypeScript Windows/macOS/Ubuntu Actions run `30955324364`;
- Rust format, strict clippy, Rust tests/build, TypeScript behavior, hybrid
  contract, product smoke, optimized builds, and process-bridge latency gates.

The exact Windows release artifact was then downloaded and passed `doctor` against
bridge v5 and ChangeSet v3 on the local product surface.

### Live Qwen transaction gate

In a disposable exact-commit clone, `qwen2.5-coder:7b` completed one governed edit
through the product CLI in 30.5 seconds:

- run `run:8970f5df-f972-4336-954d-ecd99033718a`;
- ChangeSet `changeset:sha256:08b910aafd484941e41d5eb7fb3435826a9919ce22dbe20c23295fc16cc70838`;
- transaction `transaction:sha256:d8651d54f9a10072ad2878d1e8a2cb4704157eaf0d40283767ae33c937aed313`;
- the source file was unchanged when both approval prompts were shown;
- verification succeeded, the process exited zero, and the source changed only
  after Rust reported `promoted`.

This was a functional transaction pass, not a perfect low-model orchestration
score. Qwen first emitted one malformed read call, received the bounded failure,
corrected it with one valid read, and then completed the single governed change.
The run therefore recorded two successful capability results and one failed result
across four inference turns.

### Controlled VS Code apprentice gate

The trusted exact branch was opened in VS Code with the exact hosted Windows kernel
placed in the ignored `target/release` discovery path because this workstation
cannot link Rust locally. The MCP server reached `Running` and discovered exactly
seven tools. A fresh Copilot Agent chat selected only those seven Forge tools and
completed in roughly five seconds with exactly one `Forge Workspace Summary` call:

- run `run:4dfa82e1-274c-4610-b56b-0f1875cddb7a`;
- snapshot `workspace:38f73002300f9dc6`;
- 333 files, truncated `true` at the requested 20-file bound;
- `outcome.status=verified`, `runStatus=completed`;
- ordered events: `run.started`, `context.planned`, `capability.requested`,
  `approval.decided`, `capability.completed`, `outcome.assessed`, `run.completed`.

No built-in tool, mutation tool, retry, or recovery call was used.

## Honest remaining limits

- This workstation still cannot link a new Rust binary because no compatible
  Windows linker is installed. Hosted CI remains the native compile/test authority.
- The live Qwen gate exposed one correctable malformed read. The transaction core
  passed; low-compute tool-call efficiency is not claimed perfect.
- Decline and the candidate verification/accept/discard state machine are covered
  by automated tests, but cancellation while waiting for interactive input still
  needs a dedicated live CLI gate in the approval-and-control lane.
- Trusted verification is not an OS sandbox. This increment reuses the accepted
  candidate/worktree boundary and does not strengthen containment.
- Crash-resumable inference and replay remain the later Recovery-state lane.

## Decision and next increment

Increment 4B-3 is accepted. The standalone CLI no longer mutates after the
authoritative run has already ended, and the exact implementation has passed every
required cross-platform, live-provider, transaction-timing, and read-only-host
gate. The next ship-lane increment is approval and control: deterministic live
cancellation, timeouts, iteration/tool budgets, and clear allow/ask/deny UX over
this same lifecycle. High-level MCP mutation remains deferred and must reuse these
contracts rather than introduce raw write or shell powers.
