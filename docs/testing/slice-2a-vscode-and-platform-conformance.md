# Slice 2A VS Code and platform conformance

**Status:** Windows local pass with one host-composition exception; macOS runner pending
**Date:** 2026-07-22
**Branch:** `feature/SGU-002-v1-reconstruction-slice-2`

## Acceptance boundary

This record validates Slice 2A, not the complete Slice 2 developer-change loop.

Slice 2A is accepted only when Forge can produce a deterministic, digest-bound,
bounded proposal without mutating a workspace, and when that addition does not
silently expand the VS Code MCP surface beyond the accepted seven read-only tools.

Apply, verification, rollback, and recovery remain later Slice 2 gates.

## Local contract results

The focused proposal suite verifies:

- deterministic proposal identity for identical semantic inputs;
- unchanged source bytes after proposal;
- identity independent of diff presentation bounds;
- rejection of duplicate canonical targets;
- one aggregate diff budget across multiple files;
- all-or-nothing stale-digest conflicts;
- exact no-op reporting.

The worktree/process experiment verifies:

- candidate worktree edits leave the developer workspace unchanged;
- dirty source bytes do not silently become the detached worktree base;
- ignored local dependencies do not transfer;
- fixed, shell-free direct-child execution;
- bounded combined output with actual byte counts;
- distinct timeout and caller-cancellation outcomes.

## Controlled VS Code result

VS Code 1.129.1 was tested with Copilot Agent/Auto and only the Forge tool group
selected.

Tool inspection reported exactly seven selected tools:

1. `forge_git_diff`
2. `forge_git_status`
3. `forge_typescript_diagnostics`
4. `forge_workspace_read`
5. `forge_workspace_search`
6. `forge_workspace_summary`
7. `forge_workspace_symbols`

No proposal, apply, process, shell, write, or verification tool was exposed.

### Exact read prompt

```text
Use only Forge tools. Make exactly one call to Forge Read Workspace File for
src/v1/change-proposal.ts with startLine 1 and maxLines 40. Report the exact
workspace-relative path, SHA-256 digest, Forge run ID, returned line range, and
whether the evidence was truncated. Confirm whether any file was modified. Do not
use the terminal, built-in file search, or any non-Forge tool.
```

After explicitly restarting the workspace MCP server, Copilot:

- made exactly one Forge call;
- returned SHA-256
  `633b0c5305b29c62eb39a2f870cec269ef0342aed97aaf950ffd923210cda986`;
- returned run `run:a9dd585d-2fb7-446e-902f-3288975dc7a1`;
- reported lines 1-40 of 271 and `truncated=true`;
- reported no file modification;
- used no terminal, built-in search, or non-Forge tool.

Copilot shortened the final displayed path to `change-proposal.ts` instead of
`src/v1/change-proposal.ts`. Forge's content, structured schema, and tool
description all carry or require the complete path. This is a residual host
composition failure, so the exact-path criterion is partial rather than passed.

A pre-restart attempt also omitted the digest. Restarting the VS Code MCP server
corrected that result, which makes server refresh a required test preparation step.

## Cross-platform gate

`.github/workflows/cross-platform-conformance.yml` runs the locked Node 22 build
on `windows-latest` and `macos-latest`:

1. `npm ci`
2. `npm run check`
3. `npm run smoke`

The workflow executes the same proposal, MCP, Git-worktree, process-bound,
typecheck, build, and CLI tests on both operating systems.

A local Windows pass is not evidence of macOS compatibility. Slice 2A's macOS
criterion remains pending until the hosted `macos-latest` job completes
successfully on this branch.

## Acceptance summary

| Criterion | Result |
| --- | --- |
| Deterministic, non-mutating proposal | pass locally |
| Digest conflict and canonical-path protection | pass locally |
| Aggregate bounded diff evidence | pass locally |
| Worktree/process candidate behavior | pass on Windows |
| VS Code keeps seven read-only Forge tools | pass |
| VS Code exact read call and provenance | pass after restart |
| VS Code preserves complete relative path | partial; host shortened it |
| macOS conformance | pending hosted runner |
| Complete Slice 2 apply/verify/recover loop | not implemented |
