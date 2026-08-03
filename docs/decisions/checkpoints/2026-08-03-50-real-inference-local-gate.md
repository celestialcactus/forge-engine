# Checkpoint 50: real inference local gate

**Date:** 2026-08-03
**Branch:** `feature/cli-real-inference`
**Status:** local adapter and TypeScript conformance gate passed; native hosted gate pending

## Accepted locally

- Provider transport implements the existing `TaskPlanner` seam. No inference
  runtime, provider-owned run loop, policy engine, event store, or session model was
  added.
- Rust and TypeScript share optional bounded inference evidence. Rust is designed to
  validate routing, finish state, cost posture, usage bounds, output size, and
  one-tool semantics before recording `inference.completed`.
- The run bridge is `forge.kernel.bridge.v3`; stale v2 kernels fail closed instead
  of accepting and silently discarding inference evidence.
- Ollama chat NDJSON and OpenAI Responses SSE normalize to one text/tool/usage/finish
  stream. Routing requires explicit provider and model and has no fallback.
- The seven evidence capabilities are now one reusable capability pack. The service
  has one planner/runtime composition path for fixed evidence calls and model-driven
  task execution.
- Public legacy `forge candidate` commands and package exports were removed. Unknown
  commands fail rather than returning successful help. The inventory-backed fake
  `forge run` was replaced by explicit provider-backed execution; product smoke now
  calls `forge inspect`.
- Shared verification configuration moved out of the legacy candidate runtime, so
  the accepted sovereign change path no longer imports that superseded adapter.
- Node uses the platform fetch implementation and injected fixture transports; no
  provider SDK or parallel abstraction was added.

## Validation evidence

- `npm run check`: passed typecheck, 49/49 tests, and production build.
- `cargo fmt --all -- --check`: passed.
- Deterministic tests cover Ollama/OpenAI semantic equivalence, a nonzero OpenAI
  output index, one-tool execution, request/output bounds, malformed multiple calls,
  cancellation, explicit-route failures, missing cloud credentials, and tampered
  inference evidence.
- Live Ollama text gate on `qwen2.5-coder:7b`: exact `FORGE_LOCAL_OK`, 30.335 s,
  30 input tokens, 5 output tokens.
- Live one-tool gate: one `workspace.read` call returned `package.json` evidence and
  a constrained repeat returned the correct `forge-engine` value. Tool inference
  took 0.976 s and final inference 0.265 s in the first measured run.

## Honest caveats

- A first, less constrained live tool prompt completed the Forge call successfully
  but the model answered `Forge-core`, demonstrating model-level interpretation
  variance. The exact call/result trace made the error attributable; the subsequent
  exact-argument prompt returned `forge-engine`.
- `OPENAI_API_KEY` is absent. OpenAI has deterministic transport conformance, not a
  live cloud acceptance pass.
- This workstation has Rust 1.97.1 but lacks MSVC `link.exe` and Windows SDK import
  libraries. Rust formatting passes; native compilation, Rust tests, the product
  CLI, Windows/macOS behavior, and the controlled VS Code run remain hosted gates.

## Next gate

Commit and open a draft pull request so the repository's Windows/macOS/Ubuntu hybrid
workflow can compile and test the Rust contract. Download the exact Windows kernel
artifact, run the provider-backed product CLI locally, then execute the controlled
VS Code acceptance prompt before marking this slice complete.
