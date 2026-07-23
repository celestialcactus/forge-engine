# Slice 1: deterministic read-only repository intelligence

**Status:** accepted and closed
**Date:** 2026-07-22

## User-visible outcome

Forge can run a deterministic read-only workspace plan from its CLI and can act as
a repository-intelligence apprentice through a VS Code MCP host. Both paths use
the same host-neutral runtime and produce Forge `RunArtifact` records rather than
asking a model to pretend it inspected the repository.

The CLI's `forge run <task>` command preserves the supplied task and currently
executes an explicit inventory plan. It does not claim to infer an arbitrary plan
from natural language in this slice.

## One-kernel execution path

```text
CLI, MCP, or embedded caller
  -> host adapter validates arguments
  -> ForgeWorkspaceService obtains a bounded-reuse workspace snapshot
  -> ForgeRuntime compiles context and emits ordered lifecycle events
  -> an approved Forge-native evidence capability executes
  -> RunArtifact remains authoritative
  -> the host receives a purpose-shaped projection
```

The provisional session/provider runtime created during the earliest reconstruction
pass was removed at the closure audit. `ForgeRuntime` and `Slice0Runtime` are now
two exported names for the same implementation, not competing stacks.

## Capability set

| Forge capability | Evidence produced | Important boundary |
| --- | --- | --- |
| `workspace.inventory` | Canonical paths, sizes, snapshot ID, truncation | Skips `.git`, `.forge`, `dist`, `node_modules`, and symbolic links. |
| `workspace.search` | Literal file/line/preview matches | Canonical path is revalidated before each read; files over 1 MiB, NUL content, and invalid UTF-8 are skipped. |
| `workspace.read` | SHA-256 plus bounded line-numbered UTF-8 evidence | File must be a regular snapshotted path inside the canonical workspace root. |
| `workspace.symbols` | TypeScript/JavaScript declarations and locations | Syntactic declarations only; invalid UTF-8 and oversized files are skipped. |
| `typescript.diagnostics` | Structured compiler/config diagnostics | Compiler is forced to `noEmit`; work is synchronous and TypeScript-specific. |
| `git.status` | Branch and bounded porcelain status | Workspace must exactly equal the repository root. |
| `git.diff` | Bounded staged or unstaged diff | Optional locks, external diff, text conversion, and prompting are disabled. |

## Snapshot and evidence behavior

The connection-scoped snapshot service coalesces concurrent scans and reuses a
settled immutable snapshot for adjacent calls. Relevant filesystem events
invalidate reuse, a five-second ceiling forces a rescan, and unavailable recursive
observation falls back to scan-per-call behavior. Watch events are hints; the
canonical scan remains the source of repository inventory.

Read evidence includes SHA-256 content identity. The workspace snapshot ID still
hashes normalized paths and sizes, so it is a stable inventory identity rather than
a cryptographic content manifest.

## MCP projection boundary

The internal `RunArtifact` remains complete. The MCP adapter returns tool-specific
compact evidence, context counts, ordered event type/sequence pairs, `runId`,
`snapshotId`, and a unique `invocationId` for each host call. A covered read replay
may reuse evidence from its `sourceRunId`, but the invocation ID records that a new
MCP interaction occurred.

This separation was validated in VS Code: oversized generic artifacts caused host
externalization and retry loops, while citation-first projections allowed the same
briefing to complete with five justified calls and one file read.

## Trust boundary

Slice 1 is read-only by capability contract, not by OS containment. On Windows,
VS Code launches the MCP process with the developer's permissions. Forge exposes
no generic command tool, no file-write API, and no network capability in this
milestone.

## Accepted limitations

- TypeScript diagnostics rebuild compiler state synchronously and cannot be
  cancelled during compiler work.
- Search, symbols, and snapshot refresh remain full scans rather than a persistent
  content index.
- Git output is collected with a one-megabyte child-process buffer before Forge
  applies its smaller presentation bound.
- Snapshot identity is not a full content hash.
- Structured and human-readable MCP output duplicate some evidence for host
  compatibility.
- Declaration extraction is syntactic and TypeScript/JavaScript-only.
- Windows VS Code MCP processes are not OS-sandboxed.

These limits are explicit gates for later slices; none invalidates the bounded
read-only outcome accepted here.
