# Checkpoint 43: authenticated host provider/bridge design

- **Date:** 2026-07-30
- **Branch:** `feature/slice-2f2b-host-provider-bridge`
- **Base:** protected `develop` at `aa73e0e`
- **Decision:** accepted for bounded implementation
- **ADR:** [ADR-0016](../ADRs/ADR-0016-rust-derived-host-execution-grant.md)
- **Task:** [Slice 2F-2b](../../tasks/SLICE-002F2B-host-provider-bridge.md)

## Entry evidence

Slice 2F-2a passed native hosted Windows/macOS/Ubuntu tests for strict signature
verification, durable single-use challenge consumption, restart/concurrent replay,
and corrupted evidence. It intentionally did not prove that the challenge digests
came from the executing Rust transaction.

## Decision

Forge will derive capability and verification-policy identities inside Rust and
authenticate the host after preparing the disposable boundary but before applying
candidate content. A successful exchange creates an opaque single-use grant. The
provider must validate and consume that grant for the same facts before launching
the verifier.

The kernel protocol may emit a bounded host challenge and accept one correlated
signed statement. TypeScript is transport and signer integration only.

## Why this ordering

- Approval precedes any host prompt.
- Worktree preparation establishes the candidate execution location.
- Authentication precedes candidate mutation and verifier launch.
- Any later failure follows the existing recovery path.

## Honest boundary

This design can prove who made a boundary statement, what exact Forge action the
statement covered, and that it was consumed once. It cannot prove that the
filesystem, process, network, credential, or resource controls are effective.
Host-managed execution will remain described as host-attested, never
Forge-enforced.