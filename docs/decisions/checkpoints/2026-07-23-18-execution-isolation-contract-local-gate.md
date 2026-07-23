# Checkpoint 18: execution isolation contract local gate

**Date:** 2026-07-23
**Status:** local gate passed; hosted acceptance pending
**Branch:** `feature/slice-2b-change-transaction`

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
- Every transaction records the requested isolation facts; completed `VerificationEvidence` records enforcement provenance, applied controls, and limitations.
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

## Honest limitations

- No Forge-enforced OS sandbox exists yet.
- Host-managed evidence is an allowlisted assertion, not independently verified
  containment; the host handshake is not yet built.
- The baseline child inherits the Forge process environment and permissions.
- The exact implementation still requires the hosted Windows/macOS/Linux matrix
  before this checkpoint can be accepted.
- No CLI, MCP mutation tool, promotion flow, or public write capability was added.

## Next gate

Run the full hybrid suite, review the diff for authority leakage, then push an exact
commit for hosted Windows/macOS/Linux conformance. After acceptance, build the
private host-facing transaction bridge while keeping promotion and the first
restricted backend as separate explicit increments.