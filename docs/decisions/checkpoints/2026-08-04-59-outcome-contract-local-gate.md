# Checkpoint 59 - Rust-authoritative outcome contract local gate

**Date:** 2026-08-04
**Branch:** `feature/cli-outcome-verification`
**Base:** `develop` at `0441d865` after merged PR #17
**Status:** local implementation gate passed; hosted and VS Code acceptance pending

## Why this checkpoint exists

Credentialed OpenAI and Qwen search-to-read testing proved that a provider may stop
after partial evidence while still returning a mechanically valid terminal turn.
Forge correctly recorded `status=completed`, but it had no separate fact describing
whether the requested outcome was evaluated or achieved. Starting patch and process
capabilities on top of that ambiguity would let a model's prose masquerade as
workflow success.

## Decision

[ADR-0022](../ADRs/ADR-0022-rust-authoritative-outcome-contract.md) makes outcome
assessment part of the Rust authority. Lifecycle status remains intact. RunArtifact
v2 always contains `outcome`; an optional bounded contract is validated before
planning and assessed immediately before terminal completion.

The initial requirement vocabulary is intentionally mechanical:
`output_non_empty`, exact `output_equals`, and correlated
`capability_succeeded`. No LLM grades its own work.

## Audit findings during implementation

The resumed audit found two defects before the slice was checkpointed:

1. The TypeScript child-process bridge had bumped its expected protocol and artifact
   schemas but did not forward `outcomeContract` inside `run.start`. Unit tests did
   not catch this because the hybrid suite requires a native kernel. The request now
   forwards the contract, and artifact validation requires the kernel to return the
   same semantic contract.
2. A generic in-process capability adapter could return `success=true` with a
   different call ID. The bridge-specific adapter already rejected that mismatch,
   but the core runtime and TypeScript oracle could have credited it. Both runtimes
   now normalize a mismatched result to failure under the original call ID, and
   parity coverage pins the behavior.

These findings are why hosted hybrid validation is a required gate rather than a
formality.

## Implemented behavior

- RunArtifact schema version 2;
- run bridge `forge.kernel.bridge.v4`;
- `OutcomeContract`, `OutcomeAssessment`, and three bounded requirement types;
- Rust-only authoritative validation and assessment;
- `outcome.assessed` before `run.completed`;
- explicit `not_evaluated`, `verified`, and `unmet` states;
- full contract in the authoritative artifact and no full contract in compact MCP
  output;
- deterministic read-only service calls supply a narrow success/non-empty contract;
- free-form inference supplies no implicit contract and remains `not_evaluated`;
- human CLI summaries and interactive `/status` show both states;
- one-shot CLI returns nonzero for `unmet`;
- call-ID mismatch cannot satisfy a capability requirement.

## Local validation

Passed on this Windows host:

- `npm run check`: typecheck, 63/63 tests, production build;
- `cargo +1.97.1-x86_64-pc-windows-gnu fmt --all -- --check`;
- `cargo +1.97.1-x86_64-pc-windows-gnu check --workspace --all-targets --locked`;
- `cargo +1.97.1-x86_64-pc-windows-gnu clippy --workspace --all-targets --locked -- -D warnings`;
- `git diff --check`.

No OpenAI or other paid provider call was used for this contract slice.

## Local limitation

Native Rust tests did not run locally. The default MSVC toolchain cannot find
`link.exe`; the installed GNU toolchain can compile but cannot link because
`dlltool.exe` is absent. We did not install an unplanned system linker. The hosted
workflow builds and executes Rust plus differential product tests on Windows,
macOS, and Ubuntu and remains the acceptance authority.

## Remaining acceptance gate

1. Commit and push the exact implementation.
2. Require all hosted Node and hybrid jobs to pass on the exact head.
3. Download the exact hosted Windows release kernel.
4. Run product smoke with that binary.
5. Restart the Forge MCP server in VS Code and perform one controlled summary call.
6. Require `status=completed`, `outcome=verified`, and ordered events:
   `run.started`, `context.planned`, `capability.requested`, `approval.decided`,
   `capability.completed`, `outcome.assessed`, `run.completed`.
7. Only then mark 4A accepted and begin 4B edit/process composition.
