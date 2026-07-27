# Checkpoint 27: rebuild branch model

**Date:** 2026-07-27
**Status:** Adopted for initial transition; canonical integration name superseded by Checkpoint 28
**Stable branch:** `rebuild/master`
**Integration branch:** `rebuild/develop`
**Common base:** accepted Slice 2D checkpoint `3b2b62f`

> Historical note: this checkpoint records the initial `rebuild/develop` bootstrap.
> Checkpoint 28 makes literal `develop` canonical and freezes this transition branch.

## Decision checkpoint

ForgeEngine reconstruction now has a stable line and an integration line separate
from the historical default `master`. Accepted bounded feature increments merge
into `rebuild/develop`. Named stable milestones promote develop into
`rebuild/master` through a separate validation PR.

Both branches were created from the same accepted Slice 2D commit. Slice 2E was not
preloaded into develop: its accepted 2E-0 increment remains a reviewable first PR.
This avoids treating branch creation as approval and keeps the reconstruction
history auditable.

The old `master` remains unchanged. Replacing the repository default branch,
closing the superseded draft PR, or promoting the rebuild into the historical line
requires a separate explicit decision.

## Merge policy

Feature work normally branches from the latest `rebuild/develop`. Accepted commit
IDs referenced by checkpoints remain reachable, so integration prefers merge
commits over squash. Direct feature pushes and force-pushes to either rebuild branch
are prohibited by process; GitHub rulesets are a follow-up repository-administration
step rather than an unverified claim in this checkpoint.

The hybrid workflow explicitly watches `feature/**`, `fix/**`, and `rebuild/**`
pushes in addition to pull requests. This prevents the Rust/kernel matrix from
silently disappearing after an accepted PR merges into the integration or stable
line.

See `docs/development/rebuild-branch-strategy.md` for the complete flow.
