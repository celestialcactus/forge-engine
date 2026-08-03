# ADR-0019: Ephemeral live CLI presentation over canonical run authority

**Status:** accepted for CLI ship lane 3
**Date:** 2026-08-03

## Context

Forge now performs explicitly routed local or cloud inference through the existing
TypeScript planner bridge, while Rust owns turns, policy, capability execution,
ordered events, budgets, and the terminal artifact. Provider transports already
receive text and tool-call deltas, but `forge run` buffers them and prints only the
terminal artifact. Ctrl+C also terminates the host process instead of deliberately
cancelling the active Forge run.

A useful CLI must show progress while the task is running. Treating those display
deltas as durable run events or building a separate TypeScript session loop would
reintroduce the runtime split removed by CLI ship lane 1.

## Decision

1. Validated normalized provider deltas may be observed synchronously by a bounded
   presentation callback. The callback cannot supply planner decisions, policy
   facts, capability results, event sequence, or terminal status.
2. Rust-streamed `RunEvent` records remain the only authoritative lifecycle for
   run start, selected context, inference completion, capability request, approval,
   capability result, cancellation, failure, budget exhaustion, and completion.
3. Human CLI mode renders provider text incrementally and renders concise lifecycle
   markers from canonical Rust events. It finishes with a summary derived from the
   terminal `RunArtifact`.
4. `--json` remains one valid terminal JSON document. It never mixes presentation
   deltas or status lines into stdout. A future JSONL protocol requires a separate
   explicit contract.
5. First Ctrl+C requests graceful cancellation through the existing bridge. A
   bounded timeout uses the same abort path and records an attributable reason.
   A later interrupt may retain the host's ordinary force-termination behavior.
6. This lane exposes the existing multi-turn provider/tool loop. It does not add a
   persistent REPL, durable resume, mutation capabilities, approval callbacks, or a
   second session/event store.
7. Ollama/Qwen is the live development provider. The deterministic OpenAI adapter
   remains in conformance; a live cloud call must pause until the developer supplies
   a project-scoped key through `OPENAI_API_KEY`.

## Consequences

- Developers see useful output and tool progress without waiting for terminal JSON.
- Display failures cannot be confused with canonical evidence because only the Rust
  event trace and terminal artifact are retained.
- Local and cloud providers share one live presentation surface without controlling
  the run loop.
- Durable conversation resume and mutation remain explicit later ship lanes rather
  than accidental state hidden inside the CLI process.

## Rejected alternatives

- A TypeScript `LiveRuntime` or provider-owned agent loop: duplicates Rust authority.
- Persisting every text delta as a Rust run event: inflates artifacts and couples
  provider chunking to the evidence contract.
- Streaming status into `--json`: produces invalid machine output and breaks hosts.
- Treating process termination as cancellation: loses attributable terminal state.
