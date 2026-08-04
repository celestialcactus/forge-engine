# Checkpoint 55: Interactive CLI local gate

**Date:** 2026-08-03
**Branch:** feature/cli-live-loop
**State:** local interactive gate passed; hosted, controlled VS Code, and live OpenAI gates pending

## Implemented

- Plain forge now enters an interactive prompt shell.
- With no route flags or default environment pair, Forge performs bounded local
  Ollama discovery and prints the selected provider/model before the first prompt.
- /help, /status, /model, /clear, and /exit are available.
- Each prompt reuses one consolidated provider-task helper but creates a separate
  planner and Rust-authoritative RunArtifact.
- forge run and --json remain the scripting surface.
- --help is now accepted, and ordinary startup/configuration failures print one
  concise message unless FORGE_DEBUG=1 is set.

See [ADR-0021](../ADRs/ADR-0021-ephemeral-interactive-shell.md).

## Complication found during validation

The first piped acceptance run exposed that promise-based readline could consume
buffered lines before the next question and leave top-level await unsettled. The
adapter was replaced with a queued line reader. This was a real CLI I/O bug; it did
not reach Qwen or the Rust kernel.

## Live acceptance

A no-route-flags session auto-selected ollama/qwen2.5-coder:7b, executed the
corrected one-read task, and exited cleanly:

- run:b21150f7-ab89-431a-9a41-f23468f4f223
- one workspace.read
- two inference turns
- grounded LiveCliPresenter, text.delta, and response.completed answer

A second plain-Forge process accepted two prompts without reconstructing command
flags:

- text run run:bc8f109c-751d-4737-b54e-7cb1575d71f0
- one-read run run:63b20187-41a5-428c-b09c-434b8ce718bd
- /status reported the second run as completed

The first cold tool turn took about 13.2 seconds. Warm turns in the second process
were about 0.6 to 0.9 seconds. This is honest latency evidence, not a performance
guarantee.

## Validation

- Focused CLI and interactive regressions passed.
- Full npm run check passed typecheck, 57/57 tests, and production build.
- The interactive implementation adds no Rust or protocol changes.

## Remaining gates

- Repeat the controlled seven-tool VS Code regression from this exact revision.
- Push and pass the hosted Windows/macOS Node matrix plus Windows/macOS/Ubuntu
  Rust product matrix.
- Pause before the first live OpenAI request for developer credential setup.
- Final packaging must make the Rust kernel discoverable without a source-tree
  environment override.
