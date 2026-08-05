# ADR-0027: Rust-owned execution budgets and reported-usage semantics

- **Status:** Implemented locally; hosted acceptance pending
- **Date:** 2026-08-05
- **Scope:** CLI ship lane increment 5B, run protocol, inference accounting

## Context

Forge already bounded context bytes and planner turns. Those controls did not state
or enforce an independent capability-call ceiling. They also recorded provider
usage but did not let a caller cap cumulative reported input/output tokens.
`maxTurns` was validated by the product service, but a direct bridge caller could
bypass the documented 1–32 range.

A token ceiling has an important timing constraint: providers normally report
actual usage only after a response completes. Forge can stop the next planning or
capability step after that response, but cannot claim that post-response accounting
prevented the response itself from crossing the limit. A true per-response output
ceiling must also be normalized into each provider transport.

## Decision

1. Add versioned `ExecutionBudget` and `ExecutionUsage` contracts to the canonical
   run request and artifact.
2. Advance `RunArtifact` from schema v3 to v4 and the Rust NDJSON bridge from v5
   to v6. Older peers fail closed.
3. Rust owns the terminal decision. TypeScript retains an equivalent conformance
   implementation solely for trace-parity fixtures.
4. A capability-call ceiling is checked before emitting `capability.requested` or
   invoking approval/capability adapters. A denied or failed request already
   admitted by the ceiling counts as a capability call.
5. Cumulative input/output ceilings apply to validated provider-reported usage.
   The response is recorded, counters are advanced, and continuation stops with
   `execution_budget_exhausted` if a total crosses its ceiling.
6. Exact equality is allowed. Exhaustion requires `observed > limit`.
7. When inference evidence exists under these enabled ceilings, both input and
   output token counts are required. Missing usage fails closed with
   `inference_usage_unavailable`; Forge does not silently call an unknown value
   zero.
8. Context exhaustion remains `budget_exhausted` with
   `run.budget_exhausted`. Execution-control exhaustion is a distinct status and
   `run.execution_budget_exhausted` event with dimension, limit, observed value,
   and exact admitted usage.
9. Rust validates `maxTurns` from 1 through 32 even for direct bridge callers.
10. The bridge accepts a terminal artifact only when it echoes the exact requested
    budget and valid non-negative safe usage counters.

## Product defaults

The CLI and workspace service apply defaults without requiring setup:

- capability calls: 6;
- cumulative reported input tokens: 262,144;
- cumulative reported output tokens: 32,768;
- planner turns: 8 (existing default).

Advanced users may override these with `--max-capability-calls`,
`--max-input-tokens`, and `--max-output-tokens`. The CLI describes the token values
as reported-usage ceilings, not transport containment.

## Guarantees

- the seventh proposed capability cannot run under the default six-call ceiling;
- an exhausted capability proposal cannot reach policy or capability integration;
- counters and the terminal reason are Rust-authored and present in the artifact;
- exact-limit, over-limit, missing-usage, invalid-schema, and direct-caller turn
  bounds have Rust/TypeScript parity fixtures;
- cancellation, context byte bounds, outcome assessment, and durable change
  transactions remain separate states.

## Non-guarantees

- The token ceiling does not stop the provider response that first crosses it.
- It is not a provider billing limit or an organization spend policy.
- It does not estimate missing usage.
- It does not bound wall-clock time; the existing cancellation/deadline path does.
- It is not OS isolation.

## Rejected alternatives

- **More CLI-only counters.** Embedded and MCP hosts would bypass them and Rust
  would not own terminal state.
- **Reuse context `budget_exhausted`.** That would conflate prompt construction
  with runtime execution control and make remediation ambiguous.
- **Treat missing usage as zero.** This creates a false safety and cost claim.
- **Abort before recording the crossing inference.** The actual provider work and
  cost already occurred; omitting it would corrupt the evidence trail.
- **Claim a hard token cap from post-response totals.** That is mechanically false
  without provider-side request limits.

## Acceptance gates

- local TypeScript typecheck, 86 tests, production build, and diff hygiene;
- Rust fmt, clippy, unit tests, build, and Rust/TypeScript bridge parity on hosted
  Windows, macOS, and Ubuntu;
- exact boundary, capability pre-admission, input/output crossing, missing usage,
  invalid budget, and invalid turn fixtures;
- live Ollama and OpenAI flows show measured usage and ordinary completion under
  defaults;
- one deliberately tiny live ceiling terminates distinctly without a follow-up
  capability;
- controlled VS Code seven-tool read-only regression remains unchanged.

## Deferred

Transport-level normalized output-token limits, organization spend aggregation,
policy profiles, and embedded-host callback conformance are separate work. Policy
profiles and callback conformance remain increment 5C.