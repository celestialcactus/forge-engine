# Checkpoint 61 - Prepared ChangeSet approval binding local gate

**Date:** 2026-08-04
**Branch:** `feature/cli-edit-verification-composition`
**Base:** merged `develop` at `742b8c8` (PR #18)
**Status:** local compile and conformance gate passed; hosted product acceptance pending

## Why this checkpoint exists

The 4B pre-implementation audit found that the existing expert change command was
not a safe foundation for interactive editing. Its approval input retained only the
proposal schema version and verifier IDs. Rust created the actual ChangeSet later,
so the user-visible approval could not be proven to cover the exact content and base.
The CLI also described that operation as approved "after reviewing" even though it
did not render the exact prepared identity first.

[ADR-0023](../ADRs/ADR-0023-prepared-changeset-approval-binding.md) corrects the
machinery before UX composition.

## Implemented locally

- private sovereign-change protocol v3 with a non-mutating `prepare` operation;
- Rust-prepared ChangeSet v2 identity before approval;
- exact approval input containing ChangeSet ID and selected verifier IDs;
- recomputation and stale-identity rejection before candidate creation;
- retained approved call, approval facts, and Rust allow decision;
- retained canonical outcome contract and Rust assessment;
- outcome requirements for exact ChangeSet identity, every selected verifier, and
  durable candidate registration;
- schema-2 sovereign proposal artifact;
- human low-level CLI output now shows the change outcome;
- MCP remains seven read-only tools.

## Regression coverage

Added or strengthened checks for:

- no consent: preparation may occur, but no candidate or source mutation occurs;
- source change between preparation and execution: stale ID fails before candidate
  creation and produces `unmet`;
- successful verification: exact approved ID, all verifier requirements, candidate
  registration, and `verified` are retained;
- failed verification: candidate cleanup remains intact and outcome is `unmet`;
- duplicate, control-bearing, or overlong verifier IDs cannot enter a contract;
- kernel probe and TypeScript adapter agree on protocol v3.

## Local validation

Passed on this Windows host:

- `npm run typecheck`;
- 63/63 ordinary TypeScript tests;
- production TypeScript build;
- Rust formatting;
- GNU all-target workspace compile;
- strict Rust clippy with warnings denied.

Native Rust and exact TypeScript/Rust product tests still require hosted artifacts on
this machine because MSVC `link.exe` and GNU `dlltool.exe` are unavailable. The new
hybrid cases are present but cannot honestly be counted as passed until the hosted
Windows/macOS/Ubuntu run executes them.

## Remaining 4B work

1. Pass native Rust and hybrid tests on hosted Windows, macOS, and Ubuntu.
2. Download and smoke the exact hosted Windows kernel.
3. Compose provider change-plan evidence, Rust preparation, visible approval,
   candidate verification, and explicit accept/discard into the interactive CLI.
4. Produce one canonical attributable RunArtifact for that lifecycle.
5. Run the representative workflow on Windows and macOS.
6. Use the existing seven read-only MCP tools for controlled VS Code inspection;
   do not add an MCP mutation tool.

This checkpoint is not 4B acceptance and does not claim the developer edit UX is
ready.