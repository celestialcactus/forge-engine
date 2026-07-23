# ADR-0002: official MCP TypeScript SDK for host adapters

**Status:** accepted for the Slice 1 VS Code adapter
**Date:** 2026-07-20
**Amended:** 2026-07-22

## Context

Forge needs a narrow standards-based boundary through which another host can
discover and invoke read-only evidence capabilities. Implementing JSON-RPC framing,
negotiation, schemas, cancellation plumbing, and stdio lifecycle by hand would add
a second protocol surface unrelated to Forge's product differentiation.

## Decision

Use exact-pinned `@modelcontextprotocol/sdk` 1.29.0 with exact-pinned Zod 4.4.3 and
the stable v1 stdio server/client APIs.

MCP remains a host adapter. Forge run, context, evidence, approval, and artifact
contracts do not import MCP types. The adapter exposes exactly seven read-only
tools for inventory, literal search, bounded reads, declarations, TypeScript
diagnostics, Git status, and Git diff.

Each tool declares an output schema. The adapter keeps the internal `RunArtifact`
unchanged while returning compact tool-specific evidence. Results expose:

- a unique MCP `invocationId` for the host call;
- the Forge `runId` that produced evidence;
- `sourceRunId` when read evidence is replayed from the bounded session cache;
- snapshot identity, complete workspace-relative paths, bounded evidence, and
  ordered event type/sequence pairs.

No HTTP listener, credentials, sampling, elicitation, MCP tasks, resources,
prompts, write capability, process capability, or network capability is enabled.

## Consequences

- VS Code and other MCP clients can use the same Forge evidence runtime.
- SDK upgrades remain adapter decisions and require official-client conformance.
- Human-readable `content` and `structuredContent` currently duplicate some
  evidence because host compatibility has not yet justified removing either form.
- Windows VS Code MCP processes run with the developer's permissions; read-only
  capability design is not represented as an OS sandbox.

## Rejected alternatives

- Hand-written JSON-RPC/MCP framing.
- MCP v2 pre-release packages during this slice.
- HTTP transport before authentication and network-policy requirements exist.
- A VS Code extension before proving the host-neutral MCP boundary.
- Returning the complete internal event payload to every host by default.

## Acceptance gate

1. The official SDK client starts the source and built stdio server.
2. Exactly seven intended tools are discoverable with read-only annotations and
   output schemas.
3. Every successful handler result carries invocation, run, snapshot, evidence,
   and compact trace identity.
4. Covered cache replay returns inline citation evidence, a new invocation ID,
   and the original evidence run ID.
5. Malformed input is an MCP tool error without crashing the server.
6. Controlled VS Code prompts complete without artifact externalization.
7. The strict check/build suite remains green.
