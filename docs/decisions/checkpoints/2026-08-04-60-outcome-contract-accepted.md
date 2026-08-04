# Checkpoint 60 - Rust-authoritative outcome contract accepted

**Date:** 2026-08-04
**Branch:** `feature/cli-outcome-verification`
**Accepted implementation head:** `be2069a`
**Status:** CLI ship lane increment 4A accepted; increment 4B may begin

## What was accepted

Forge now records mechanical run lifecycle separately from a bounded,
caller-authored outcome assessment. Rust remains the only authority that validates
and evaluates the outcome contract. TypeScript transports and presents that fact;
it does not create a second meaning of success.

The accepted boundary is RunArtifact v2 over `forge.kernel.bridge.v4`, with
`outcome.assessed` emitted before `run.completed`. A completed lifecycle may still
have an `unmet` or `not_evaluated` outcome.

## Exact-head validation

Commit `be2069a` passed:

- Node 22 on Windows and macOS in Actions run `30922333249`;
- Rust-kernel plus TypeScript-adapter conformance on Windows, macOS, and Ubuntu in
  Actions run `30922337824`;
- local `npm run check`: typecheck, 63/63 tests, and production build;
- local exact-kernel hybrid gate: 39/39 tests, zero skips;
- CLI doctor and inspection smoke against the exact hosted Windows release kernel.

Doctor reported kernel protocol `forge.kernel.bridge.v4`, RunArtifact schema 2,
and the honest execution posture: trusted verification with process lifecycle
ownership, not a Forge-enforced OS sandbox.

## VS Code finding and bounded correction

The first trusted-workspace test made exactly one Forge summary call. Its raw Forge
result correctly said `Outcome: verified`, but Copilot reported `completed` because
the compact structured result also exposed mechanical lifecycle as a top-level
`status` field. The host selected the wrong status even though the kernel artifact
was correct.

The MCP adapter now exposes mechanical lifecycle as `runStatus`, presents
`outcome.status` first, and describes `runStatus` as non-outcome lifecycle state.
The internal RunArtifact and Rust contract were not changed. Conformance tests pin
the field names and human labels.

After rebuild and MCP restart, a fresh VS Code Agent chat with exactly seven Forge
tools selected made one `Forge Workspace Summary` call and no built-in search or
retry. It reported:

- run `run:1397c525-d6c2-46b8-a214-486fc1cc5e05`;
- snapshot `workspace:e0cd67ad24cc0a4f`;
- 314 files, truncated `yes`;
- outcome `verified`;
- ordered events `run.started`, `context.planned`, `capability.requested`,
  `approval.decided`, `capability.completed`, `outcome.assessed`, and
  `run.completed`.

## Acceptance decision

Increment 4A is accepted. The runtime no longer lets a host treat mechanical
completion as proof that a requested outcome was verified. Increment 4B may now
compose the existing digest-bound change transaction and bounded verifier behind
this authority; it must not add generic raw write or shell capabilities.

## Honest remaining limits

- The initial outcome vocabulary is mechanical and narrow; it is not general
  semantic grading.
- This machine still cannot link a new Rust binary from source because MSVC
  `link.exe` and GNU `dlltool.exe` are unavailable. Exact hosted binaries execute
  locally, and hosted Windows/macOS/Ubuntu jobs remain the native build authority.
- Trusted VS Code workspace mode is not an OS sandbox.
- MCP remains read-only; 4A adds no public mutation capability.
