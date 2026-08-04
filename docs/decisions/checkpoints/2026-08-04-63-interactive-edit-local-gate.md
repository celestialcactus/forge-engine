# Checkpoint 63 - Interactive edit composition local gate

**Date:** 2026-08-04
**Branch:** `feature/cli-edit-verification-composition`
**Base:** merged `develop` at `742b8c8` (PR #18)
**Pull request:** draft PR #19
**Status:** local implementation complete; hosted exact-kernel/product gate pending

## Implemented result

The interactive CLI can opt into a bounded edit workflow by loading a strict trusted
verification policy. Ordinary interactive and one-shot inference retain seven
evidence tools; MCP remains seven read-only tools. A policy-enabled session adds one
non-mutating planning tool, renders the diff, requests exact ChangeSet approval,
runs the existing Rust candidate/verifier machinery, and requires a second explicit
accept/discard/retain decision after a Rust-verified outcome.

Deterministic guards now require:

- exactly one plan in a completed planning run;
- complete prior read coverage for every target at the same digest;
- retained content and rendered diff identity;
- exact TypeScript-plan/Rust-prepared path, digest, byte, and content-kind agreement;
- a valid trusted-only verifier policy and known, unique selected check IDs;
- no promotion after failed verification or an unmet outcome.

## Local validation

- TypeScript typecheck, all 75 ordinary tests, and the production build pass.
- A built no-policy interactive startup smoke reports changes disabled and exits
  cleanly without invoking inference.
- Rust format, GNU-hosted all-target compile, and strict Clippy pass.
- Native Rust linking remains unavailable locally: the GNU path lacks `dlltool.exe`
  and the pinned MSVC path lacks `link.exe`. Hosted CI is therefore the native test
  and optimized-kernel authority.
- The exact previously hosted Windows v3 kernel passed `forge doctor`; it correctly
  exposed a prepared-operation naming mismatch (`before_sha256` versus the intended
  host `beforeSha256`). The bridge now projects the prepared artifact without
  changing core/durable ChangeSet serialization. A newly hosted kernel is required
  before product acceptance.

## Low-compute Qwen evidence

All live tests used a disposable committed workspace and no source mutation reached
the governed workspace:

- 0.5B and 1.5B repeatedly planned before reading; every call failed closed.
- 3B read the complete file but first failed opaque digest copying, then used the
  conventional `content` field, and finally leaked a JSON tool call as assistant
  text. The adapter removed model-owned digest/diff bookkeeping and the runtime now
  fails closed on registered tool-call JSON.
- 7B made exactly one complete read and one valid non-mutating plan for a clear
  `hello` to `goodbye` replacement. The final TypeScript/Rust comparison exposed the
  bridge naming mismatch before candidate creation.

This does not prove 7B is generally capable. It proves weaker models helped identify
unnecessary schema burden and that the boundary rejected every malformed or
inconsistent attempt without mutating the workspace.

## Remaining acceptance gate

1. Hosted Windows/macOS/Ubuntu Rust and product matrices must pass the exact commit.
2. Download the exact hosted Windows kernel and rerun the disposable Qwen 7B flow
   through plan, approval, candidate verification, and explicit accept/discard.
3. Run the controlled VS Code seven-tool read-only regression and inspect the final
   workspace/evidence without exposing mutation through MCP.
4. Record whether lifecycle evidence is sufficiently unified; one durable aggregate
   RunArtifact remains open and must not be implied by this checkpoint.
