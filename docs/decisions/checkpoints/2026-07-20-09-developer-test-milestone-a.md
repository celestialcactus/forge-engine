# Checkpoint 09: Developer Test Milestone A

**Date:** 2026-07-20
**Status:** completed; superseded by the Slice 1 closure audit
**Decision owner:** ForgeEngine project

This checkpoint records the surface that entered hands-on testing. Final results
and corrective decisions are recorded in
`2026-07-22-10-slice-1-closure-audit.md`.

## Milestone decision

Pause feature expansion and collect developer feedback before adding mutation.
Forge was sufficiently built to test its read-only apprentice value inside VS
Code: it could collect, bound, attribute, and trace multiple forms of repository
evidence through seven MCP tools.

## Capabilities accepted for testing

- workspace summary;
- bounded literal search;
- bounded, snapshot-constrained file reads;
- TypeScript/JavaScript declaration extraction;
- no-emit TypeScript diagnostics;
- read-only Git status;
- bounded staged or unstaged Git diff.

## Entry validation

The clean `C:\dev\forge-engine` checkout passed strict TypeScript typecheck, 20
automated tests, production build, official MCP subprocess discovery, malformed
input handling, traversal rejection, a no-emit diagnostic fixture, and bounded
read-only Git evidence.

These counts describe the pre-test checkpoint and were superseded by the closure
candidate's larger conformance suite.

## Framework and service decision

TypeScript 5.9.2 became a production dependency for compiler evidence. Git remained
an external executable adapter invoked only with fixed read-only arguments. See
ADR-0003.

## Why testing preceded mutation

The next meaningful slice introduces change transactions, process/worktree
boundaries, patches, and verification. Host testing first allowed evidence shape,
limits, trace projection, and provenance semantics to change before write contracts
made those decisions expensive.

## Limits retained at entry

- Windows VS Code MCP processes were not OS-sandboxed.
- Snapshot IDs did not hash complete file content.
- Search and snapshots used full scans.
- Compiler diagnostics were synchronous and TypeScript-specific.
- Declarations were syntactic.
- Forge did not edit files or execute tests.

## Test records

- `docs/architecture/slice-1-read-only-repository-intelligence.md`
- `docs/testing/vscode-developer-test-milestone-a.md`
- `docs/audit/slice-1-closure-audit.md`

## Outcome

The trigger was satisfied on 2026-07-22. Controlled VS Code testing and the
subsequent audit accepted Slice 1 after compact host projections, citation-ready
evidence, MCP invocation identity, runtime consolidation, and additional workspace
boundary regressions.
