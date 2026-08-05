# Checkpoint 70: execution-budget OpenAI and VS Code acceptance

**Date:** 2026-08-05  
**Branch:** `feature/cli-execution-budgets`  
**Implementation:** `3f2774b`  
**Checkpoint base:** `2f946ac`

## Decision

Accept increment 5B. Rust-owned capability-call and provider-reported token
budgets now pass the local, hosted cross-platform, live local-provider,
credentialed cloud-provider, and controlled VS Code gates. This acceptance does
not add product policy profiles, outer-run recovery, native packaging, or OS
sandboxing; those remain separate work.

## Credentialed OpenAI gate

A single conservative paid request ran against the two-file
`tests/fixtures/slice1-workspace` fixture with the retained hosted Windows kernel:

- provider/model: `openai/gpt-5.6`;
- prompt: reply exactly `FORGE_BUDGET_OPENAI_OK` and call no tools;
- controls: one turn, zero capability calls, 5,000 reported input tokens, and
  200 reported output tokens;
- run: `run:a8e56f9f-44ec-461f-a443-ff4d45d36bdf`;
- snapshot: `workspace:976b3a56bb9500e5`;
- observed usage: 768 reported input tokens and 12 reported output tokens;
- result: exact expected text, zero capability calls, five ordered lifecycle
  events, `status=completed`, and `outcome.status=not_evaluated`.

No credential value was printed or retained in repository evidence.

## Controlled VS Code gate

The trusted `C:\tmp\forge-engine-cli-execution-budgets` workspace loaded exactly
seven Forge MCP tools and no built-in tools. In a fresh Agent chat, the exact
request asked for one `Forge Workspace Summary` call with `maxFiles: 20`.

Observed result:

- exactly one Forge call and no retry or built-in tool call;
- run: `run:ec0829af-99c6-4dd6-bb74-f4277995a689`;
- snapshot: `workspace:7727990ef6434119`;
- `totalFiles=340`, `truncated=true`;
- `outcome.status=verified`, `runStatus=completed`;
- ordered events: `run.started`, `context.planned`, `capability.requested`,
  `approval.decided`, `capability.completed`, `outcome.assessed`,
  `run.completed`.

The host preserved the run/snapshot distinction and reported the task outcome
separately from the mechanical run lifecycle.

## Complete 5B acceptance envelope

- local TypeScript typecheck, 86/86 tests, build, Rust formatting, and dependency
  audit passed;
- exact implementation `3f2774b` passed hosted Node Windows/macOS and hybrid
  Rust/TypeScript Windows/macOS/Ubuntu;
- the retained hosted Windows kernel passed product doctor/smoke, live Qwen 7B
  normal behavior, Qwen 0.5B tiny-budget termination, and the OpenAI gate above;
- controlled VS Code preserved the seven-tool read-only tether and one-call
  evidence projection.

## Remaining honest gaps

Increment 5C still must expose a small product policy posture and prove embedded
host approval callback conformance over the existing Rust fact/decision contract.
The CLI still lacks outer-run recovery, clean native installation, a resolved root
license, and Forge-enforced OS containment.
