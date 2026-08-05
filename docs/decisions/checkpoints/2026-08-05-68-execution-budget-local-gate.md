# Checkpoint 68: Rust-owned execution budget local gate

**Date:** 2026-08-05  
**Branch:** `feature/cli-execution-budgets`  
**Base:** merged `develop` at `2a5fe3e`  
**Acceptance state:** local gate passed; hosted, live-provider, and VS Code gates pending

## Objective

Close CLI ship lane 5B without adding a second counter loop in the CLI. Rust must
own independent capability-call admission, cumulative reported inference usage,
and the terminal exhaustion artifact. TypeScript must carry integrations and
prove trace parity.

## Implemented

- `RunArtifact` schema v4 carries the exact `ExecutionBudget` and terminal
  `ExecutionUsage`.
- `forge.kernel.bridge.v6` carries the versioned budget in `run.start` and rejects
  a terminal artifact that changes it or omits valid counters.
- Rust stops a capability proposal before approval or invocation when its admission
  would cross the capability-call ceiling.
- Rust records provider evidence, accumulates reported input/output usage, and
  stops continuation with `run.execution_budget_exhausted` after a crossing
  response.
- Missing reported input or output usage under enabled token ceilings fails closed
  as `inference_usage_unavailable`.
- Direct bridge requests with `maxTurns` outside 1–32 now fail inside Rust instead
  of relying only on service validation.
- Context exhaustion and execution-control exhaustion have separate statuses and
  events.
- The interactive and one-shot CLI use safe defaults without additional setup and
  expose optional override flags.
- Human summaries show admitted capability calls and cumulative reported token
  totals against their ceilings.

## Local evidence

- `npm run typecheck`: pass.
- `npm test`: 86/86 pass.
- `npm run build`: pass.
- combined `npm run check`: pass in 23.7 seconds.
- `cargo fmt --all -- --check`: pass.
- `npm audit --json`: zero known vulnerabilities reported at this checkpoint.
  A fresh advisory refresh initially found five MCP-tree findings (two high);
  `@modelcontextprotocol/sdk` was advanced from 1.29.0 to 1.30.0 and its patched
  transitive graph was locked before the clean-install gate was repeated.
- clean `npm ci`: pass with zero audit findings.
- `git diff --check`: pending final documentation pass, then required again.

The first restricted Node test run failed with the known Windows `spawn EPERM`
worker limitation; the exact escalated rerun passed. The first restricted build
could not create `dist`; the complete escalated `npm run check` passed.

## Local native limitation

Rust compilation cannot complete on this workstation because the installed MSVC
Rust toolchain cannot find `link.exe`. This is an environment gap (Visual C++ Build
Tools are not installed), not a passing Rust result. `cargo test --workspace`
reached dependency compilation and stopped at the missing linker. Rust correctness
therefore remains unaccepted until hosted Windows/macOS/Ubuntu gates pass.

## Regression cases

- exact capability limit and attempted over-limit;
- exact cumulative input/output token boundary;
- input-token crossing before terminal planner output is accepted;
- missing provider usage;
- unsupported budget schema;
- direct-caller invalid turn bound;
- Rust/TypeScript equivalents added to the hybrid gate;
- previously successful mock providers updated to report usage rather than
  weakening the production contract.

## Architectural finding

A reported-usage ceiling is a **continuation control**, not a hard cap on the
provider response that crosses it. Provider-side output-token controls remain a
separate transport increment. This distinction is recorded in
[ADR-0027](../ADRs/ADR-0027-rust-owned-execution-budgets.md).

## Remaining 5B gate

1. hosted Rust fmt/clippy/test/build and hybrid parity on Windows, macOS, Ubuntu;
2. live Qwen ordinary run plus deliberately tiny ceiling;
3. conservative credentialed OpenAI ordinary run;
4. controlled VS Code read-only seven-tool regression;
5. exact-head checkpoint update before acceptance and merge.

## Product calibration

The source-backed [CLI harness comparison](../../audit/2026-08-05-cli-harness-core-comparison.md)
finds Forge's evidence/transaction machinery credible but the standalone product
behind mature harnesses in recovery, packaging, sandboxing, breadth, ecosystem,
and field exposure. That audit sets the post-5B alpha order: 5C, minimum outer-run
recovery, packaging/license, then the developer test kit.