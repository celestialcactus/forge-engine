# ADR-0035: Canonical repository and worktree authority

- **Status:** accepted
- **Date:** 2026-08-17
- **Owners:** ForgeEngine maintainers
- **Checkpoint:** 89
- **Supersedes:** path- and ref-assumption portions of the rebuild workflow
- **Superseded by:** none

## Context

The Codex saved project points at the dirty historical prototype checkout. Its local
`origin/develop` was stale, so two otherwise bounded lanes started from `aa73e0e`
instead of the accepted reconstruction. Their commits are useful but not mergeable
as authoritative ancestry.

## Decision drivers

- Preserve the historical prototype and all uncommitted work.
- Prevent stale refs from silently creating new lanes.
- Keep the rule portable across clones and operating systems.
- Avoid treating a local drive path as product architecture.

## Decision

Forge repository authority is the canonical GitHub remote, `origin/develop`, and the
permanent reconstruction anchor `5fff597269168c250b15e89e7ae77d68f0510abc`.
Every new lane must fetch `origin/develop`, pass the read-only authority guard with
the current-head requirement, and branch from that exact remote ref.

Existing stale work is preserved and replayed as a bounded diff onto fresh ancestry;
stale branch history is never merged to recover it. The old OneDrive prototype is
not deleted or reset.

## Consequences

### Positive

- A stale saved-project ref fails before it can be called current Forge work.
- New clones remain valid because the decision is lineage-based, not path-based.
- Candidate implementation can be salvaged without importing obsolete history.

### Negative

- The user must re-open the canonical reconstruction path in Codex once; the app has
  no project-path reassignment API.
- Long-running lanes may need a deliberate replay/rebase before integration.

## Validation plan

- The guard passes in the canonical worktree.
- The guard fails in the historical prototype checkout with an actionable message.
- A feature branch that contains current `origin/develop` passes
  `--require-current-develop`.

## Revisit or replacement conditions

Replace the anchor only if repository history is deliberately rewritten through an
explicit migration. Normal commits never require an anchor update.
