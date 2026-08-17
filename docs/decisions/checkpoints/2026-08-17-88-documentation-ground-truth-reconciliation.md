# Checkpoint 88: documentation ground-truth reconciliation

**Date:** 2026-08-17
**Scope:** documentation and lane-governance correction only
**Implementation baseline inspected:** `origin/develop` at `4e15226` (PR #24)

## Why this checkpoint exists

The validated build plan remained directionally sound but had become a combined
architecture charter, execution tracker, historical ledger, and dated forecast.
It also contained three overlapping numbering systems and stale status statements.
Two parallel worktrees were later found to have been provisioned from older
`origin/develop` commit `aa73e0e`, while the canonical reconstruction repository
was already at `4e15226`.

## Correction

- Retain the build plan as the V1 architecture and roadmap authority.
- Add `docs/execution/current.md` as the short operational ground truth.
- Define document precedence and a canonical ID for each active lane.
- Define source-dogfood, trusted-alpha, restricted-beta, and enterprise-pilot
  profiles with explicit permitted claims.
- Refresh the plan's current focus, open gates, forecast date, and current
  `develop` description.
- Mark stale-base release commit `a023119` and learning commit `b5effea` as
  replay-required candidates, not accepted state.
- Keep the sandbox lifecycle lane independent and unaccepted until its exact VM
  gate completes.
- Record unresolved license, target matrix, configuration, schema migration,
  memory, sandbox-contract, evaluation, and extension decisions explicitly.

## User impact

A contributor can now answer four questions without reconstructing repository
history: what Forge promises, what is accepted, what is active, and what must merge
next. Parallel work is preserved, but no stale-base candidate is allowed to borrow
acceptance or silently redefine a shared contract.

## Non-claims

- No runtime, package, provider, sandbox, memory, or CLI behavior changed.
- The trusted alpha is not yet publicly shippable.
- Neither native restricted provider is promoted.
- CLI8 memory code is not merged or runtime-active.
- The license, target matrix, and configuration precedence remain owner decisions.

## Validation gate

- documentation-only diff;
- repository-local Markdown links resolve;
- active status statements agree on the accepted implementation baseline and lane
  order;
- no stale-base branch is described as merged or accepted;
- ForgeEngine and Project Sybil remain separate projects.
