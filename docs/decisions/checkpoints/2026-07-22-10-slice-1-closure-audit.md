# Checkpoint 10: Slice 1 closure audit

- **Status:** passed
- **Date:** 2026-07-22
- **Scope:** Slice 0 protocol plus Slice 1 deterministic read-only repository intelligence
- **Decision owner:** ForgeEngine project

## Decision

Accept and commit Slice 1 after corrective consolidation. Forge now has one
host-neutral runtime, a deterministic read-only CLI plan, seven bounded evidence
capabilities, and a VS Code-compatible MCP projection backed by the same internal
run artifact.

Do not include proposal, apply, process execution, verification, rollback, or other
Slice 2 behavior in this commit.

## Corrections required by the audit

- removed the provisional competing runtime/session/provider stack;
- made `forge run` retain the supplied developer task;
- added injectable run ID creation for exact real-adapter trace fixtures;
- centralized snapshot path selection/canonicalization and applied it to search;
- required valid UTF-8 for text evidence;
- distinguished MCP invocation identity from evidence run identity;
- standardized the package root export;
- updated the README, Slice 1 architecture, ADRs, and test record to actual state.

## Accepted production surface

- CLI: doctor, deterministic run, inventory, literal search, bounded read,
  declarations, TypeScript diagnostics, Git status, Git diff, and stdio MCP launch;
- MCP: exactly seven read-only tools with input/output schemas;
- embedded: `ForgeRuntime`, native run/artifact contracts, workspace service, and
  deterministic evidence adapters;
- workspace observation: connection-scoped reuse, invalidation, bounded rescan,
  scan-per-call fallback, and close lifecycle.

## Validation record

The closure candidate must pass the commands and experiments listed in
`docs/audit/slice-1-closure-audit.md`. The final command results and commit hash are
reported in Git history and the task handoff rather than embedded recursively in
this commit.

## Deferred gates

- diagnostics worker isolation and cancellation;
- representative performance/conformance fixtures;
- persistent indexed workspace evidence;
- streaming Git output;
- content-aware snapshot identity;
- host-output deduplication compatibility;
- OS-backed mutation/process isolation.

## Next checkpoint trigger

Begin Slice 2 only after this exact read-only boundary is committed. The first
Slice 2 checkpoint must remain proposal-first and must not expose mutation until a
bounded Windows worktree/process experiment demonstrates approval, conflict,
verification, cancellation, cleanup, and recoverable failure behavior.
