# Slice 2: developer change transaction

**Status:** Slice 2A proposal and cross-platform candidate accepted; complete Slice 2 in progress
**Date:** 2026-07-22

## User-visible outcome

Forge can turn exact, digest-backed file evidence into a deterministic and reviewable
change proposal without editing the workspace. This is the first phase of the
developer change loop, not a mutation feature.

The complete Slice 2 outcome remains: propose, approve, isolate, apply, verify, and
either accept or recover a small change with every phase represented as evidence.

## Transaction pipeline

| Phase | Current state | Required evidence |
| --- | --- | --- |
| Read base | implemented | canonical path, bounded content, SHA-256 digest, snapshot ID |
| Propose | implemented | deterministic proposal ID, before/after digests, bounded unified diff |
| Approve | pending | explicit decision tied to proposal ID and exact capabilities |
| Isolate | candidate proven for a clean committed base; production lifecycle pending | selected worktree or equivalent boundary with reported guarantees |
| Apply | pending | atomic or recoverable write record; no hidden partial success |
| Verify | candidate direct-child transport proven; policy and process-tree handling pending | fixed executable/argument contract, timeout, bounded output, exit result |
| Accept or recover | pending | final diff, verification outcome, cleanup and rollback status |

## Slice 2A contract

A proposal:

- contains from one to twenty UTF-8 text replacements;
- limits each source and replacement to 1 MiB;
- requires the exact lowercase SHA-256 digest returned by Forge read evidence;
- resolves every path through the existing snapshot and canonical-root checks;
- rejects duplicate canonical targets;
- rejects the complete proposal when any base digest is stale;
- emits no change for an exact no-op;
- bounds aggregate returned diff evidence from 1,000 to 500,000 bytes;
- keeps proposal identity independent of diff truncation;
- records mutatesWorkspace as false and approvalRequiredBeforeApply as true.

The capability is available through ForgeWorkspaceService for controlled fixtures.
It is not exposed through MCP and does not expand the seven-tool Developer Test
Milestone A surface.

## Harness efficiency carried forward

Connection-scoped workspace snapshots now reuse a completed scan for adjacent
evidence calls. Reuse is invalidated by relevant filesystem events and bounded by a
five-second rescan ceiling. If recursive change observation is unavailable, Forge
falls back to scan-per-call behavior. An invalidation that races an active scan
starts a new generation rather than joining stale work.

This reduces Forge-owned duplicate traversal. It does not prevent a host model from
issuing redundant MCP calls. Read replay guidance and cache hits address that host
behavior separately and must still be measured in host tests.

## Cross-platform boundary experiment

The cross-platform executable spike in `tests/slice2-boundary-spike.test.ts` proves that candidate
worktree edits leave the original workspace unchanged and that a fixed, shell-free
child process can bound output and distinguish timeout from caller cancellation.
The local Windows run also proves the critical limitations: a detached worktree uses committed content,
omits dirty/untracked developer state, and does not carry ignored dependencies such
as `node_modules`.

See `docs/architecture/slice-2-windows-worktree-process-boundary.md` for the
accepted candidate evidence and remaining gates. The identical suite passed on
hosted Windows and macOS. The repository enforces LF for tracked text so Forge
evidence digests do not vary with the checkout platform.

## Current safety boundary

No production source write, generic shell, process execution, worktree creation,
package installation, Git mutation, or rollback API exists in this slice. A reviewable
diff is not proof that an apply boundary is safe.

The executable experiment establishes basic isolation, dirty-base mismatch,
dependency absence, cancellation, and output bounds. Production work still must
establish command policy, descendant-process termination, cleanup evidence, and
recoverable failure behavior before any apply capability is registered.

## Slice 2 exit gate

Slice 2 is complete only when a disposable fixture task:

1. reads a digest-backed base;
2. creates and approves a proposal;
3. applies it inside the selected recoverable boundary;
4. runs bounded verification;
5. returns the final diff and verification evidence;
6. demonstrates recoverable behavior on conflict, failed verification, cancellation,
   and cleanup failure.
