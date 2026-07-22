# Checkpoint 08: Slice 1 VS Code tether ready

**Date:** 2026-07-20
**Status:** accepted for developer testing
**Decision owner:** ForgeEngine project

## Outcome

ForgeEngine now has a usable read-only Slice 1 surface:

- a real, canonical workspace snapshot with content-independent identity derived
  from normalized file paths and sizes;
- bounded workspace inventory and literal text search;
- a CLI backed by the accepted Slice 0 run/artifact protocol;
- a local stdio MCP adapter using the exact-pinned official v1 TypeScript SDK;
- a workspace-relative VS Code configuration with no predecessor paths or secrets;
- an official MCP client conformance test.

## Validation evidence

Validation passed in `C:\dev\forge-engine`:

- strict TypeScript typecheck;
- 15 tests passing;
- production build;
- official MCP client starts the Forge subprocess, discovers exactly two tools,
  invokes workspace summary, and receives a structured error for malformed search;
- built CLI doctor reports `slice-1-read-only` and `stdio` MCP;
- built CLI inspected the real checkout: 123 files discovered, a bounded five-file
  response returned;
- built CLI literal search completed with four matches for the smoke query.

Counts above describe the checkpoint workspace and may change as files are added.

## Defects found and resolved

- Slice 0 had already revealed locale-sensitive ordering; the real adapter retains
  the locale-independent comparator.
- The MCP SDK returns invalid tool arguments as a normal tool result with
  `isError: true`, rather than rejecting the client call. The conformance contract
  now asserts the protocol's actual error shape.
- The repository's old `.vscode/mcp.json` referenced an unrelated archived agent
  path. It now launches this checkout's built Forge CLI using `${workspaceFolder}`.

## Boundary

This checkpoint proves Forge can tether to VS Code as a read-only apprentice. It
does not accept a complete Slice 1 developer loop: Git evidence, diagnostics,
mutable change transactions, provider inference, and durable sessions remain
future gated work.

The MCP SDK is an adapter dependency only. Forge's kernel remains MCP-free.

## Framework record

- [ADR-0002: official MCP TypeScript SDK](../ADRs/ADR-0002-mcp-typescript-sdk.md)

## Developer test guide

- [Test ForgeEngine in VS Code](../../testing/vscode-mcp-tether.md)

## Next decision

Collect the manual VS Code tether result. If discovery, invocation, and trace
inspection work as expected, proceed with the remaining deterministic Slice 1
evidence adapters—Git state and language diagnostics—before any mutable workflow.
