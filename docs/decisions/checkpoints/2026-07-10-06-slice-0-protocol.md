# Checkpoint 06: Slice 0 protocol and golden trace

**Date:** 2026-07-10
**Status:** accepted
**Decision owner:** ForgeEngine project

## What was implemented

Slice 0 now has an executable, host-neutral protocol for a deterministic,
read-only developer run. It defines:

- immutable workspace snapshots;
- a transparent context plan with a hard developer-supplied budget;
- ordered, logical-clock run events;
- a capability request → approval → result lifecycle;
- terminal completed, failed, cancelled, and budget-exhausted states;
- a durable in-memory run artifact containing all evidence and events.

The initial planner, policy, capability, and workspace are deterministic fixtures.
They prove the kernel without concealing vendor, provider, filesystem, or IDE
behavior behind a mock integration.

## What validation found

The first golden run exposed a locale-sensitive path-sort defect. Although a
locale-aware sort looked deterministic on one machine, it could yield a different
context order on another host. Slice 0 now uses an explicit locale-independent
comparison. This is the practical value of a golden trace: it catches protocol
instability while the cost of correction is tiny.

## Accepted evidence

`npm run check` passes in `C:\dev\forge-engine`:

- TypeScript strict typecheck passes.
- 11 tests pass, including the existing runtime tests.
- Slice 0 covers success, repeated deterministic traces, denied approval,
  capability failure, context-budget exhaustion, pre-start cancellation,
  post-completion cancellation, and a planner-completion cancellation race.
- Production build and existing CLI smoke test pass.

## Boundary of this decision

This accepts the **protocol direction**, not a complete runtime rewrite. The older
provisional runtime still exists while the CLI is migrated deliberately in the
next slice. It is not the authority for new contracts. New work should target the
Slice 0 contracts and conformance tests.

## Files

- [Slice 0 protocol](../../architecture/slice-0-protocol.md)
- `src/slice0/contracts.ts`
- `src/slice0/context.ts`
- `src/slice0/runtime.ts`
- `src/slice0/fixtures.ts`
- `tests/slice0-runtime.test.ts`
- `tests/slice0-cancellation-race.test.ts`

## Next decision

Decide whether to accept Slice 0 as the immutable kernel contract, then begin the
narrow Slice 1 spine: replace the CLI's direct provisional loop with this run
contract and add deterministic, real read/search/git evidence adapters.
