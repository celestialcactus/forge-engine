# Checkpoint 49: real inference path start

**Date:** 2026-08-03
**Branch:** `feature/cli-real-inference`

## Starting evidence

- Kernel convergence merged to `develop` as `1fcab25` through PR #15.
- Product execution has one Rust run authority and one TypeScript `TaskPlanner`
  bridge; no production model provider exists.
- `forge run` currently returns workspace inventory rather than performing the task.
- The accepted `forge change` flow coexists with an obsolete public
  `forge candidate` surface and public legacy exports.
- Ollama is installed locally and its API reports `qwen2.5-coder:7b`,
  `qwen2.5:latest`, `llama3.1:latest`, and `llama3:latest`.
- `OPENAI_API_KEY` is not set, so live cloud acceptance is currently unavailable.

## Boundary decision

Provider transport and stream normalization belong in TypeScript, but provider
results enter the existing planner bridge. Rust continues to own turns, approvals,
capability invocation, events, and the terminal artifact. No inference-specific
runtime or event hierarchy will be created.

This slice also deletes obsolete public paths while it strengthens the architecture.
See [ADR-0018](../ADRs/ADR-0018-provider-neutral-inference-and-debt-retirement.md)
and [the slice task](../../tasks/SLICE-CLI2-real-inference.md).

## Next proof

Retire the duplicate CLI surfaces, define the normalized inference evidence across
TypeScript/Rust, then implement deterministic Ollama/OpenAI fixtures before any
live model acceptance claim.
