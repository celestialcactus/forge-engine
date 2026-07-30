# Slice 2F-1: isolation authority contract

- **Status:** In progress
- **Opened:** 2026-07-30
- **Branch:** `feature/slice-2f1-host-auth-restricted-contract`
- **Base:** protected `develop` at `337aea8`
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu

## Problem

The baseline isolation provider currently accepts `host_managed` requests after
checking an allowlisted provider ID and caller-supplied control claims. Those facts
are not authenticated. A caller that can construct the request can construct the
attestation.

The restricted-provider seam also lacks a typed capability descriptor. Evidence
can identify a provider and controls, but the core does not yet prove that they
match the provider's advertised support and every policy-required control.

## Decision

1. The baseline provider supports `trusted` execution only.
2. Raw `host_managed` assertions fail before a verifier starts.
3. Every isolation provider exposes a bounded Rust-owned capability descriptor:
   provider ID, supported profiles, authenticated-host support, and enforceable
   restricted controls.
4. Forge validates the descriptor before execution and validates returned evidence
   against the request, policy, and descriptor afterward.
5. No provider may advertise `host_managed` unless it authenticates host claims.
6. No provider may return `forge_enforced` controls it did not advertise.

This slice defines and enforces the authority seam. It does not implement a host
signature protocol or an operating-system sandbox. Those become separate Slice
2F increments behind this gate.

## Acceptance gates

- Baseline trusted execution retains current timeout, cancellation, environment,
  output, and process-tree behavior.
- A raw host-managed request through the baseline provider fails before launch.
- Invalid provider descriptors fail before launch.
- A provider/profile mismatch fails before launch.
- Host-managed evidence requires a descriptor that explicitly supports
  authenticated host attestations.
- Restricted evidence must include every policy-required control, contain no
  unadvertised control, identify the executing provider, and claim Forge
  enforcement.
- Failed validation cannot retain or promote a candidate.
- Existing Node, Rust, hybrid, and sovereign CLI suites remain green on
  Windows/macOS/Ubuntu.
- The seven-tool VS Code read-only regression remains one-call and mutation-free.

## Deferred by name

- **Slice 2F-2:** authenticated, freshness-bound, capability-bound host negotiation
  with stale/spoof/replay rejection and durable audit evidence.
- **Slice 2F-3:** minimum Windows/macOS restricted backend with adversarial
  filesystem/process/network/credential tests for each advertised control.
- **Slice 2F-4:** high-level MCP mutation workflow over the accepted ChangeSet v2
  contract.

No raw shell or unrestricted file-write tool is introduced by any Slice 2F
increment.
