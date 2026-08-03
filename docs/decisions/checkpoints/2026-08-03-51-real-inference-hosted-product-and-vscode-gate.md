# Checkpoint 51: real inference hosted, product, and VS Code gate

**Date:** 2026-08-03
**Branch:** `feature/cli-real-inference`
**Implementation head:** `cf26d85bfcabc0fd38c85bfb0267ca24d8295dff`
**Pull request:** draft PR #16
**Status:** accepted on feature branch; merge pending

## Decision

Accept CLI ship lane 2 on the feature branch. The product now has one measured local
provider family and one direct cloud transport behind the existing planner seam,
while Rust remains the sole product authority for policy, budgets, ordered events,
capability execution, and the terminal run artifact. This slice did not introduce a
provider runtime, second event hierarchy, or parallel orchestration layer.

Proceed to the live CLI loop only after PR #16 merges into `develop`. The next lane
must present normalized provider deltas and canonical Rust run events without
turning presentation callbacks into a second source of truth.

## Hosted cross-platform gate

- Node workflow `30848081978` passed on hosted Windows and macOS.
- Hybrid workflow `30848081363` passed on hosted Windows, macOS, and Ubuntu.
- The hybrid workflow covered Rust formatting, lint, tests, and release build;
  49 Node tests, typecheck, and production build; hybrid contracts; product smoke;
  release-artifact upload; and the bridge benchmark.
- Hosted failures found two stale assumptions rather than product failures: one
  test still expected the removed fake no-provider `forge run`, and another tested
  the removed public `forge candidate` surface. The duplicate 39-line candidate
  fixture was deleted and the smoke assertion now exercises canonical `inspect`.
- A replacement assertion initially confused the compact MCP host projection with
  authoritative CLI inventory evidence. It was corrected to assert the real CLI
  artifact rather than widening or duplicating the contract.

## Exact Windows artifact product gate

The Windows release artifact built at the exact implementation head was downloaded
and used as `target/release/forge-kernel.exe` for local product checks.

- `forge doctor --json` reported the required Rust kernel bridge v3.
- Product inspection completed as run
  `run:c124a675-2418-4011-a7ee-a1f6e0287398` and inventoried 293 files.
- Live Ollama text execution completed as run
  `run:b74a974b-2d9f-4dad-a6f5-6324857a4bb0`, returned exact
  `FORGE_CLI_OK`, recorded one inference, used 937 input and 5 output tokens, and
  took 14.037 seconds. Its ordered trace was `run.started`, `context.planned`,
  `inference.completed`, `run.completed`.
- Live bounded one-tool execution completed as run
  `run:5bba5b4a-6518-4186-9184-e261165fc3ae`, returned exact `forge-engine`,
  used Ollama `qwen2.5-coder:7b`, and recorded two inference results plus one
  successful capability result for `package.json`. Finish reasons were
  `tool_call` then `stop`; usage was 2,874 input and 37 output tokens; elapsed time
  was 1.671 seconds. Its ordered trace was `run.started`, `context.planned`,
  `inference.completed`, `capability.requested`, `approval.decided`,
  `capability.completed`, `inference.completed`, `run.completed`.

## Controlled VS Code tether gate

The trusted exact worktree was opened in VS Code. The workspace MCP server started
from `.vscode/mcp.json`, reported `Running`, and discovered seven tools. Configure
Tools showed exactly those seven Forge tools selected and all built-in tools
unselected.

The fresh Agent prompt required exactly one `Forge Workspace Summary` call with
`maxFiles: 20`, no built-ins, and no mutation. The run completed in four seconds
using exactly that one call:

- run ID: `run:9ee01e26-50ab-455f-9732-279356e3f0f6`
- snapshot ID: `workspace:faef0eda47f1cc20`
- total files: 293
- truncated: `true`
- ordered events: `run.started`, `context.planned`, `capability.requested`,
  `approval.decided`, `capability.completed`, `run.completed`

There was no built-in tool call, repository mutation, retry, externalized artifact,
or stall. This is an MCP tether and host-presentation regression; the provider path
itself was accepted through the product CLI and exact Rust kernel artifact.

## Honest limitations

- `OPENAI_API_KEY` was absent. The OpenAI Responses adapter passed deterministic
  SSE/request/error conformance, but this checkpoint does not claim a live cloud
  acceptance run.
- Normalized provider streams are currently collected before the CLI renders the
  final artifact. The interactive streaming turn lifecycle, explicit cancellation
  UX, multi-turn continuation, and final human evidence summary are CLI ship lane 3.
- MCP remains a seven-tool read-only evidence surface. No public MCP mutation tool,
  unrestricted write capability, or generic shell was added.
- No Forge-enforced OS sandbox exists. `restricted` remains fail-closed; trusted
  execution retains the invoking process's operating-system authority.
- The local managed Codex sandbox rejects some child-process spawns with `EPERM`;
  full Node validation therefore ran outside that sandbox under the approved test
  command. This is a validation-host restriction, not a Forge policy result.
- This workstation lacks the MSVC linker and Windows SDK import libraries. Native
  Rust compilation was supplied by the exact hosted Windows release artifact.

## Closure

CLI ship lane 2 satisfies its exit gates without weakening the canonical runtime
boundary or preserving superseded public surfaces. PR #16 may be reviewed and
merged. The next feature branch must begin from the merged `develop` head and focus
on the live CLI lifecycle, not reopen kernel ownership or add another runtime.
