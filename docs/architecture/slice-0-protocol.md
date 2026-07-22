# Slice 0 protocol: golden-run contract

**Status:** implementation contract
**Date:** 2026-07-10
**Scope:** the first executable ForgeEngine V1 vertical slice

## Purpose

Slice 0 proves that Forge can run a small developer workflow as an inspectable,
host-neutral record before it talks to a real model, modifies a repository, or
depends on an IDE. It is a protocol test, not a mock user interface.

## Run model

```text
RunRequest
  -> WorkspaceSnapshot (immutable fixture evidence)
  -> ContextPlan (bounded, attributable selection)
  -> TaskPlanner (scripted in Slice 0)
  -> approval decision
  -> read-only capability result
  -> RunArtifact (ordered events + final state)
```

The logical event `sequence` is the authoritative order. The core intentionally
does not write wall-clock time into a golden trace; an MCP, CLI, IDE, or telemetry
host can attach time outside the semantic event record.

## Contract rules

| Concern | Slice 0 rule |
| --- | --- |
| Run identity | The caller supplies `runId`; fixtures therefore reproduce exactly. Production ID generation belongs to a later host/store adapter. |
| Workspace identity | Every run uses an immutable `WorkspaceSnapshot` with an ID and deterministic file inventory. Real filesystem hashing is later evidence-adapter work. |
| Context | The developer task is authoritative. If it cannot fit the supplied budget, Forge ends in `budget_exhausted`; it may not silently discard the task. |
| Context selection | Files are sorted by path and selected transparently. No lossy transformation, semantic retrieval, or compression runs in Slice 0. |
| Capability lifecycle | Every requested capability has a request, approval decision, and completed result event—even if denied, unknown, or failed. |
| Cancellation | A cancellation observed before terminal state creates `run.cancelled`. A cancellation received after `run.completed` changes nothing. |
| Failure | A capability failure is evidence returned to the planner; a runtime failure creates `run.failed`. Neither corrupts event ordering. |
| Artifacts | A `RunArtifact` contains schema version, input task/snapshot, status, context plan, capability results, optional output, and all ordered events. |

## Golden success trace

For the `slice0Workspace` fixture and `Inspect the workspace.` task, the success
path is exactly:

```text
1 run.started
2 context.planned
3 capability.requested
4 approval.decided
5 capability.completed
6 run.completed
```

The test suite also fixes the shape of denied approval, capability failure,
budget exhaustion, pre-start cancellation, and post-completion cancellation.

## Deliberate exclusions

- real local/cloud model provider adapters;
- mutable files, shell/process execution, worktrees, or rollback;
- SQLite persistence, timestamps, or generated IDs;
- MCP transport, VS Code integration, network, or a security sandbox;
- context compression, embeddings, a graph, skills, or memory.

These features must adapt this protocol rather than redefining it.

## Source locations

- `src/slice0/contracts.ts` — protocol types and trace-equivalence helper
- `src/slice0/context.ts` — deterministic transparent context selection
- `src/slice0/runtime.ts` — run coordinator
- `src/slice0/fixtures.ts` — deterministic fixture collaborators
- `tests/slice0-runtime.test.ts` — executable conformance cases

## Slice exit criteria

Slice 0 is accepted only when `npm run check` passes and the golden trace suite
demonstrates repeatable success, denial, capability failure, budget exhaustion,
and cancellation without relying on a real provider or host-specific runtime.
