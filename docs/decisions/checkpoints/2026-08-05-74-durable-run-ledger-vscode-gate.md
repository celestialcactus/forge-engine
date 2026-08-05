# Checkpoint 74: durable run ledger passes the controlled VS Code gate

**Date:** 2026-08-05
**Branch:** `feature/cli-run-recovery`
**Implementation:** `88501dc`
**Scope:** CLI ship-lane increment 6A; hosted Windows/macOS/Ubuntu acceptance pending

## Controlled host result

- Opened the exact committed feature worktree in a separate VS Code window and
  trusted that worktree explicitly.
- Started the workspace `forge-engine` MCP server from
  `.vscode/mcp.json`. VS Code reported `Running` and `Discovered 7 tools`.
- Selected exactly the seven Forge tools and no built-in tools.
- In one fresh Agent chat, submitted the established one-call acceptance prompt:
  `Forge Workspace Summary` with `maxFiles: 20`, no mutation, and no fallback
  tools.
- Copilot made exactly one Forge call and completed in three seconds. It reported:
  - run `run:586c51b7-aaa8-4a13-a130-39df602110df`;
  - snapshot `workspace:a06234af4bd45e68`;
  - 353 total files and `truncated: true`;
  - `outcome.status: verified` and `runStatus: completed`;
  - the exact seven-event order from `run.started` through `run.completed`.

## Recovery proof

After the MCP result completed, a separate CLI process ran:

```text
forge runs inspect run:586c51b7-aaa8-4a13-a130-39df602110df
```

It read the default `~/.forge/runs/v1` ledger through
`forge.kernel.run-store.v1` and returned:

```text
State: terminal
Recovery: return_terminal_artifact
Durable events: 7
Terminal status: completed
```

The inspection did not call the planner, provider, approval adapter, capability,
or MCP server. The non-JSON command is compact; `--json` intentionally exposes
the validated complete artifact for automation.

## Honest boundary

- This proves local Windows host symmetry and restart-independent terminal
  inspection for the exact commit. It does not substitute for hosted macOS or
  Ubuntu execution.
- Hosted Windows/macOS Node and Windows/macOS/Ubuntu hybrid matrices have not run
  because the saved GitHub CLI credential is currently invalid and the branch has
  not been published.
- Increment 6B remains unimplemented. Open or interrupted provider/tool work is
  still blocked rather than resumed or replayed.

## Next gate

Repair GitHub CLI authentication, publish `88501dc`, open the PR to `develop`, and
require both hosted matrices. Only then mark 6A accepted and begin the separately
specified 6B continuation transcript.
