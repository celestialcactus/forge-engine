# Checkpoint 2026-07-22-12: Hybrid Rust kernel evaluation

- **Status:** in-progress
- **Date:** 2026-07-22
- **Related ADRs:** ADR-0001, ADR-0002, ADR-0006
- **Scope:** SGU-003 authority-boundary spike; Slice 2B remains paused

## Objective

Prove or disprove that Forge can move its authoritative runtime machinery to Rust
while retaining TypeScript as a subordinate integration layer for MCP, VS Code,
TypeScript semantic evidence, and vendor SDKs. The spike must preserve the accepted
Slice 1/2A evidence contract and must not introduce a production mutation surface.

## Architecture at this checkpoint

```text
VS Code / MCP / TypeScript compiler / vendor SDK
                         |
              TypeScript integration adapters
            planner, approval, capability answers
                         |
          forge.kernel.bridge.v1 private NDJSON
                         |
                   Rust authority
       context -> correlate -> record -> terminate
                         |
              authoritative RunArtifact v1
```

Rust assigns event sequence numbers, compiles the context plan, correlates calls and
results, records approvals, enforces turn limits, and produces the only terminal
artifact. TypeScript supervises the process and responds only when Rust requests a
planner turn, approval decision, or integration-specific capability.

The spike launches one kernel process per run. That topology makes isolation and
differential testing simple, but it is not the presumed production lifecycle.

## Changes since the previous checkpoint

- Added the `forge-core` Rust library with schema-compatible contracts, deterministic
  UTF-16 path ordering, context compilation, and the runtime state machine.
- Added the `forge-kernel` executable with a one-run, request-correlated NDJSON
  bridge.
- Added a TypeScript supervisor that validates streamed events and terminal
  artifacts, translates `AbortSignal`, bounds stderr, and rejects missing,
  malformed, mismatched, or prematurely exited kernels.
- Added an explicit `FORGE_KERNEL_BINARY` opt-in for CLI and MCP without changing
  the default accepted TypeScript control.
- Added differential, cancellation, malformed-process, official MCP, performance,
  and hosted platform conformance tests.
- Added a target-specific static Windows gnullvm developer build configuration.
- Kept the public surface at exactly seven read-only Forge tools.

## Decisions proposed or adopted

| Decision | Status | Rationale | ADR |
|---|---|---|---|
| Rust owns authoritative run machinery; TypeScript owns integrations | Conditionally accepted | Local differential and MCP evidence proves the boundary without artifact drift | ADR-0006 |
| One child process per run is the production topology | Rejected as an assumption | It is excellent for the spike but adds about 15-22 ms per run and lacks long-lived backpressure/recovery | ADR-0006 |
| Baseline sovereign CLI operation may require Node permanently | Rejected | Rust must eventually own baseline workspace, process, persistence, and recovery paths | ADR-0006 |
| Start Slice 2B before the language decision closes | Rejected | Mutation work would cement the wrong authority and double migration cost | ADR-0006 |

## Validation performed

| Command or experiment | Result | Evidence |
|---|---|---|
| `cargo fmt --all -- --check` | Passed locally | Rust formatting gate |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed locally | No Clippy warnings |
| `cargo test --workspace --locked` | Passed locally | 8 Rust tests |
| `npm run check` | Passed locally | Typecheck, 36/36 accepted TypeScript tests, production build |
| `npm run test:hybrid` with the debug kernel | Passed locally | 15/15 hybrid tests |
| `npm run test:hybrid` with static release kernel and no LLVM directory on `PATH` | Passed locally | Standalone Windows binary behavior |
| Official MCP client summary/read scenario | Passed locally | Exactly seven tools, six ordered events, each compact result below 5 KB |
| 50-sample release benchmark | Passed the 500 ms ceiling | Rust bridge p50 15.124 ms, p95 20.245 ms; TypeScript p50 0.041 ms, p95 0.168 ms |
| Controlled VS Code one-call test | Passed after manual workspace trust | Exactly seven selected Forge tools; one summary call; run `run:ae34eb1f-f2bb-413d-8838-803f2f11430b`; snapshot `workspace:0ebe13a809f04890`; 170 files; truncated; six ordered events; completed within the 14.6-second observation |
- The first trusted VS Code run counted 403 files because Rust `target/` output was
  not excluded. A shared ignore policy now excludes `target/` from both scans and
  watcher invalidation; the regression passed and the clean retest counted 170
  legitimate source/configuration/documentation files.
| Hosted Windows/macOS/Linux matrix | Pending explicit user-approved push | Workflow is defined and the spike is committed locally; external export was not attempted after the safety review blocked an unapproved push |

## Failures and surprises

- The installed Rust MSVC compiler could not link because the Visual C++ SDK was
  absent. LLVM-MinGW gnullvm enabled local evaluation without changing the intended
  hosted/native platform matrix.
- A dynamically linked gnullvm binary required `libunwind.dll`. Enabling
  `-C target-feature=+crt-static` produced the standalone 880,128-byte developer
  binary.
- Serde enum field casing initially drifted from the TypeScript protocol.
  `rename_all_fields = "camelCase"` fixed the bridge and differential tests caught
  the issue before host integration.
- A missing kernel could leave a child-process start path waiting. An executable
  preflight and explicit launch/exit handling now make the failure prompt.
- VS Code correctly refused to start a workspace-defined MCP server in Restricted
  Mode without a user trust decision. Automation did not bypass this boundary.

## Known limitations

- Hosted macOS and Linux results are not yet recorded.
- The bridge permits one active run per process and has no long-lived concurrency,
  backpressure, crash recovery, or compatibility negotiation.
- Rust and TypeScript contract types are hand-maintained duplicates during the
  differential phase.
- The MCP package currently distributes Node plus a native binary; it is not yet a
  simpler package than the TypeScript-only control.
- The Rust core does not yet own workspace indexing, Git streaming, TypeScript
  diagnostics, durable event storage, transactions, or sandbox backends.
- Native implementation does not create an operating-system sandbox.

## Framework and service inventory

| Dependency/service | Purpose | Why selected | Lock-in/migration risk |
|---|---|---|---|
| Rust 1.97.1, edition 2024 | Kernel and native executable | Pinned compiler, strong state/concurrency model, portable native targets | Toolchain and target packaging must be automated |
| `serde` / `serde_json` | Private bridge and artifact serialization | Small, standard, inspectable JSON contract | JSON remains a private bridge; schema generation is still needed |
| Node.js 22 / TypeScript | MCP, IDE, compiler, and vendor adapters | Preserves the proven integration surface | Must not become mandatory for baseline sovereign operation |
| Official MCP TypeScript SDK | Existing seven-tool host boundary | Already accepted and VS Code-compatible | Adapter can later move without changing kernel semantics |
| LLVM-MinGW gnullvm | Local Windows evaluation fallback | Produced a standalone binary without the missing MSVC SDK | Evaluation-only; not yet the release target policy |
| GitHub Actions hosted matrix | Clean Windows/macOS/Linux proof | Reproducible platform evidence from one commit | Hosted availability; local release reproducibility remains future work |

## Repository state

- Branch/commit: `spike/SGU-003-rust-kernel-hybrid-evaluation`, based on `4900ee0`;
  spike committed locally; remote push awaits explicit user authorization.
- Files changed: Rust workspace/kernel, TypeScript bridge and opt-in, hybrid tests,
  benchmark, CI workflow, ADR/task/architecture/checkpoint documentation.
- Production behavior available: unchanged TypeScript control by default; Rust
  kernel path is explicit opt-in only.

## Next checkpoint

Close the controlled VS Code test and the hosted Windows/macOS/Linux matrix on one
commit. If both pass without artifact or tool-call regression, mark SGU-003 passed,
record the commit and CI run, and present the staged reconstruction plan before any
Slice 2B mutation work begins.
