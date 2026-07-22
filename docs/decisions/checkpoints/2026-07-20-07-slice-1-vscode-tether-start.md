# Checkpoint 07: Slice 1 and VS Code tether start

**Date:** 2026-07-20
**Status:** implementation authorised
**Decision owner:** ForgeEngine project

## User outcome

A developer opening ForgeEngine in VS Code should be able to:

1. build and run Forge locally;
2. inspect the real opened workspace through the Forge CLI;
3. see Forge as a local MCP server in VS Code;
4. invoke a small, explicitly read-only Forge toolset from Copilot Chat;
5. receive the same Forge run artifact shape used outside VS Code.

This is a tether proof, not the full IDE product integration.

## Scope

- Deterministic real workspace snapshot adapter.
- Bounded workspace inventory and literal text search capabilities.
- CLI migration from the provisional runtime to the accepted Slice 0 protocol.
- Official MCP v1 TypeScript SDK over stdio.
- Workspace-local `.vscode/mcp.json` using `${workspaceFolder}`.
- Automated MCP client smoke/conformance test.

## Explicit exclusions

- file writes, patches, terminal commands, Git mutation, or network access;
- real model inference or cloud credentials;
- automatic skills, memory, compression, or routing;
- VS Code extension APIs, editor decorations, webviews, or Language Server wiring;
- claims of process or filesystem sandboxing on Windows.

## Why this ordering is acceptable

Slice 0 has passed its host-neutral contract gate. A narrow MCP adapter can now
test whether those contracts really remain useful outside Forge without committing
to the later full IDE integration. Any host-specific leak found here is cheaper to
fix before mutable capabilities and durable sessions arrive.

## Framework decision

Adopt the stable v1 official MCP TypeScript SDK only at the adapter boundary. See
[ADR-0002](../ADRs/ADR-0002-mcp-typescript-sdk.md).

## Acceptance gate

- `npm run check` passes.
- `forge inspect --json` returns a Forge `RunArtifact` for the real workspace.
- `forge search <query> --json` returns bounded, attributable results.
- The official MCP client discovers and invokes the two Forge tools over stdio.
- VS Code configuration points only at this checkout and contains no secrets or
  machine-specific predecessor paths.

## Next checkpoint trigger

Record the result after the CLI, MCP conformance test, and local VS Code setup are
all ready for the developer to exercise.
