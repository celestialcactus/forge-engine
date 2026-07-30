# Checkpoint 37: sovereign CLI convergence start

- **Date:** 2026-07-30
- **Branch:** `feature/slice-2e3b-sovereign-cli`
- **Base:** `develop` at `e0d2213`
- **Decision:** implement Slice 2E-3b through the durable ChangeSet v2 authority

## Closed prerequisite

Slice 2E-3a passed its post-merge gates:

- cross-platform Node run `30553189976` passed Windows and macOS; and
- hybrid run `30553189891` passed Windows, macOS, and Ubuntu.

## Audit finding

The current CLI can inspect, accept, and discard candidates through
`forge.kernel.candidate.v1`, while proposal/verification uses
`forge.kernel.transaction.v1`. Both are tied to the older text-replacement
contract. The full-operation durable coordinator from Slice 2E-2 is not exposed.

This is a convergence gap, not a reason to add an integration-layer workflow.

## Chosen increment

Create one Rust-owned ChangeSet v2 service and bounded kernel protocol. The service
must stage proposal bytes, derive repository identities, apply and verify an
external candidate, durably register it, reconcile it after restart, and own
accept/discard cleanup. The TypeScript CLI only reads explicit files, transports
requests, handles cancellation, and renders artifacts.

## Named risks

- Candidate cleanup must be part of terminal-state semantics, not best effort.
- Verification evidence must survive the process that created the candidate.
- A proposal must not be able to smuggle in an executable or command.
- Trusted verification remains unsandboxed; lifecycle ownership is not containment.
- Old protocols cannot quietly remain a second advertised workflow.

## Next evidence

The closing checkpoint must record local and hosted matrices, disposable-repository
CLI outcomes, failure/cancellation and restart fixtures, candidate cleanup proof,
and the controlled VS Code regression.