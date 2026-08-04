# Checkpoint 67 - approval cancellation local gate

**Date:** 2026-08-04
**Branch:** `feature/cli-approval-control`
**Base:** merged `develop` at `2ff5669` (PR #20)
**Status:** increment 5A local gate green; hosted, live-product, and VS Code gates pending

## Result

The accepted governed edit lifecycle now settles when the run is cancelled while
waiting for either developer decision.

- Before candidate execution, cancellation returns `cancelled` after read-only
  preparation and before `workspace.change.propose`.
- After successful candidate verification, Forge prints the durable transaction ID
  before asking for promotion. Cancellation retains that candidate and performs no
  accept/discard call.
- The node readline adapter removes the pending waiter and abort listener on answer,
  EOF, close, or cancellation.
- The governed executor also races cancellation itself, so a non-conforming embedded
  question adapter cannot keep the capability promise pending.
- Ordinary decline/accept/discard and Rust transaction authority are unchanged.

No Rust schema, bridge protocol, mutation engine, or MCP surface was added. This is
an integration-boundary correction over the existing canonical run signal.

## Validation

- `npm run typecheck`: passed.
- Focused approval/interactive/live CLI tests: 14/14 passed.
- `npm run check`: typecheck, 81/81 tests, and production build passed.
- `git diff --check`: passed.
- New regressions deliberately use a question adapter that ignores AbortSignal;
  the executor still settles and calls no later mutation operation.

The first focused runner attempt failed before test execution with Windows sandbox
`spawn EPERM`. The identical command passed outside the restricted process sandbox;
this is test-runner containment evidence, not a product failure.

## Honest remaining gates and limits

- Exact-head hosted Node Windows/macOS and real hybrid Windows/macOS/Ubuntu are not
  yet called passed.
- A live product process still must reach each real approval prompt, time out, and
  prove the source workspace remains unchanged.
- On cancellation at the second prompt, the durable coordinator retains the
  transaction and the CLI prints its ID. The cancelled outer RunArtifact does not
  yet become a crash-resumable record; that belongs to Recovery state.
- Independent capability and inference/token budgets are still absent; `maxTurns`
  is the only Rust-owned iteration ceiling. That is increment 5B.
- Trusted verification remains non-sandboxed local execution.

## Next gate

Commit and push the exact implementation, require the cross-platform matrices, run
both live approval-timeout scenarios with the exact hosted Windows kernel, and
repeat the controlled seven-read-only-tool VS Code tether. Accept 5A only after all
four gates are green.
