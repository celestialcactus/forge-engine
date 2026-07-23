# ADR-0003: deterministic repository-intelligence adapters

**Status:** accepted for Slice 1
**Date:** 2026-07-20
**Amended:** 2026-07-22

## Context

A useful software-evidence runtime needs repository facts produced by deterministic
tools, not model guesses. Slice 1 requires bounded file inspection, declarations,
compiler diagnostics, and version-control evidence while retaining a host-neutral
kernel.

## Decision

1. Use exact-pinned TypeScript 5.9.2 as a production dependency for syntax-tree
   declarations and no-emit project diagnostics.
2. Use the installed Git executable through fixed read-only argument arrays for
   status and diff evidence. Disable optional locks, fsmonitor, external diff,
   text conversion, and terminal prompting where applicable.
3. Keep file inventory, literal search, path validation, UTF-8 validation, and
   bounded reads in Forge-owned adapters.

Every file-content adapter must select a path from the current snapshot and
revalidate its canonical location immediately before reading it. Bounded text
evidence accepts valid UTF-8 only. Read evidence carries a SHA-256 content digest
for exact stale-base detection in later change transactions.

## Boundaries

- Compiler diagnostics are a deterministic snapshot, not a language-server
  lifecycle or cross-language intelligence claim.
- Declarations are syntactic; references, call hierarchy, and semantic ranking are
  later work.
- Git commands are evidence sources only. No checkout, add, commit, reset, clean,
  stash, fetch, pull, push, or generic command workflow is exposed.
- Adapter-specific types do not cross into the Forge run protocol.
- Every result is bounded and carried by the accepted `RunArtifact` contract.

## Why compiler API before LSP

The compiler API provides structured TypeScript evidence without introducing an
editor process, language-server manager, or protocol lifecycle before Forge has
measured the queries and latency characteristics it actually needs. LSP remains a
candidate for later multi-language work.

## Known consequences

- TypeScript diagnostics are synchronous and rebuild compiler state per call.
- Search and declarations scan bounded workspace files rather than a persistent
  index.
- Git currently buffers up to one megabyte before applying Forge's presentation
  bound; streaming is a later enterprise-scale gate.
- Other languages receive inventory, literal search, bounded reads, and Git
  evidence but not semantic declarations or diagnostics.

## Acceptance gate

- traversal, forged snapshot escape paths, and non-snapshot reads are rejected;
- invalid UTF-8 is rejected or skipped rather than silently decoded;
- file output, search, declarations, diagnostics, status, and diff are bounded;
- compiler diagnostics run with `noEmit`;
- Git uses fixed executable arguments and does not mutate repository state;
- CLI and MCP conformance cover all seven capabilities;
- the complete strict check/build suite passes.
