# Checkpoint 11: Slice 2 proposal boundary and isolation spike

- **Status:** accepted for Slice 2A; complete Slice 2 remains in progress
- **Date:** 2026-07-22
- **Scope:** proposal-first change transactions and Windows/macOS worktree and process feasibility
- **Decision owner:** ForgeEngine project

## Decision

Begin Slice 2 with a non-mutating, digest-bound proposal artifact. Accept a detached
Git worktree as a candidate recoverability boundary only for an explicitly matching
base. Do not treat it as a security sandbox and do not expose mutation through MCP
until the production lifecycle and failure cases are proven.

## Implemented boundary

`workspace.change.propose` now:

- accepts one to twenty bounded UTF-8 whole-file replacements;
- binds each replacement to the exact SHA-256 digest of its evidence base;
- resolves paths through the Slice 1 snapshot/canonical-root boundary;
- rejects stale or duplicate canonical targets as an all-or-nothing proposal;
- emits deterministic before/after digests and bounded review diffs;
- identifies no-ops and never writes the workspace;
- remains available through the embedded workspace service only.

## Spike findings

The executable worktree/process spike proves candidate worktree edits do not affect the
developer workspace. It also proves a detached worktree omits dirty/untracked state
and ignored local dependencies, so `HEAD` cannot silently replace the proposal
base.

The local Windows candidate verification transport uses a fixed executable and argument array
with `shell: false`. It bounds captured output, retains actual byte counts, and
distinguishes timeout from caller cancellation.

The same suite passed on hosted Windows and macOS. The first Windows run exposed
platform-dependent CRLF checkout bytes and therefore different evidence digests;
the repository now enforces LF for tracked text through `.gitattributes`.

## Not yet accepted

- dirty/untracked source handling;
- production worktree lifecycle and durable cleanup evidence;
- dependency/toolchain projection;
- approved verification-command policy;
- platform-specific descendant-process termination;
- apply, final diff, accept/recover, and rollback behavior;
- any eighth or mutating MCP tool.

## Validation record

- Slice 2 proposal contract: six focused tests passed.
- Worktree/process boundary experiment: three focused tests passed locally on Windows.
- Clean Windows checkout: LF policy observed, 36/36 tests, typecheck, build, and smoke passed.
- Hosted conformance run `29903942618`: Windows and macOS passed on commit `78f2ad4`.
- Controlled VS Code: exactly seven read-only Forge tools remained selected and the
  exact-read prompt used one Forge call after MCP restart. Copilot shortened the
  displayed relative path, which remains a host-composition exception.

## Next checkpoint trigger

Promote the accepted Slice 2A spike into a production isolation/verification lifecycle only after its
contracts cover base identity, process trees, cleanup failure, and recoverable
failed verification. The first write must occur in a disposable fixture boundary,
never in the developer's active workspace.
