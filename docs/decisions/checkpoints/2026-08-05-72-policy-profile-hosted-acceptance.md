# Checkpoint 72: product approval profile hosted acceptance

**Date:** 2026-08-05
**Branch:** `feature/cli-policy-profiles`
**Accepted implementation:** `2941948`

## Decision

Accept CLI ship-lane increment 5C. The product approval profile and embedded-host
callback boundary now pass local, real-kernel, live-provider, controlled VS Code,
and hosted cross-platform gates without moving final policy authority out of Rust.

## Hosted exact-implementation evidence

GitHub Actions validated implementation `2941948`:

- Node 22 / macOS: passed in 51 seconds;
- Node 22 / Windows: passed in 1 minute 5 seconds;
- Rust kernel + TypeScript adapter / macOS: passed in 2 minutes 47 seconds;
- Rust kernel + TypeScript adapter / Ubuntu: passed in 2 minutes 9 seconds;
- Rust kernel + TypeScript adapter / Windows: passed in 4 minutes 7 seconds.

Workflow runs:

- Node: `31031189599`;
- hybrid Rust/TypeScript: `31031189868`.

The hosted jobs build and test on clean Windows, macOS, and Ubuntu runners. They
confirm the TypeScript fact adapter, CLI/service/MCP composition, real Rust policy
resolution, capability gating, cancellation behavior, and existing change/runtime
contracts remain compatible across the supported matrix.

## Complete acceptance envelope

- `npm run check`: typecheck, 91/91 Node tests, and production build;
- retained hosted Windows kernel full hybrid suite: 54/54;
- dependency audit: zero known vulnerabilities;
- live Qwen 1.5B review grant and decline gates;
- final controlled VS Code regression: exactly seven Forge tools, one summary
  call in four seconds, no built-ins or mutation, complete seven-event projection;
- hosted Node Windows/macOS and hybrid Windows/macOS/Ubuntu: all green on
  implementation `2941948`.

## Honest boundary after acceptance

5C does not add OS containment, organization policy distribution, a host-interactive
MCP approval handshake, or crash-resumable outer runs. Qwen 0.5B also remains below
the demonstrated general tool-use floor after producing a malformed continuation.

The next core increment is minimum outer-run recovery. It must append canonical
events/artifacts and resume idempotent work without replaying completed mutation or
external actions. Native packaging, root licensing, and the developer alpha kit
remain the other blockers for an externally shareable alpha.
