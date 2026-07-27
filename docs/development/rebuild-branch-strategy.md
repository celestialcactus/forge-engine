# Rebuild branch and promotion strategy

**Adopted:** 2026-07-27
**Repository default branch:** `master` (unchanged during reconstruction)

## Branch roles

| Branch | Role | Starting point | Allowed changes |
| --- | --- | --- | --- |
| `rebuild/master` | Stable rebuild/release line | Accepted Slice 2D checkpoint `3b2b62f` | Promotion PRs from `rebuild/develop`; emergency fixes branch from this line and must be merged back into develop. |
| `rebuild/develop` | Rebuild integration line | Accepted Slice 2D checkpoint `3b2b62f` | Accepted feature/checkpoint PRs after their required local and hosted gates pass. |
| `feature/*`, `fix/*`, `spike/*` | Bounded work | Normally the current `rebuild/develop` head | One reviewable increment with its task, ADR/checkpoint where required, implementation, and validation evidence. |
| `master` | Historical/default line during reconstruction | Existing repository history | No reconstruction work is merged here until the owner explicitly chooses the final cutover. |

## Normal flow

1. Create a bounded feature branch from `rebuild/develop`.
2. Open a draft PR into `rebuild/develop` early when collaboration or hosted gates
   need the remote branch.
3. Keep the PR draft while the increment is incomplete or an acceptance gate is
   pending.
4. Mark it ready only when the exact implementation commit has passed its required
   local and hosted gates and the checkpoint states its honest remaining limits.
5. Merge the accepted increment into `rebuild/develop`. Prefer a merge commit so the
   feature/checkpoint boundary remains visible; do not squash away accepted commit
   IDs referenced by ADRs and validation records.
6. Start the next increment from the updated `rebuild/develop`, not from a stale
   feature branch.
7. Promote `rebuild/develop` to `rebuild/master` through a separate PR only at a
   named stable milestone. That PR reruns the complete release-facing matrix and
   contains no new implementation work.

## Hotfix flow

A stable-line fix branches from `rebuild/master`, is validated and merged into
`rebuild/master`, then is immediately merged or cherry-picked through a PR into
`rebuild/develop`. Divergent fixes on the two long-lived branches are not allowed.

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

## Merge and history policy

- No direct feature commits to either long-lived rebuild branch.
- No force-pushes to `rebuild/master` or `rebuild/develop`.
- No automatic promotion from develop to stable.
- Accepted checkpoint commit IDs remain reachable.
- The old default `master` and draft reconstruction PR are not silently rewritten;
  final cutover or archival is a separate owner decision.

## Current transition

`rebuild/master` and `rebuild/develop` were both created from `3b2b62f`, the
accepted Slice 2D documentation checkpoint. The accepted Slice 2E-0 ChangeSet/CAS
increment is proposed to `rebuild/develop` as the first integration PR. Later Slice
2E increments should use fresh bounded branches from the updated integration head.
