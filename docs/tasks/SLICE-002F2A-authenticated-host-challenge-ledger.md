# Slice 2F-2a: authenticated host challenge ledger

- **Status:** In progress
- **Opened:** 2026-07-30
- **Branch:** `feature/slice-2f2-authenticated-host-handshake`
- **Base:** protected `develop` at `6edd79a`
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu

## Problem

Slice 2F-1 removed raw host-managed assertions, but Forge still has no protocol for
proving that a trusted host authorized a specific isolation boundary for a specific
capability and policy decision. A reusable signature or an in-memory nonce is not
enough: stale and replayed proofs must fail across process restarts and concurrent
Forge processes.

## Bounded decision

This increment adds a Rust-owned host-authority challenge ledger:

1. Forge issues a cryptographically random, short-lived challenge.
2. The challenge binds provider identity, the exact capability digest, the exact
   policy digest, and required isolation controls.
3. A configured host key signs a domain-separated, length-prefixed transcript that
   combines the persisted challenge with the host's boundary statement.
4. Forge verifies the Ed25519 signature strictly against a provider/key trust
   record. Forge stores public keys only; private signing keys remain with the host.
5. Forge creates a durable consumed record with create-new semantics before
   returning verified evidence. Only one process can consume a challenge.
6. Restart, concurrent, stale, altered, wrong-provider/key, and replay attempts fail
   closed and remain inspectable.

The on-disk ledger is bounded JSON for issued/consumed facts. It is process-crash
and restart defensive, not yet a power-loss transaction. Corrupt or ambiguous
state fails closed and requires repair rather than silently reissuing authority.

## Acceptance gates

- OS CSPRNG failure prevents challenge issuance.
- Challenge IDs, TTL, digests, provider/key IDs, controls, and all persisted files
  are strictly bounded and traversal-safe.
- Transcript encoding is deterministic and domain separated.
- Strict signature verification rejects altered statements, altered challenges,
  weak/invalid keys, wrong keys, and malformed signatures.
- Verification rejects not-yet-valid and expired challenges.
- Capability, policy, provider, key, boundary inheritance, and required controls
  are bound to the signed transcript.
- A successful consumption writes durable audit evidence before returning.
- Replay fails in the same process, a new authority instance, and a concurrent
  consumer race.
- Missing/corrupt/mismatched ledger records fail closed.
- Native Rust gates pass on Windows/macOS; Ubuntu remains compatible.
- Existing trusted transactions, Node behavior, sovereign CLI, and seven-tool
  read-only VS Code behavior do not regress.

## Explicitly deferred

- **Slice 2F-2b:** compose verified host authority with an executing host-managed
  provider, kernel/host negotiation frames, policy distribution, cancellation, and
  exported decision evidence.
- **Slice 2F-3:** minimum Forge-restricted Windows/macOS backend.
- **Slice 2F-4:** high-level MCP mutation workflow.

No private signing key, generic shell, unrestricted write, public host-managed
execution, or OS sandbox is added by this increment.