# Checkpoint 52: live CLI start

**Date:** 2026-08-03
**Branch:** `feature/cli-live-loop`
**Base:** `develop@e865de51aef940604d9e7e85a982fc93718bef9e`

## Starting evidence

- PR #16 merged the provider-neutral inference path after local, exact-kernel,
  hosted Windows/macOS/Ubuntu, live Ollama, and controlled VS Code gates.
- `ProviderTaskPlanner` already supports bounded multi-turn tool continuation.
- Provider adapters already expose normalized text and tool deltas, but
  `collectProviderInference` buffers them until a turn completes.
- `RustKernelRuntime` already streams canonical ordered `RunEvent` records through
  an `onEvent` callback, but `ForgeWorkspaceService.executeTask` and the CLI do not
  expose that callback.
- `forge run` currently uses `AbortSignal.timeout`; it does not deliberately map
  Ctrl+C to an attributable bridge cancellation.
- Human mode prints only after the terminal artifact. JSON mode is currently one
  valid terminal document and must remain so.

## Boundary

This increment adds an ephemeral presentation observer and cancellation wiring,
not a runtime. Provider deltas are useful display material only after existing
validation. Rust events and the terminal `RunArtifact` remain the evidence record.
See [ADR-0019](../ADRs/ADR-0019-ephemeral-live-cli-presentation.md).

## Credential pause

Ollama/Qwen requires no secret and remains the live test provider. No live OpenAI
request will be sent in this increment until the developer explicitly confirms a
project-scoped API key is available through `OPENAI_API_KEY`. The key must not be
accepted as a CLI argument, written to logs, or recorded in evidence.

## Next proof

First prove event observation, human streaming, JSON isolation, and cancellation in
deterministic tests. Then run the exact product CLI with Qwen before hosted and VS
Code gates.
