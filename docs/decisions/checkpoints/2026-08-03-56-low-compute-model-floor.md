# Checkpoint 56: Low-compute model floor

**Date:** 2026-08-03
**Branch:** feature/cli-live-loop
**State:** local model-floor, provider-context, full local, and controlled VS Code gates passed; hosted rerun and live OpenAI gates pending

## Why this checkpoint exists

Testing only a capable local model can hide waste or ambiguity in the harness.
Forge therefore exercised the same bounded tasks against official
qwen2.5-coder:0.5b, 1.5b, 3b, and 7b models. The goal was not to claim universal
model rankings. It was to find the smallest measured model that could complete
each task and to expose harness defects that a larger model might compensate for.

## Defect found and corrected

The provider user message included the ContextPlan's selected workspace locators
but not their contents. A 1.5B model treated the alphabetical locator list as
evidence and repeatedly read an unrelated Rust watchdog file instead of the
explicit requested TypeScript path.

The provider projection now sends selected/omitted file counts and explicitly
states that those counts are not contents or source evidence. Models must use
Forge tools for workspace facts and paths. The internal ContextPlan, Rust events,
and RunArtifact are unchanged.

## Measured task floor

| Model | Smallest accepted task in this pass | Result |
| --- | --- | --- |
| qwen2.5-coder:0.5b | exact text-only response | 3/3; it did not reliably terminate a tool task |
| qwen2.5-coder:1.5b | one-read literal extraction | 3/3 after the context correction; one-read semantic interpretation failed 3/3 |
| qwen2.5-coder:3b | one-read semantic interpretation | 3/3; search-to-read composition failed 3/3 |
| qwen2.5-coder:7b | search-to-read composition | 3/3 with exactly search then read and grounded final answers |

The 7B one-read task also passed 3/3 after the correction. Its measured provider
input fell from 3,785 to 2,670 tokens, 1,115 fewer or about 29.5%. This is evidence
that weak-model testing improved the harness for the stronger model; it is not an
automatic routing policy or a general quality guarantee.

## Architectural consequence

- Future routing may select the smallest model that has passed a task-class
  benchmark, but only when outcome verification can detect failure and escalate.
- Forge does not yet auto-route among these sizes. Installing a model in Ollama is
  external machine state, not a repository dependency.
- Runtime `completed` still means a valid terminal planner turn, not a grounded or
  accepted result.

## Validation

- Provider-message regression proves no `workspace://` locator is emitted and the
  evidence warning is present.
- Focused inference tests passed 7/7. The final elevated local gate passed
  typecheck, all 57/57 tests, and the production build; an initial managed-sandbox
  run failed uniformly with `spawn EPERM`, which was process-denial evidence rather
  than a product-test failure.
- A fresh controlled VS Code Agent chat with exactly the seven Forge MCP tools
  selected made one `Forge Workspace Summary` call and no recovery calls. It
  reported run `run:b9bdbbec-3d63-4ebf-ab04-80e15d8e1730`, snapshot
  `workspace:2639223e5c548a91`, 308 files, truncation true, and the ordered events
  `run.started` -> `context.planned` -> `capability.requested` ->
  `approval.decided` -> `capability.completed` -> `run.completed`.
- VS Code did not inherit the terminal-only `FORGE_KERNEL_BINARY` setting. The
  server therefore failed closed until the already accepted Windows kernel binary
  was placed at the normal ignored discovery path `target/debug/forge-kernel.exe`.
  Building a fresh binary on this machine is blocked by a missing MSVC `link.exe`;
  clean-install packaging and `forge doctor` must make that prerequisite explicit.
- Exact run IDs and the full prompt matrix are retained in the development record;
  the ratios above are the decision-relevant summary.

See [ADR-0020](../ADRs/ADR-0020-explicit-local-context-and-provider-evidence-projection.md).