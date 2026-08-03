# CLI ship lane 3: live CLI loop

**Status:** implementation and hosted gates complete; VS Code and credentialed OpenAI gates pending
**Branch:** `feature/cli-live-loop`
**Base:** merged real-inference `develop` at `e865de5`

## Objective

Turn the accepted provider-backed run into a useful live developer experience while
preserving the Rust kernel as the only runtime and terminal evidence authority.

See [ADR-0019](../decisions/ADRs/ADR-0019-ephemeral-live-cli-presentation.md) and
[Checkpoint 52](../decisions/checkpoints/2026-08-03-52-live-cli-start.md) and
[Checkpoint 53](../decisions/checkpoints/2026-08-03-53-live-cli-local-gate.md).

## In scope

- Stream validated provider text in human CLI mode.
- Render canonical run, context, inference, tool, approval, result, cancellation,
  failure, and budget events without exposing a second event contract.
- Preserve a single terminal JSON document under `--json`.
- Route Ctrl+C and timeout through the existing abort/bridge cancellation path.
- Print a terminal evidence summary from the authoritative `RunArtifact`.
- Prove the existing multi-turn provider/tool continuation with Ollama/Qwen.

## Non-goals

- Persistent chat/repl state or restart resume.
- Mutation tools, generic shell, unrestricted writes, or public MCP mutation.
- Interactive approval callbacks or organization policy distribution.
- Provider fallback, model racing, parallel tool calls, or a new runtime.
- A live OpenAI claim before the developer configures `OPENAI_API_KEY`.

## Exit gates

1. Human output visibly streams before the terminal artifact is available.
2. Presentation observes only validated provider events and cannot alter planner or
   Rust decisions.
3. Canonical tool and lifecycle status comes from Rust `RunEvent` callbacks.
4. `--json` stays parseable and contains no streamed human text.
5. Ctrl+C and timeout produce attributable cancellation without leaving the kernel
   child alive.
6. A live Ollama/Qwen text task and one-tool multi-turn task complete with a final
   evidence summary.
7. Node/Rust checks, hosted Windows/macOS/Ubuntu, and controlled VS Code tether
   remain green before merge.
8. Execution pauses before the first live OpenAI request and reports the exact
   project-key environment setup required from the developer.

## Local implementation evidence

- `collectProviderInference` exposes only post-validation normalized events.
- `ProviderTaskPlanner` attributes each observation to an exact request, provider,
  and model without becoming a second coordinator.
- `ForgeWorkspaceService.executeTask` forwards the existing canonical runtime event
  observer to both the Rust product runtime and the TypeScript conformance fixture.
- Human CLI mode presents live text and canonical lifecycle status; JSON mode does
  not install either presentation callback.
- First SIGINT and the configured deadline use one abort controller. A live 100 ms
  deadline produced canonical cancellation, exit 124, and left zero kernel
  processes.
- `npm run check` passed 52 tests, typecheck, and the production build.
- The exact hosted Windows kernel from the accepted inference slice passed the
  bridge-v3 product probe; current Rust sources match that accepted revision.
- Live `qwen2.5-coder:7b` text and one-tool continuation both completed. The tool
  run used two inference turns, one `workspace.read`, eight canonical events, and
  a terminal evidence summary.
- Live JSON mode parsed as one terminal artifact and contained no `assistant>`
  prefix.

## Hosted acceptance

Draft PR #17 at `d5ac3d7` passed all five hosted jobs:

- Node 22 on Windows and macOS: run `30854109399`.
- Rust kernel plus TypeScript product gate on Windows, macOS, and Ubuntu: run
  `30854109588`.

## Remaining acceptance

- Repeat the controlled seven-tool VS Code MCP regression to prove no tether
  regression.
- Exercise a real terminal Ctrl+C gesture where the host permits controlled input;
  deterministic SIGINT and live timeout coverage are already green.
- Pause before any live OpenAI request and wait for developer key configuration.

## Honest limits

- stdout assistant text and stderr lifecycle status are intentionally separate;
  redirected log collectors may display those streams in a different visual order.
  The Rust event trace, not terminal interleaving, defines canonical order.
- This is a single-task live command, not a persistent chat REPL or restart-resume
  implementation.
- Provider-driven mutation, interactive approvals, and recovery remain later ship
  lanes.
- This does not add an OS sandbox or change the trusted-execution posture.