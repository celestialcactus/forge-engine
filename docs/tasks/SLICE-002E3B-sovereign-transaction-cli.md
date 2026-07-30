# Slice 2E-3b: sovereign ChangeSet v2 CLI

- **Status:** Accepted
- **Opened:** 2026-07-30
- **Accepted:** 2026-07-30 at `16c5569`
- **Branch:** `feature/slice-2e3b-sovereign-cli`
- **Base:** protected `develop` at `e0d2213`
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu

## Problem

Forge has two accepted but disconnected pieces:

1. the older `forge.kernel.transaction.v1` and candidate lifecycle protocols expose
   a text-replacement transaction to TypeScript; and
2. the durable ChangeSet v2 coordinator supports the full bounded operation algebra
   and restart recovery, but is only a private Rust API.

Adding more TypeScript orchestration around both would create two mutation
authorities. Slice 2E-3b instead exposes the durable coordinator through one
high-level Rust service and keeps the CLI as transport and presentation.

## Developer flow

The local flow is:

1. `forge change propose <proposal.json>` stages bounded content, derives current
   repository facts, creates and applies an external candidate, runs policy-named
   verification checks, and durably registers only a verified transaction.
2. `forge change inspect <transaction-id>` returns the same durable transaction,
   operation, verification, candidate-retention, and transition evidence.
3. `forge change accept <transaction-id> --approve` publishes through the durable
   coordinator and removes the external candidate before acknowledging promotion.
4. `forge change discard <transaction-id> --approve` removes the candidate without
   mutating the active workspace and records a terminal outcome.

Every command reconciles incomplete coordinator state before acting. Repeating an
inspect, accept, or discard operation must be idempotent.

## Authority and input boundaries

- Rust derives the base revision, workspace generation, before-content digests,
  file modes, ChangeSet identity, candidate identity, transaction identity, and
  terminal state.
- TypeScript reads explicit JSON inputs, sends a bounded protocol frame, handles
  cancellation, and renders the returned Rust artifact.
- Proposal content supports UTF-8 or hexadecimal bytes and is still constrained by
  the accepted per-blob, aggregate, operation-count, path, symlink, and platform
  limits.
- Verification executables and arguments come from a separate operator-controlled
  policy file. A proposal cannot author a command.
- Proposal, accept, and discard require explicit CLI consent. Inspect is read-only.
- The first gate supports trusted verification only and must label that posture.
  It does not claim filesystem, network, credential, privilege, or resource
  containment.

## Compatibility rule

The older transaction and candidate protocols remain temporarily for conformance
and migration. The `forge change` surface must not compose them or expose them as a
second current workflow. After this slice is accepted, removal of the legacy public
CLI commands can be scheduled separately with explicit compatibility evidence.

## Acceptance gates

- One bounded ChangeSet v2 protocol covers propose, inspect, accept, and discard.
- Verified proposal evidence survives process restart and is returned by inspect.
- Failed or cancelled proposal verification removes its candidate and cannot be
  accepted.
- Promoted, discarded, and rolled-back terminal outcomes have no live candidate
  worktree; interrupted cleanup is retried during reconciliation.
- Active-workspace divergence fails closed and is never overwritten.
- Duplicate terminal operations are idempotent and return the durable artifact.
- Proposal JSON cannot supply a verification executable or bypass policy checks.
- No generic shell, direct write command, MCP mutation tool, or TypeScript terminal
  decision is added.
- Local TypeScript/Rust/hybrid gates pass.
- Hosted Windows, macOS, and Ubuntu gates pass.
- A disposable-repository CLI test proves the full flow.
- The controlled seven-tool VS Code read-only test remains one-call and mutation-free.

## Rollback rule

If the new service cannot reuse ChangeSet v2 and the durable coordinator without
weakening their invariants, keep it private and stop. Do not ship a TypeScript
transaction coordinator or promote through the older text-only lifecycle as a
shortcut.

## Closure evidence

- Local `npm run check` passed with 37/37 tests, typecheck, and production build.
- Hosted cross-platform run
  [30556929564](https://github.com/celestialcactus/forge-engine/actions/runs/30556929564)
  passed Windows/macOS.
- Hosted hybrid run
  [30556929739](https://github.com/celestialcactus/forge-engine/actions/runs/30556929739)
  passed Rust, TypeScript, sovereign CLI, optimized-build, and latency gates on
  Windows/macOS/Ubuntu.
- The controlled VS Code regression used exactly seven Forge tools and one
  workspace-summary call in four seconds, with no mutation.
- [Checkpoint 38](../decisions/checkpoints/2026-07-30-38-sovereign-cli-hosted-and-vscode-gate.md)
  records the accepted behavior, the SHA-256 identity defect found during hosted
  validation, and the remaining trusted-execution boundary.
