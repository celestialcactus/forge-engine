# Slice 1 closure audit

**Date:** 2026-07-22
**Verdict:** accepted after corrective consolidation
**Audited authority:** `docs/architecture/forgeengine-v1-validated-build-plan.md`

## Straight assessment

The read-only evidence capabilities and VS Code tether were useful and largely
correct, but Slice 1 was not ready to commit at the start of this audit. Passing
tests concealed a split runtime architecture, a misleading CLI command, one
inconsistent filesystem boundary, ambiguous cache-call identity, and stale public
documentation.

All blocking findings were corrected before acceptance. The remaining issues are
explicit scale or hardening gates rather than contradictions of the Slice 1 user
outcome.

## Objective matrix

| Objective | Evidence | Verdict |
| --- | --- | --- |
| One kernel, many hosts | `ForgeRuntime` and `Slice0Runtime` resolve to the same implementation; the provisional alternate stack was removed. | Pass |
| Scripted read-only `forge run` | CLI preserves the developer task and executes an explicit inventory plan through `ForgeWorkspaceService` and the accepted runtime. | Pass |
| Deterministic trace and context plan | Fixed run ID plus identical task/snapshot inputs reproduce the same real-adapter trace, context plan, and capability result. | Pass |
| Evidence before prose | Inventory, search, reads, declarations, diagnostics, Git status, and Git diff are deterministic adapters. | Pass |
| Bounded and attributable results | Size/count bounds, snapshot/run IDs, complete paths, line records, SHA-256 read identity, and truncation signals are tested. | Pass |
| Host-neutral artifact | CLI, service, and MCP all originate from the same `RunArtifact`; MCP performs only a purpose-shaped projection. | Pass |
| Inspectable host calls | Every successful MCP handler response has a unique invocation ID; cache replay retains source run provenance. | Pass |
| Read-only workspace boundary | No write/generic process/network tool exists; content paths are selected from the snapshot and canonically revalidated. | Pass |
| VS Code apprentice usability | Seven-tool controlled tests completed without artifact externalization; the final briefing used five calls and one file read. | Pass |
| Package viability | Production build, package dry run, package self-import, CLI subprocess, and official MCP client are validated. | Pass |

## Blocking findings and disposition

### 1. Competing runtime stacks — fixed

The earliest reconstruction added a provider/session runtime with a different event
and capability vocabulary. The later golden-run kernel powered the actual CLI/MCP
service. Keeping both would have made future providers, persistence, and approvals
choose between incompatible authorities. The provisional stack and its isolated
tests were removed; the accepted runtime now has one public facade.

### 2. `forge run` ignored its task — fixed

The command validated that a task existed and then discarded it by calling
`inspect()`. It now passes the exact developer task into a deterministic read-only
plan. A subprocess regression inspects the resulting `run.started` event.

### 3. Search did not revalidate canonical paths — fixed

Read and declaration adapters revalidated real paths after snapshot selection, but
literal search reopened paths directly. Search now uses the same canonical helper,
and a forged-snapshot regression proves it cannot read outside the workspace.

### 4. Cache replay conflated run and invocation identity — fixed

Replayed evidence correctly belongs to the original evidence-producing run, but a
later MCP call is still a distinct host interaction. MCP results now carry a unique
`invocationId`; replay retains the original `runId` and declares `sourceRunId`.

### 5. Text decoding was weaker than the documented boundary — fixed

NUL detection alone is not UTF-8 validation. Read, search, and declaration adapters
now reject or skip invalid UTF-8. A no-NUL invalid byte fixture covers the case.

### 6. Public state and package surface were stale — fixed

The README claimed MCP did not exist, ADR-0002 described two tools, and the package
exported both runtime stacks through an irregular nested fallback array. Public
documentation now describes the actual seven-tool slice and the package exposes a
single conventional root entrypoint.

## Controlled VS Code evidence

- Initial workspace summary exposed an oversized 47,924-byte generic artifact,
  causing host externalization and retry loops.
- Tool-specific projection reduced the measured summary response to 2,539 bytes
  while preserving the internal artifact.
- Citation-ready line evidence and tighter tool bounds reduced the controlled
  search/read task to exactly two calls.
- Final controlled briefing completed with exactly five Forge calls, one bounded
  read, no guessed path, no overlapping reread, and all five run IDs reported.
- A stale VS Code process caused unrelated network suspension; restarting into the
  updated host restored model and MCP operation. No Forge call occurred during the
  blocked attempts.

These observations validate adapter-specific presentation, but they do not claim
Forge controls every host model's planning behavior.

## Accepted debt and next gates

| Deferred issue | Why it does not block Slice 1 | Required future gate |
| --- | --- | --- |
| Synchronous cold TypeScript diagnostics | Results are correct and bounded; latency/cancellation are scale defects. | Worker isolation, hard timeout, p50/p95 budget. |
| Full workspace scans | Small/medium fixtures and bounded reuse work. | Indexed/watch-invalidated evidence service benchmark. |
| Buffered Git output | Current evidence is read-only and bounded for normal repositories. | Streaming byte-counted adapter for large diffs. |
| Path/size snapshot identity | Inventory identity is deterministic; reads have content SHA-256. | Content-aware snapshot manifest before replay/durable state claims. |
| MCP text/structured duplication | Required fields are usable in tested VS Code. | Host compatibility experiment before removal. |
| No OS sandbox | Slice 1 exposes no mutation or generic execution. | Platform enforcement spike before mutation/execution claims. |

## Final gate

Slice 1 is accepted only with all of the following green in the exact commit
candidate:

- strict typecheck;
- all automated tests;
- production build;
- CLI smoke and task-preservation subprocess;
- official MCP client discovery/invocation;
- package dry run and package self-import;
- `git diff --check`;
- staged scope contains no Slice 2 mutation/proposal implementation.
