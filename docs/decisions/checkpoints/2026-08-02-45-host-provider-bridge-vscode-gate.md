# Checkpoint 45: host provider bridge VS Code tether gate

- **Date:** 2026-08-02
- **Branch:** `feature/slice-2f2b-host-provider-bridge`
- **Head before this documentation checkpoint:** `b1eac08`
- **Task:** [Slice 2F-2b](../../tasks/SLICE-002F2B-host-provider-bridge.md)
- **Result:** VS Code tether accepted; hosted native acceptance remains open

## Controlled scenario

VS Code 1.131.0 opened the exact feature worktree as a trusted workspace. Its
workspace MCP configuration discovered seven Forge tools. All built-in and
unrelated extension tools remained unselected. A fresh Agent chat received this
bounded prompt:

> Use only Forge tools. Call Forge Workspace Summary exactly once with maxFiles
> 20. Report the Forge run ID, snapshot ID, total file count, truncation status,
> and ordered event sequence. Do not use any built-in tools and do not modify
> files.

## Evidence

- Exactly one Forge call: `forge_workspace_summary` with `maxFiles: 20`.
- No built-in tool call, recovery query, retry, or artifact externalization.
- Run: `run:859f6ea9-86a2-4cbe-a082-a4f983449654`.
- Snapshot: `workspace:8bd7b47cfdf4b512`.
- Total files: 267; truncated: true.
- Event sequence: `run.started` -> `context.planned` ->
  `capability.requested` -> `approval.decided` ->
  `capability.completed` -> `run.completed`.
- Post-test Git status: clean; the read-only scenario did not mutate the worktree.

## Decision

The Slice 2F-2b changes preserve the accepted MCP/VS Code read-only contract. This
closes the local IDE-tether gate only. Native Rust execution and the authenticated
host provider's Windows/macOS/Ubuntu CI matrix remain authoritative for final
slice acceptance, so core completion stays at 94% and Slice 2F-3 does not branch
from this topic head.