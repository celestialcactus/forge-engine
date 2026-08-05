# Checkpoint 73: durable outer-run ledger reaches the local gate

**Date:** 2026-08-05
**Branch:** `feature/cli-run-recovery`
**Scope:** CLI ship-lane increment 6A; hosted and controlled VS Code acceptance pending

## Accepted locally

- Bridge v7 requires an absolute Rust run-store root for every canonical product
  run. There is no unpersisted bridge-v7 product path.
- Rust creates a bounded, create-once request record beneath a SHA-256 run-ID
  path, appends and synchronizes every event before `run.event`, validates and
  atomically publishes the terminal artifact before `run.result`, and refuses to
  reopen an existing run identity.
- Rust, not TypeScript, reads and validates stored records through
  `forge.kernel.run-store.v1`. TypeScript only validates and presents that result.
- `forge runs inspect <run-id>` returns a validated terminal artifact without
  planner, approval, provider, or capability work. Valid unsealed prefixes report
  `open_or_interrupted`; malformed state reports `repair_required`. Neither is
  automatically replayed.
- `forge doctor` reports the effective run-store root, protocol, durability order,
  and the current inspect-only recovery posture.
- ChangeSet transaction journals remain the mutation authority. The run ledger
  records the outer lifecycle and does not replace or reinterpret them.

## Adversarial evidence

- Nine Rust unit regressions cover terminal return, interruption, duplicate run
  IDs, partial frames, sequence gaps, cross-platform hashed paths, artifact/event
  projection mismatch, sparse oversized ledgers, and partial provider-usage
  accounting.
- A live child-process test inspects the ledger immediately after the host receives
  event 1 and then kills the kernel. The event was already durable, and restart
  inspection remained `open_or_interrupted` / `blocked_incomplete`.
- A second live child-process test inspects the store immediately upon receiving
  `run.result`; the exact terminal artifact was already sealed and returned with
  `return_terminal_artifact`.
- Full retained-kernel parity initially exposed a validator mismatch for partially
  reported token usage. The canonical runtime credits neither token counter unless
  both fields exist; the store validator now applies the same all-or-nothing rule,
  and a focused Rust regression preserves it.

## Local validation

- `npm run check`: typecheck, 91/91 Node tests, production build;
- Rust format plus zero-warning clippy: pass;
- full Rust workspace: 50/50 active core unit tests plus all integration suites
  pass; expected helper/Unix-only tests remain ignored on Windows;
- full native Rust build: pass using the installed GNU/LLVM Windows toolchain and
  bundled linker because this shell does not expose the MSVC linker;
- retained-kernel hybrid suite: 56/56 pass, including CLI, MCP, parity,
  governed-change, interruption, and terminal-seal cases;
- exact built-product temp-root smoke: one real inspection completed with seven
  events; a fresh CLI process returned its terminal artifact through
  forge.kernel.run-store.v1; doctor reported bridge v7 and the exact store root;
- `git diff --check`: pass.

## Not accepted yet

- Hosted Windows/macOS/Ubuntu has not run against the exact commit.
- Controlled VS Code has not rerun the seven-tool one-call regression against the
  exact commit.
- Increment 6B is not implemented. Forge cannot yet resume an interrupted provider
  conversation, pending tool call, or ambiguous capability. It deliberately
  blocks them rather than risking duplicate cloud cost or side effects.
- Retention, encryption/signing, search projections, repair tooling, and universal
  power-loss guarantees remain outside 6A.

## Next gate

Commit and publish the exact local-gate head, require the existing Node
Windows/macOS and hybrid Windows/macOS/Ubuntu matrices, then repeat the controlled
VS Code one-call summary. Only after those gates should 6A be accepted and 6B's
interaction transcript begin.
