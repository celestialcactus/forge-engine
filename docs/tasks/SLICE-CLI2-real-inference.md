# CLI ship lane 2: real inference path

**Status:** local adapter/conformance gate passed; hosted Rust and VS Code gates pending
**Branch:** `feature/cli-real-inference`
**Base:** merged kernel-convergence `develop` at `1fcab25`

## Objective

Prove one provider-neutral inference path through the canonical Rust run authority,
using one live local provider family and one direct cloud adapter without adding a
parallel runtime.

Local evidence is recorded in [Checkpoint 50](../decisions/checkpoints/2026-08-03-50-real-inference-local-gate.md).

## Debt retired in this slice

- Remove the public legacy `forge candidate` CLI beside canonical `forge change`.
- Remove public exports of the legacy candidate runtimes.
- Replace the inventory-backed fake `forge run`; until real inference is accepted,
  smoke uses the explicit read-only `forge inspect` command.
- Keep `ScriptedPlanner` fixture-only.

## In scope

- Normalized provider stream and terminal inference evidence.
- Ollama chat adapter and OpenAI Responses adapter.
- Explicit provider/model routing with no implicit fallback.
- One provider-backed `TaskPlanner` using the existing Rust bridge.
- Bounded text, tool argument, usage, latency, cancellation, and error handling.
- Deterministic adapter fixtures plus live Ollama text and one-tool scenarios.

## Non-goals

- A second runtime, event store, policy engine, session model, or context compiler.
- Multi-provider fallback, speculative routing, parallel tool calls, or model racing.
- Automatic cloud credential setup or a false live OpenAI acceptance claim.
- The complete interactive CLI loop; that is ship lane 3.

## Exit gates

1. Rust remains the only product run authority and records terminal inference
   evidence in its ordered artifact.
2. Ollama and OpenAI fixtures emit the same normalized semantic sequence for a
   bounded text response and a single tool call.
3. Explicit cancellation, malformed streams, multiple tool calls, oversized text,
   and oversized arguments fail deterministically.
4. A live installed Ollama model completes a measured text run and a bounded
   one-tool run through `forge run`.
5. The OpenAI adapter passes conformance; live cloud status is separately reported
   and requires an available credential.
6. `forge candidate` and the fake inventory `forge run` are absent from the public
   CLI; `forge change` and the seven MCP evidence tools remain green.
7. TypeScript, Rust, product-smoke, and hosted Windows/macOS gates pass before merge.
