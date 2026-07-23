# Checkpoint 04: research validation and build gate

**Date:** 2026-07-10
**Status:** accepted
**Decision owner:** ForgeEngine project

## What we decided

We validated the second research pass and selected a disciplined V1 path:

- Build Forge around an event and artifact kernel, deterministic workspace evidence,
  a context compiler, capability virtualization, and replayable runs.
- Treat local/cloud execution, MCP host integration, and enterprise controls as
  adapters around that kernel.
- Start implementation with the protocol, fixture suite, and a read-only
  deterministic vertical slice.
- Defer compression proxies, graph databases, automatic learning, routing, and
  heavy sandbox claims until each has a Forge-specific benchmark or platform spike.

## Why

The cited projects agree on several durable principles—lifecycle semantics,
deterministic developer tools, bounded context, durable trajectories, and selective
capabilities—but they differ substantially in execution model and integration
assumptions. Copying their architecture wholesale would recreate the prototype's
main mistake: surface resemblance without a coherent kernel.

The first slice establishes the contracts that every later feature will need and
can be validated without credentials, vendor APIs, a production database, or an
unsafe execution path.

## What this changes in practice

Implementation does **not** resume by adding providers, shell tools, or MCP
dependencies. It begins with:

1. event/state/error/cancellation definitions;
2. golden traces and a small fixture workspace;
3. deterministic read/search/git evidence adapters;
4. a scripted provider and read-only capability flow;
5. run/context/artifact inspection tests.

## Readiness score

- Ready for the protocol + read-only vertical slice: **91 / 100**.
- Ready for all V1 work as one uninterrupted sprint: **69 / 100**.

This is a clear go for the first slice and a clear no-go for starting every V1
integration at once.

## Risks retained

- Windows process/worktree isolation is not yet designed or proven.
- VS Code's target MCP feature set must be checked against the actual supported
  client/version before integration.
- Local and cloud provider tool/cancellation behavior cannot be assumed equal.
- Any context transform may lower task quality; it remains opt-in until fixture
  evaluation proves otherwise.

## Evidence and linked records

- [Research validation](../../audit/research-validation.md)
- [Validated V1 build plan](../../architecture/forgeengine-v1-validated-build-plan.md)
- [Capability radar](../../audit/capability-radar.md)
- [Second-pass audit](../../audit/second-pass-product-reference-audit.md)
- [Decision documentation policy](../README.md)

## Next checkpoint trigger

Create the next checkpoint when the Slice 0 protocol is accepted, revised, or
rejected after its golden trace suite is running.
