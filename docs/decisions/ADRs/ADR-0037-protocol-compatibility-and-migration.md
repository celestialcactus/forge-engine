# ADR-0037: Protocol compatibility and durable-record migration

- **Status:** accepted
- **Date:** 2026-08-17
- **Owners:** ForgeEngine maintainers
- **Checkpoint:** 89
- **Supersedes:** unspecified schema migration behavior
- **Superseded by:** none

## Context

Forge has independently versioned run artifacts, kernel bridges, transaction
records, ledgers, sandbox reports, and future memory records. Exact-version native
packages reduce one class of mismatch but do not define host negotiation or durable
upgrade behavior.

## Decision

Each contract family is versioned independently. There is no global “Forge schema
version.” Live host/kernel connections initialize before work with implementation
identity, supported protocol versions, and capabilities. The connection selects an
explicit overlap or fails before any capability executes. Experimental fields and
methods require an explicit negotiated opt-in.

Writers emit only the current schema. During 0.x, readers support the current and
immediately previous *published* durable schema for inspection and copy-on-write
migration. Supporting inspection does not authorize replay: old non-idempotent or
unknown authority semantics remain fail-closed. Unknown newer records may expose
bounded metadata for diagnosis but cannot execute or mutate state.

Migrations preserve the original, write a new record, and append a receipt containing
source/target versions and content digests. In-place silent rewrites are forbidden.
Prototype-era records before the reconstruction anchor have no automatic migration
promise.

## Consequences

- Hosts get MCP-like negotiation rather than guessing from package versions.
- Durable evidence remains recoverable through one explicit compatibility window.
- Contract-family versions can evolve without bumping unrelated surfaces.
- Every public schema bump now requires golden fixtures, downgrade/unknown-version
  negatives, a migration receipt test, and release notes.

## Provider calibration

MCP demonstrates explicit version and capability negotiation. Codex app-server
demonstrates initialization, version-specific generated schemas, and experimental
capability opt-in. Claude Code and Gemini CLI demonstrate release channels, version
constraints, promotion, and rollback. Forge adopts those public management patterns;
it does not infer guarantees for vendors' undocumented internal storage.

## Validation plan

- No-overlap handshakes fail before a capability event.
- Current and previous published durable fixtures inspect and migrate deterministically.
- Unknown newer records cannot replay or mutate.
- Migration is copy-on-write and its receipt verifies both digests.
