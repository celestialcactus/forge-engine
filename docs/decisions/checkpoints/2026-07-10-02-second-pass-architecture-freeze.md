# Checkpoint 2026-07-10-02: Second-pass architecture freeze

- **Status:** in-progress
- **Date:** 2026-07-10
- **Related ADRs:** ADR-0001 (reopened for review)
- **Scope:** stop implementation and revise the product audit and V1 plan under deeper reasoning

## Objective

Ensure reconstruction derives from the complete product thesis and source-level evidence rather than the prototype or an overly narrow first slice.

## Changes

- Wrote and validated a provisional deterministic kernel, then froze it.
- Migrated a verified copy to `C:\dev\forge-engine` after OneDrive reacted to dependency cleanup.
- Shallow-cloned Hermes Agent, Headroom, and Codex to `C:\tmp` for read-only research.
- Added a second-pass product/reference audit and revised reconstruction plan.

## Findings that changed the plan

- Context economics is a first-class subsystem with invariants and quality evaluation.
- Skills and memory require distinct lifecycle, scope, provenance, and evaluation.
- Developer delight requires streaming, cancellation, artifacts, and lifecycle events early.
- CLI and MCP require host-conformance tests over one kernel.
- V1 must validate manually authored skills, bounded memory, context transforms, and local/cloud paths; a toy loop is insufficient.
- Graph relationships begin as rebuildable projections, not a primary graph database.
- Production isolation may later justify platform components outside TypeScript.

## Validation performed

| Experiment | Result |
|---|---|
| Repository history inspection | confirmed single-commit prototype implementation |
| Hermes source inspection | agent, context, memory, skills, toolsets, providers, sessions reviewed |
| Headroom source inspection | transforms, CCR, cache, proxy, policy, providers, benchmarks reviewed |
| Codex source inspection | rollout, app-server, tools, MCP, persistence, sandbox structure reviewed |
| Claude Code and VS Code official documentation | lifecycle, context, subagent, MCP, and host patterns reviewed |

## Framework and service inventory

No new ForgeEngine framework or service was adopted. Research repositories are temporary and are not dependencies.

## Next checkpoint

Review the second-pass audit and revised plan with the project owner. Implementation remains frozen until Phase 0 specifications and the ADR backlog are accepted.
