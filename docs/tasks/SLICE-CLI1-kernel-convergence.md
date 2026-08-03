# CLI ship lane 1: kernel convergence

- **Status:** Acceptance complete on the feature branch; PR #15 merge pending
- **Opened:** 2026-08-03
- **Branch:** `feature/cli-kernel-convergence`
- **Base:** protected `develop` at `6bc2bfb`
- **Implementation head:** `ca9809f`
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu

## User-visible outcome

A source-built Forge CLI or MCP server uses one Rust-owned runtime automatically.
If the kernel is missing, Forge explains exactly what is missing and how to build or
configure it; it never presents the TypeScript conformance coordinator as the
product runtime.

## Scope

1. Add deterministic kernel discovery with explicit provenance.
2. Require a Rust product runtime for CLI and MCP entry points.
3. Rename and isolate the TypeScript coordinator as a conformance fixture.
4. Expand `doctor` with kernel readiness and the effective execution posture.
5. Make product smoke tests exercise the Rust kernel.
6. Preserve the accepted read-only, transaction, host-authority, and evidence
   contracts.

## Non-goals

- local or cloud model inference;
- an interactive multi-turn CLI;
- native Windows/macOS restricted execution;
- MCP mutation;
- packaging the final release binaries;
- context compression, memory, skills, connectors, or automation.

## Exit gate

- no implicit TypeScript production fallback remains;
- local Node checks pass, and local product smoke passes wherever a Rust linker is installed;
- hosted Windows/macOS product checks pass;
- the seven-tool VS Code read-only scenario remains one-call and mutation-free;
- documentation names the trusted-mode limitation and retained restricted work.

## Acceptance checkpoint

The runtime fallback is removed from product entry points, kernel discovery and the
bounded protocol probe are implemented, and Node-only tests explicitly select the
TypeScript conformance fixture.

- Local `npm run check` passes typecheck, 44/44 tests, and production build.
- Hosted Node conformance passes on Windows and macOS in run `30839933843`.
- Hosted hybrid conformance passes on Windows, macOS, and Ubuntu in run
  `30839933999`, including Rust formatting, lint, tests, release build, product
  smoke, and retained native artifacts.
- The exact hosted Windows release artifact passes local `forge doctor --json` and
  `npm run smoke`; the smoke run was
  `run:4c1137be-9561-42f3-8c7e-02a23b4bcbc5`.
- A fresh VS Code Agent chat with exactly seven Forge tools enabled completed one
  workspace-summary call in three seconds with no built-in tool or mutation. It
  returned run `run:be41c97b-b59e-4eb5-a1aa-2f7bd43b66c5`, snapshot
  `workspace:866dd8119895837e`, 277 files, `truncated: true`, and the canonical six
  ordered events.

This accepts kernel convergence on the feature branch. It does not add model
inference, a live multi-turn CLI, release packaging, or an OS sandbox. The local
workstation still lacks MSVC `link.exe`; hosted Windows is the native compiler gate.
See [Checkpoint 47](../decisions/checkpoints/2026-08-03-47-kernel-convergence-local-gate.md)
and [Checkpoint 48](../decisions/checkpoints/2026-08-03-48-kernel-convergence-hosted-and-vscode-gate.md).
