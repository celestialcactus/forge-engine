# ADR-0018: Provider-neutral inference through the canonical planner bridge

**Status:** accepted for CLI ship lane 2
**Date:** 2026-08-03

## Context

Forge has one accepted product run authority: the Rust kernel. TypeScript already
supplies a `TaskPlanner` across the kernel bridge and owns host integration. The
repository does not yet contain a real model provider. Its public `forge run`
command is misleading because it executes only the workspace-inventory capability,
and the older public `forge candidate` commands duplicate the accepted
`forge change` transaction surface.

Adding a separate inference runtime, provider-owned agent loop, event log, policy
engine, or session model would reverse kernel convergence. Keeping obsolete public
commands would make the product harder to reason about and test.

## Decision

1. The Rust kernel remains the only run, policy, event-order, turn-budget, and
   terminal-artifact authority.
2. Provider inference implements the existing TypeScript `TaskPlanner` seam. It
   may translate provider streams, but it must not own a second run loop.
3. Provider adapters normalize text deltas, tool calls, finish state, usage, and
   bounded terminal evidence. Transient deltas are presentation; the terminal
   inference record crosses the bridge and is recorded by Rust.
4. Routing is explicit. The first local path is Ollama and the first cloud path is
   OpenAI Responses. Forge never silently falls back from local to cloud or between
   providers.
5. The first increment permits at most one tool call per model turn. Parallel or
   malformed calls fail visibly rather than being guessed into order.
6. Adapters use the Node 22 fetch/runtime surface with injected transports for
   deterministic conformance tests. A vendor SDK is not added until it proves a
   requirement the platform APIs cannot meet.
7. Provider credentials are read only from explicitly named environment variables,
   are never written into events/artifacts, and are not accepted as CLI arguments.
8. The public legacy `forge candidate` command, its CLI helpers, and its package
   exports are retired. The internal compatibility implementation may remain until
   its private callers are migrated.
9. `forge run` becomes a real, explicitly routed inference command. Product smoke
   uses `forge inspect` until the live inference gate is accepted.

## Consequences

- Rust continues to decide what happens; TypeScript can add providers quickly.
- Ollama and OpenAI share one planner/output contract without being forced into a
  lowest-common-denominator wire format.
- Live cloud acceptance is honestly blocked when no OpenAI credential is available;
  fixture conformance is not reported as a live provider pass.
- Removing duplicate public paths is part of this architectural increment, not a
  later cleanup project.

## Rejected alternatives

- A new `InferenceRuntime`: duplicates the accepted kernel authority.
- Provider-specific agent loops: split turn, budget, approval, and recovery logic.
- Implicit provider fallback: can cause unapproved egress and non-reproducible cost.
- Preserving obsolete CLI surfaces indefinitely: turns temporary prototypes into
  permanent product contracts.
