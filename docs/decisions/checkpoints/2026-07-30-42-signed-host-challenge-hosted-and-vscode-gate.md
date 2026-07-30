# Checkpoint 42: signed host challenge hosted and VS Code gate

- **Date:** 2026-07-30
- **Status:** accepted
- **Slice:** 2F-2a
- **Implementation:** `71a3ec6`
- **Branch:** `feature/slice-2f2-authenticated-host-handshake`

## Plain-language outcome

Forge can now ask a configured host to sign a one-time question: “For this exact
capability, this exact policy, and these exact required controls, which boundary do
you assert will contain child processes?” The proof expires quickly and is burned
durably when accepted. Reusing it after restart or racing another Forge process
fails closed.

This is the authentication half of host-managed execution. It does not turn that
mode on yet. Slice 2F-2b must obtain the capability/policy digests from Rust-owned
transaction facts and wire only verified evidence into the process provider.

## Implemented machinery

- 256-bit OS-generated nonces and a five-minute maximum challenge lifetime.
- Provider, capability digest, policy digest, and required-control binding.
- Domain-separated, fixed-order, length-prefixed signing bytes with a fixed golden
  challenge/transcript vector for cross-language implementations.
- Strict Ed25519 verification against bounded provider/key trust records. Forge
  stores public keys only.
- Bounded pending/consumed JSON ledgers with regular-file/symlink/path validation.
- Cross-process create-new consumption recorded and synchronized before authority
  evidence is returned.
- Restart inspection that revalidates challenge identity, transcript digest,
  signature, key fingerprint, controls, and timing.
- Explicit repair failure for corrupt or ambiguous consumed state.
- SHA-2 convergence on 0.11 so the new boundary does not ship a duplicate digest
  stack.

## Validation evidence

- Local Rust GNU-toolchain workspace check: passed.
- Local Clippy across all targets with warnings denied: passed.
- Rustfmt: passed.
- Local full Rust execution: unavailable because the workstation lacks a complete
  linker/dlltool chain; no local native test success is claimed.
- Local `npm run check`: 37/37 tests, typecheck, and production build passed.
- Hosted cross-platform run
  [30562764333](https://github.com/celestialcactus/forge-engine/actions/runs/30562764333):
  Windows/macOS passed.
- Hosted hybrid run
  [30562764595](https://github.com/celestialcactus/forge-engine/actions/runs/30562764595):
  Windows/macOS/Ubuntu passed, including Rust format, clippy, tests, release build,
  Node conformance, sovereign CLI, and latency gates.
- Seven focused regressions cover success/golden vector, restart replay,
  concurrent replay, altered/wrong/stale statements, bound identity changes,
  unexpected ledger entries, persisted audit tampering, traversal, and corruption.
- Preliminary resolved-package metadata shows BSD-3-Clause, MIT, Apache-2.0, or
  permitted combinations for the added crypto/randomness graph. Full release
  dependency/license review remains required.
- Controlled VS Code regression: exactly seven Forge tools selected, one
  workspace-summary call, no built-ins, and no mutation. Result: run
  `run:bb67d4d2-57db-4acb-a482-e7a0906c822f`, snapshot
  `workspace:7b3c009ae89d6632`, 147 files, `truncated: true`, and ordered events
  `run.started`, `context.planned`, `capability.requested`, `approval.decided`,
  `capability.completed`, `run.completed`.
- The VS Code workspace remained clean. This is a tether regression, not a host
  authentication or containment test.

## Honest boundary and risk

This checkpoint does **not** provide:

- an executing host-managed provider or host/kernel negotiation transport;
- proof that capability/policy digests came from Rust transaction authority;
- key provisioning, rotation, revocation, or organization policy distribution;
- an OS sandbox or independent verification of the host's containment claim;
- a public MCP mutation workflow.

The ledger is process-crash/restart defensive, not a power-loss transaction. A
crash after reserving a consumed record may burn the challenge and require repair;
it cannot make the challenge reusable. Filesystem attackers with Forge's own OS
identity remain outside this authentication boundary and are addressed by later
containment/privilege work.

## Progress and next gate

The dependable core is conservatively estimated at **94%**. That percentage is
high because the transaction engine and authority contracts are mature; the
remaining work is still platform-risk-heavy. A more honest remaining range is
**2–5 weeks**, dominated by 2F-2b provider/bridge wiring and the adversarial
Windows/macOS restricted backend in 2F-3. The next bounded increment is Slice
2F-2b, not MCP mutation or higher-level intelligence.