# Checkpoint 53: live CLI local gate

**Date:** 2026-08-03
**Branch:** `feature/cli-live-loop`
**Base:** `develop@e865de51aef940604d9e7e85a982fc93718bef9e`

## Implemented boundary

Forge now exposes two presentation-only observation paths without adding a runtime:

1. validated normalized provider events for ephemeral assistant text; and
2. canonical `RunEvent` records streamed by the selected runtime authority.

The CLI installs those observers only in human mode. `--json` retains one terminal
artifact. Rust still owns lifecycle ordering, policy, tool execution, budgets,
cancellation, and terminal evidence. The terminal summary is computed only from the
returned `RunArtifact`.

Ctrl+C and timeouts now converge on one abort controller. The first interrupt asks
the active Forge run to cancel; the configured deadline uses the same path. Human
mode maps attributable interrupt cancellation to exit 130 and deadline cancellation
to exit 124.

## Local proof

- Focused observer/presenter/cancellation tests: 8/8 passed.
- Full `npm run check`: typecheck, 52/52 tests, and build passed.
- The exact hosted Windows kernel from accepted inference commit `cf26d85` passed
  the current product probe. `git diff cf26d85 -- crates` was empty.
- Live Ollama/Qwen text:
  - run `run:27a527ca-8604-4c1b-96ca-bb939133c67b`;
  - one inference turn, four canonical events, output `FORGE_LIVE_OK`.
- Live Ollama/Qwen bounded tool continuation:
  - run `run:0cf52f68-6a9a-454f-b3d4-a75405f0666a`;
  - two inference turns, one successful `workspace.read`, eight events;
  - output `FORGE_TOOL_OK`.
- Live 100 ms deadline:
  - run `run:39e1b04e-95ab-48fa-8e47-47bf1142a82a`;
  - canonical `run.cancelled`, process exit 124, zero remaining kernel processes.
- Live JSON mode parsed as one artifact and contained no human prefix.

## Complications found and resolved

- The fresh worktree initially had no Node dependencies; `npm ci` restored the
  exact lockfile state.
- Managed Windows test execution denied Node worker and kernel child spawning with
  `EPERM`; the established test-only elevation allowed validation without changing
  Forge permissions.
- The planner initially inherited the collector's raw callback option name. It now
  accepts only `now` from collector options and exposes one attributed
  `onInferenceEvent` observer, avoiding two ambiguous public observer contracts.
- stdout and stderr may be grouped differently by capture tools. That visual order
  is explicitly non-authoritative; the Rust artifact remains the ordered record.

## Hosted gate

Draft PR #17 at `d5ac3d7` passed Node 22 on Windows/macOS in run
`30854109399` and the full Rust-kernel-plus-TypeScript product matrix on
Windows/macOS/Ubuntu in run `30854109588`.

## Remaining gate

Controlled VS Code validation is still required. The exact worktree is open, but
VS Code initially placed the new folder in Restricted Mode; the developer must make
that Workspace Trust decision before Copilot or MCP can run. A real OpenAI request
is deliberately not part of this checkpoint. Work must pause
at that gate until the developer configures `OPENAI_API_KEY`.
