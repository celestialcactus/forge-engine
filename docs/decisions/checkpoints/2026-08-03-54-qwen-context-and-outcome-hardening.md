# Checkpoint 54: Qwen context and outcome hardening

**Date:** 2026-08-03
**Branch:** feature/cli-live-loop
**State:** local reliability gate passed; interactive DX continued in Checkpoint 55; VS Code, hosted rerun, and live OpenAI remain pending

## Trigger

Developer Case 2 completed one workspace.read but Qwen returned a refusal. The
run was run:fdf3816d-a89c-46d1-82e3-ceca7deba0ac; its second provider turn
reported exactly 2,048 input tokens.

## Diagnosis

- The Ollama request did not declare num_ctx.
- Internal read evidence was correct but duplicated source in both text and lines,
  making the provider payload larger and placing citation-ready records later.
- A stronger search-to-read experiment exposed a separate model failure: Qwen
  printed tool-protocol markup as final text.
- Direct Forge search proved the underlying evidence was correct. In a later
  two-tool stress run, Qwen stopped after the correct search, invented a path and
  source snippet, and Forge reported runtime completion. That is an outcome
  grounding gap, not an evidence-adapter corruption.

## Bounded correction

- Ollama now uses explicit num_ctx=8192 and temperature zero.
- FORGE_OLLAMA_CONTEXT_TOKENS is validated from 2,048 through 262,144.
- Provider-facing workspace.read evidence is compact line-numbered text; internal
  capability and artifact evidence is unchanged.
- The planner treats tool results as untrusted evidence, instructs plain-text
  answers, and fails closed when a provider emits a complete tool_call or
  tool_response envelope as terminal text.
- Forge does not infer or execute the contents of malformed markup.

See [ADR-0020](../ADRs/ADR-0020-explicit-local-context-and-provider-evidence-projection.md).

## Validation

- Focused inference regressions: 7/7 passed.
- Full npm run check: typecheck, 54/54 tests, and production build passed.
- Text-only live Qwen: exact FORGE_LOCAL_OK,
  run:a7606b75-5eca-4883-8b87-f275af42a64b.
- Corrected one-read prompt ran twice with identical grounded answers, exactly one
  read, and two inference turns:
  - run:e1c977ae-10b0-4f3f-a72e-a8585c41b61b
  - run:a80f622d-ac48-42bd-b42b-e78974a60ccd
- Those second turns used 2,461 input tokens, proving the former 2,048 clipping
  boundary was removed.
- JSON mode parsed as one artifact with no human prefix:
  run:be3ddd53-8cc8-4b5f-83a9-3ec555d3acb5.
- A live 100 ms deadline exited 124 and left zero forge-kernel processes:
  run:8f8c15f9-fefc-42e7-9eaa-c3b739f93dfc.

## Honest boundary

The original Case 2 asked what "remains authoritative," but the requested lines
did not state that fact. It was therefore not a valid grounding test. The corrected
prompt asks only for facts present in lines 1-80.

The stronger two-tool run
run:bc1df4bf-a1a2-4b15-8d09-dccc55e20731 still failed behaviorally: Qwen made
one correct search, skipped the requested read, and fabricated its final code.
Forge's direct search run run:8b8c41cf-7743-4e25-9cb2-6282de009486 proves the
search evidence was src/live-cli.ts:30. This slice does not claim that a 7B model
is a reliable multi-step agent or that runtime completion equals grounded outcome
acceptance.

The developer-requested interactive shell subsequently passed its local gate in
[Checkpoint 55](2026-08-03-55-interactive-cli-local-gate.md). Before this branch is
accepted, it still needs a controlled VS Code regression, a hosted rerun, and the
deliberate live OpenAI credential gate.
