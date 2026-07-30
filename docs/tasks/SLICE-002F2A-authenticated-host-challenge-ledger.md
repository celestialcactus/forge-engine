# Slice 2F-2a: authenticated host challenge ledger

- **Status:** Accepted
- **Opened:** 2026-07-30
- **Accepted:** 2026-07-30
- **Branch:** `feature/slice-2f2-authenticated-host-handshake`
- **Base:** protected `develop` at `6edd79a`
- **Implementation:** `71a3ec6`
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

## Acceptance evidence

- Rust workspace check and Clippy with warnings denied passed under the installed
  Windows GNU toolchain; Rustfmt passed.
- Full local Rust test execution is unavailable because this workstation lacks a
  complete native linker/dlltool chain. Hosted native jobs are the execution gate.
- Seven focused host-authority regressions cover the fixed signing vector,
  successful consumption, restart replay, concurrent replay, altered/wrong/stale
  statements, capability/policy/control identity binding, ledger shape, persisted
  audit tampering, traversal, and corrupt evidence.
- Local `npm run check` passed all 37 Node tests, type checking, and the production
  build.
- Hosted cross-platform run
  [30562764333](https://github.com/celestialcactus/forge-engine/actions/runs/30562764333)
  passed Windows/macOS. Hosted hybrid run
  [30562764595](https://github.com/celestialcactus/forge-engine/actions/runs/30562764595)
  passed Windows/macOS/Ubuntu, including Rust format, clippy, tests, release build,
  Node conformance, sovereign CLI, and latency gates.
- Forge and Ed25519 now share `sha2` 0.11; `cargo tree -d` reports only the
  unavoidable proc-macro `syn` major-version split, not duplicate digest stacks.
- Preliminary Cargo metadata reports the new cryptography/randomness dependency
  licenses as BSD-3-Clause, MIT, Apache-2.0, or permitted combinations. Full
  release dependency review remains a release gate.
- A fresh controlled VS Code regression retained exactly seven Forge tools, used
  one workspace-summary call, no built-ins, and no mutation. It returned run
  `run:bb67d4d2-57db-4acb-a482-e7a0906c822f`, snapshot
  `workspace:7b3c009ae89d6632`, 147 files, `truncated: true`, and the canonical
  six-event sequence.

This accepts the signed challenge ledger only. Host-managed execution remains
unavailable until Slice 2F-2b binds Rust-owned transaction facts, performs the host
exchange, and composes verified evidence into the executing provider.