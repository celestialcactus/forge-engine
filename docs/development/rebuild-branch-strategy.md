# Rebuild branch and promotion strategy

**Adopted:** 2026-07-27
**Canonical integration branch:** `develop`
**Stable rebuild branch:** `rebuild/master`
**Repository default branch:** `master` (unchanged during reconstruction)

## Branch roles

| Branch | Role | Current policy |
| --- | --- | --- |
| `develop` | Canonical rebuild integration line | The readily pullable, consolidated state. Accepted feature/checkpoint PRs target this branch after their required local and hosted gates pass. |
| `rebuild/master` | Stable rebuild/release line | Promotion PRs come from `develop`. Emergency fixes branch from this line and must be merged back into `develop`. |
| `feature/*`, `fix/*`, `spike/*` | Bounded work | Branch from the current `develop` head and return through a reviewable PR. |
| `rebuild/develop` | Frozen transition pointer | Retained at `8d295b1` so earlier PR/checkpoint links remain resolvable. It is not an active integration target. |
| `master` | Historical/default line during reconstruction | No reconstruction work is merged here until the owner explicitly chooses the final cutover. |

## Normal flow

1. Fetch `origin/develop` and create a bounded feature branch from that exact head.
2. Open a draft PR into `develop` early when collaboration or hosted gates need the
   remote branch.
3. Keep the PR draft while the increment is incomplete or an acceptance gate is
   pending.
4. Mark it ready only when the exact implementation commit has passed its required
   local and hosted gates and its checkpoint states the honest remaining limits.
5. Merge the accepted increment into `develop`. Prefer a merge commit so the
   feature/checkpoint boundary remains visible; do not squash away accepted commit
   IDs referenced by ADRs and validation records.
6. Start the next increment from the updated `develop`, not from a stale feature or
   the frozen `rebuild/develop` pointer.
7. Promote `develop` to `rebuild/master` through a separate PR only at a named stable
   milestone. That PR reruns the complete release-facing matrix and contains no new
   implementation work.

## Pulling the consolidated rebuild

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
```

A new checkout can use `git switch --track origin/develop`. Local worktrees should
compare `git rev-parse HEAD` with `git rev-parse origin/develop` before claiming they
contain the consolidated version.

## Hotfix flow

A stable-line fix branches from `rebuild/master`, is validated and merged into
`rebuild/master`, then is immediately merged or cherry-picked through a PR into
`develop`. Divergent fixes on the two active long-lived branches are not allowed.

## Required checks

Until GitHub branch protections are configured, these are enforced by process and
recorded in the PR/checkpoint:

- Windows and macOS are required Tier-1 gates for integration and promotion.
- Ubuntu remains the Rust/local compatibility gate.
- Rust format, warnings-as-errors lint, tests, and build must pass for machinery.
- TypeScript typecheck, tests, production build, and hybrid/MCP checks must remain
  green when the changed boundary can affect them.
- A live VS Code test is required when MCP descriptions, tool contracts, host result
  shaping, cancellation, or the public IDE workflow changes; it is not repeated for
  a Rust-internal contract with an unchanged seven-tool surface.
- Both hosted workflows run on `develop` pushes. Hybrid conformance also watches
  feature, fix, spike, and rebuild branch pushes plus every pull request.

## Merge and history policy

- No direct feature commits to `develop` or `rebuild/master`.
- No force-pushes to either active long-lived branch.
- No automatic promotion from develop to stable.
- Accepted checkpoint commit IDs remain reachable.
- The frozen `rebuild/develop`, historical default `master`, and old draft
  reconstruction PR are not silently rewritten; cleanup/cutover is a separate owner
  decision.

## Current transition

The complete accepted rebuild through Slice 2E-0 and the rebuild-branch CI fix were
validated locally and hosted at `8d295b1`, then published as the initial `develop`
head. `rebuild/develop` remains frozen at that same commit. New work begins from
`develop`; only stable milestones flow into `rebuild/master`.
