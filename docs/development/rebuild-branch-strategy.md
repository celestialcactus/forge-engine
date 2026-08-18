# Rebuild branch and promotion strategy

**Adopted:** 2026-07-27
**Enforced:** 2026-07-28
**Canonical integration branch:** `develop`
**Stable rebuild branch:** `rebuild/master`
**Repository default branch:** `develop`

## Branch roles

| Branch | Role | Current policy |
| --- | --- | --- |
| `develop` | Canonical rebuild integration line | The readily pullable, consolidated state. Accepted feature/checkpoint PRs target this protected branch after their required local and hosted gates pass. |
| `rebuild/master` | Stable rebuild/release line | Promotion PRs come from `develop`. Emergency fixes branch from this protected line and must be merged back into `develop`. |
| `feature/*`, `fix/*`, `docs/*`, `spike/*` | Bounded work | Branch from the current `develop` head and return through a reviewable PR. GitHub deletes the remote head after merge. |
| `rebuild/develop` | Locked transition pointer | Retained at `8d295b1` so earlier PR/checkpoint links remain resolvable. It is not an active integration target. |
| `master` | Locked historical prototype | Preserved for archaeology only. It is no longer the default and cannot accept pushes or PR merges. |

## Normal flow

1. Fetch `origin/develop`, run
   `npm run repo:authority -- --require-current-develop`, and create a bounded
   feature branch from that exact head. See the
   [repository authority workflow](repository-authority.md).
2. Open a draft PR into `develop` early when collaboration or hosted gates need the
   remote branch.
3. Keep the PR draft while the increment is incomplete or an acceptance gate is
   pending.
4. Mark it ready only when the exact implementation commit has passed its required
   local and hosted gates and its checkpoint states the honest remaining limits.
5. Merge the accepted increment into `develop` with a merge commit so the
   feature/checkpoint boundary and accepted commit ancestry remain visible.
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
run `npm run repo:authority -- --require-current-develop` before claiming they
contain the consolidated version.

The reconstruction anchor in ADR-0035 is permanent. A stale candidate is replayed
as a bounded diff from current `origin/develop`; its old ancestry is never merged to
recover implementation work.

## Hotfix flow

A stable-line fix branches from `rebuild/master`, is validated and merged into
`rebuild/master`, then is immediately merged or cherry-picked through a PR into
`develop`. Divergent fixes on the two active long-lived branches are not allowed.

## Enforced GitHub policy

GitHub branch protection applies to administrators as well as collaborators:

- `develop` and `rebuild/master` require a pull request, current-base status, resolved
  review conversations, and all five named hosted jobs.
- Required jobs are Node conformance on Windows/macOS and hybrid Rust/TypeScript
  conformance on Windows/macOS/Ubuntu.
- Direct pushes, force-pushes, and deletion are blocked on both active long-lived
  branches.
- Zero peer approvals are required while ForgeEngine has one active maintainer. This
  prevents a fake self-review ceremony without weakening the PR and CI gates. Raise
  the count to one when a second regular maintainer is available.
- `master` and `rebuild/develop` are locked read-only.
- GitHub offers only merge commits for PRs, permits branch-update requests, and
  automatically deletes merged head branches.

The workflows run once for PRs targeting `develop` or `rebuild/master`, then again
on the resulting protected-branch push. Per-workflow concurrency cancels obsolete
runs for the same PR or branch. Job names remain globally unique because required
checks can become ambiguous when separate workflows reuse a name.

Additional acceptance requirements remain change-sensitive:

- Rust format, warnings-as-errors lint, tests, and build must pass for machinery.
- TypeScript typecheck, tests, production build, and hybrid/MCP checks must remain
  green when the changed boundary can affect them.
- A live VS Code test is required when MCP descriptions, tool contracts, host result
  shaping, cancellation, or the public IDE workflow changes; it is not repeated for
  a Rust-internal contract with an unchanged seven-tool surface.

## Merge and history policy

- No direct commits, force-pushes, or deletion on `develop` or `rebuild/master`;
  GitHub enforces this even for administrators.
- No automatic promotion from develop to stable.
- Accepted checkpoint commit IDs remain reachable.
- `master` and `rebuild/develop` are locked rather than silently rewritten.
- Release tags are created only from `rebuild/master` after a named promotion;
  feature branches are not version anchors.

## Current transition

The complete accepted rebuild through Slice 2E-0 and the rebuild-branch CI fix were
validated locally and hosted at `8d295b1`, then published as the initial `develop`
head. `rebuild/develop` remains frozen at that same commit. New work begins from
`develop`; only stable milestones flow into `rebuild/master`. On 2026-07-28,
`develop` became the repository default, both active long-lived branches gained
enforced PR/status protection, and the historical pointers were locked.
