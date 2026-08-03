# CLI ship lane 3: live CLI loop

**Status:** live-loop, Qwen, interactive DX, and controlled VS Code gates green; bounded host-authority race correction awaits hosted rerun; credentialed OpenAI gate pending
**Branch:** `feature/cli-live-loop`
**Base:** merged real-inference `develop` at `e865de5`

## Objective

Turn the accepted provider-backed run into a useful interactive developer experience
while preserving the Rust kernel as the only runtime and terminal evidence authority.

See [ADR-0019](../decisions/ADRs/ADR-0019-ephemeral-live-cli-presentation.md) and
[Checkpoint 52](../decisions/checkpoints/2026-08-03-52-live-cli-start.md) and
[Checkpoint 53](../decisions/checkpoints/2026-08-03-53-live-cli-local-gate.md),
[ADR-0020](../decisions/ADRs/ADR-0020-explicit-local-context-and-provider-evidence-projection.md),
[Checkpoint 54](../decisions/checkpoints/2026-08-03-54-qwen-context-and-outcome-hardening.md),
[ADR-0021](../decisions/ADRs/ADR-0021-ephemeral-interactive-shell.md),
[Checkpoint 55](../decisions/checkpoints/2026-08-03-55-interactive-cli-local-gate.md),
and [Checkpoint 56](../decisions/checkpoints/2026-08-03-56-low-compute-model-floor.md).
The post-gate concurrency correction is recorded in
[Checkpoint 57](../decisions/checkpoints/2026-08-03-57-host-authority-replay-race.md).

## In scope

- Let plain forge enter an interactive prompt loop with discoverable provider,
  model, and workspace state.
- Stream validated provider text in human CLI mode.
- Render canonical run, context, inference, tool, approval, result, cancellation,
  failure, and budget events without exposing a second event contract.
- Preserve a single terminal JSON document under `--json`.
- Route Ctrl+C and timeout through the existing abort/bridge cancellation path.
- Print a terminal evidence summary from the authoritative `RunArtifact`.
- Prove the existing multi-turn provider/tool continuation with Ollama/Qwen.

## Non-goals

- Durable restart-resume or cross-process conversation state. The in-process
  interactive prompt loop is now in scope.
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
   evidence summary, and the measured local context does not silently clip the tool
   continuation.
7. Node/Rust checks, hosted Windows/macOS/Ubuntu, and controlled VS Code tether
   remain green before merge.
8. Execution pauses before the first live OpenAI request and reports the exact
   project-key environment setup required from the developer.
9. A developer can launch plain forge, see effective provider/model/workspace state,
   prompt repeatedly, and use help, status, model, clear, and exit controls without
   reconstructing the one-shot command on every turn.

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
- npm run check passed 57 tests, typecheck, and the production build.
- Ollama now declares an 8K context and uses deterministic agent sampling; bounded
  read evidence is projected compactly for the provider while the internal artifact
  remains unchanged.
- Printed tool-protocol envelopes fail closed instead of becoming false successful
  answers. ADR-0020 and Checkpoint 54 record the decision and live evidence.
- Plain forge now auto-discovers a local Ollama model, shows effective state, accepts
  repeated prompts and slash controls, and maps every prompt to a separate canonical
  run. ADR-0021 and Checkpoint 55 record the boundary and live two-prompt proof.
- A 0.5B/1.5B/3B/7B Qwen ladder exposed locator-only pseudo-context. Provider
  messages now send counts rather than unsupported path evidence. The measured 7B
  one-read input fell about 29.5% while remaining 3/3 grounded. Checkpoint 56
  records the bounded floor; automatic model routing remains deferred until
  outcome verification can support safe escalation.
- A fresh controlled VS Code Agent test with exactly seven Forge tools selected
  completed with one summary call, no recovery loop, and the canonical six-event
  order. The extension host required the Rust kernel at its normal discovery path;
  it did not inherit a terminal-only environment override.
- Draft PR 17 passed Node on Windows/macOS and the real Rust-kernel/TypeScript
  product on Windows/macOS/Ubuntu at commit `5326122`.
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

The expanded implementation at `5326122` again passed all five jobs. A following
checkpoint-only head exposed the host-authority replay race on macOS. Checkpoint 57
records the bounded correction; its hosted matrix is now the acceptance authority.
The controlled seven-tool VS Code MCP regression already passed with one Forge call
and no recovery loop.

## Remaining acceptance

- Pass the corrected host-authority regression and full product matrix on hosted
  Windows, macOS, and Ubuntu.
- Exercise a real terminal Ctrl+C gesture where the host permits controlled input;
  deterministic SIGINT and live timeout coverage are already green.
- Pause before any live OpenAI request and wait for developer key configuration.

## Honest limits

- stdout assistant text and stderr lifecycle status are intentionally separate;
  redirected log collectors may display those streams in a different visual order.
  The Rust event trace, not terminal interleaving, defines canonical order.
- The interactive shell repeats independent attributable tasks; it does not yet
  carry inspected conversation context across prompts. Durable restart-resume and
  cross-prompt memory remain later.
- Runtime status completed means a valid terminal turn, not proof that every model
  claim is grounded. A two-tool Qwen stress case stopped early and hallucinated;
  explicit outcome verification remains required.
- Provider-driven mutation, interactive approvals, and recovery remain later ship
  lanes.
- This does not add an OS sandbox or change the trusted-execution posture.
