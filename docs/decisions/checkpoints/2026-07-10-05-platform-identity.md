# Checkpoint 05: Forge platform identity

**Date:** 2026-07-10
**Status:** accepted
**Decision owner:** ForgeEngine project

## Decision

ForgeEngine is being built toward an independently capable first-party CLI
development platform. Interoperability with Codex, Copilot, VS Code, and MCP hosts
is a strategic operating mode and V1 adoption path, not a permanent product limit.

V1 remains scoped to the validated vertical slices. The moonshot baseline is CLI
parity in the category of leading developer harnesses; the starshot is a wider
sovereign platform beyond developer workflows. Neither expands the current build
slice.

## Why this matters now

If the kernel assumed Forge always lived inside another host, later standalone CLI
work would force a second architecture: duplicated sessions, incompatible traces,
host-bound skills, and provider-specific capabilities. Treating Forge CLI as a
first-party host now avoids that lock-in without building all of its features now.

## Implementation effect

- Keep the CLI, MCP server, IDE adapters, and embedded SDK at the boundary of one
  host-neutral kernel.
- Require runs, context plans, artifacts, approvals, and sessions to be portable
  across host modes.
- Do not copy another CLI's feature list into V1. Add capabilities only through the
  vertical-slice gates and fixture-based acceptance criteria.

## Linked record

- [Platform direction amendment](../../architecture/forgeengine-platform-direction-amendment.md)
- [Validated V1 build plan](../../architecture/forgeengine-v1-validated-build-plan.md)
- [Research validation and build gate](2026-07-10-04-research-validation-and-build-gate.md)

## Next checkpoint trigger

Create a checkpoint when Slice 0's CLI host contract and golden event traces are
accepted, or if the first independent CLI workflow reveals a host-specific leak.
