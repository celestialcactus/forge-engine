# Checkpoint 69: execution budget hosted and live Qwen gate

**Date:** 2026-08-05  
**Branch:** `feature/cli-execution-budgets`  
**Implementation:** `3f2774b`  
**Acceptance state:** hosted and live Qwen gates passed; conservative OpenAI and controlled VS Code gates pending

## Hosted proof

Draft PR [#22](https://github.com/celestialcactus/forge-engine/pull/22) ran the
exact implementation through both repository workflows:

- [Node cross-platform run](https://github.com/celestialcactus/forge-engine/actions/runs/31016309490):
  Windows and macOS passed.
- [Hybrid kernel run](https://github.com/celestialcactus/forge-engine/actions/runs/31016309520):
  Windows, macOS, and Ubuntu passed Rust fmt, strict clippy, Rust tests/build,
  TypeScript checks, Rust/TypeScript parity, MCP/product smoke, optimized build,
  and the bridge-latency assertion.

The retained Windows x64 kernel has SHA-256
`506B0C7ACC1EB37CC40157E087E08272DB04AF3538F2B5512D9622AAA4D4FAD8`.
`forge doctor --json` identified run protocol `forge.kernel.bridge.v6`,
`RunArtifact` schema v4 defaults, and the honest no-sandbox posture. Product
inspection completed as run `run:0ef511bc-2840-4567-8fd7-19076db8875a`.

## Live Ollama proof

The corrected evidence-answerable Qwen 2.5 Coder 7B prompt made exactly one
`workspace.read` call and returned the class and both sink methods present in the
requested range. Run `run:7f27bb41-ffd2-4313-b037-fd9cb79fc453` completed with
one admitted capability, two inference turns, 2,059 reported input tokens, and
64 reported output tokens.

A Qwen 2.5 Coder 0.5B run with input ceiling 1 and capability ceiling 0 stopped
as `execution_budget_exhausted` after its first measured response: run
`run:e71dfce9-8ab8-42c1-84fc-c832889d3849`, observed input 780, no admitted
capability, no accepted assistant output.

The weakest-model probe also exposed a useful model-floor result. Qwen 0.5B
successfully called `workspace.read`, then hallucinated `LiveCliPresenter` as a
second tool. Forge rejected the unregistered tool and failed run
`run:04692a18-12f9-4d7a-9645-55a9cf135b06`; 0.5B is not a reliable default for
this agentic tool-use task.

An earlier 7B prompt completed the correct one-read flow but asked for an
architectural-authority conclusion absent from the bounded line range. Its
plausible answer is not counted as semantic validation. The corrected prompt
demonstrates that acceptance prompts must make every scored claim answerable from
the selected evidence.

## Remaining gates

- The restarted Codex process does not currently inherit `OPENAI_API_KEY`; no
  credentialed OpenAI claim is made and no cloud call was attempted.
- VS Code opened the new worktree in Restricted Mode, which disables Copilot and
  MCP discovery. The workspace-trust security decision was left to the developer;
  no automation changed it.

5B remains conditional and must not be merged or marked accepted until the
conservative OpenAI and controlled one-call seven-tool VS Code gates close.
