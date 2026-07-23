# Checkpoint 18: execution isolation contract

**Date:** 2026-07-23
**Status:** accepted
**Branch:** `feature/slice-2b-change-transaction`
**Implementation commit:** `5b7caee0537df194036af0e07ad9813d0cd803cb`
**Accepted commit:** `6e3c5abcca95ce9803ff4193b88941d03f02a495`

## Decision checkpoint

Forge now has a Rust-owned process-isolation provider boundary beneath Slice 2B
verification. The profiles are deliberately precise:

- `trusted` means developer-permission execution with no Forge OS containment;
- `host_managed` means an allowlisted host attests an inherited boundary;
- `restricted` means Forge-enforced containment and currently fails closed.

This is not a global security mode. Approval, policy, capability identity, bounds,
cancellation, recovery, and artifact recording remain active in every profile.

## Implementation evidence

- `crates/forge-core/src/isolation.rs` owns process execution, bounded output,
  timeout, cancellation, descendant cleanup, profile resolution, and evidence.
- `CleanRevisionWorktreeAdapter` delegates verification to an injected
  `IsolationProvider`; it no longer starts the verifier itself.
- `VerificationCheck` owns the required profile and allowed host providers.
- `workspace.change.apply` input binds profile, host provider, and host boundary.
- Every transaction records the requested isolation facts; completed
  `VerificationEvidence` records enforcement provenance, applied controls, and
  limitations.
- Rust transaction validation recovers on inconsistent isolation evidence.

## Local validation

- `npm run check:hybrid`: pass
  - Rust format and Clippy with `-D warnings`: pass
  - Rust active tests: 37
  - TypeScript tests: 37/37
  - hybrid protocol/MCP tests: 22/22
  - Rust workspace build, TypeScript typecheck, and production build: pass
- trusted, host-managed, insufficient-control, unapproved-host, restricted
  fail-closed, approval binding, malformed evidence, timeout, cancellation,
  descendant termination, and candidate recovery paths are covered.


## Hosted validation

The first exact implementation run exposed a macOS-only test-fixture race, not a
product-path failure. Parallel tests used process ID plus wall-clock time for a
temporary repository name; two tests received the same macOS clock value and
raced during `git init`. Test-only commit `6e3c5ab` adds a process-local atomic
sequence. Five repeated local parallel-suite runs passed before repushing.

The accepted commit passed:

- [Hybrid kernel conformance](https://github.com/celestialcactus/forge-engine/actions/runs/30021661766): Windows, macOS, and Ubuntu;
- [Cross-platform conformance](https://github.com/celestialcactus/forge-engine/actions/runs/30021660587): Windows and macOS, including packaged CLI exercise;
- macOS passed the exact Rust step that failed in the first run;
- the official MCP contract remained exactly seven read-only tools.
## Honest limitations

- No Forge-enforced OS sandbox exists yet.
- Host-managed evidence is an allowlisted assertion, not independently verified
  containment; the host handshake is not yet built.
- The baseline child inherits the Forge process environment and permissions.

- No CLI, MCP mutation tool, promotion flow, or public write capability was added.

## Next gate

Build the private host-facing transaction bridge while keeping promotion and the
first Forge-enforced restricted backend as separate explicit increments. The
bridge must obtain host-managed facts from authenticated host configuration, not
model-authored input.