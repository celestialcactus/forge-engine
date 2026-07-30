# Slice 2F-1: isolation authority contract

- **Status:** Accepted
- **Opened:** 2026-07-30
- **Accepted:** 2026-07-30
- **Branch:** `feature/slice-2f1-host-auth-restricted-contract`
- **Base:** protected `develop` at `337aea8`
- **Implementation:** `ef0a125`
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

- **Slice 2F-2a (accepted at `71a3ec6`):** signed, freshness-bound,
  capability/policy-bound host challenges with durable replay rejection.
- **Slice 2F-2b:** compose verified challenges into the executing provider and
  bounded host/kernel negotiation protocol.
- **Slice 2F-3:** minimum Windows/macOS restricted backend with adversarial
  filesystem/process/network/credential tests for each advertised control.
- **Slice 2F-4:** high-level MCP mutation workflow over the accepted ChangeSet v2
  contract.

No raw shell or unrestricted file-write tool is introduced by any Slice 2F
increment.

## Acceptance evidence

- Local `npm run check` passed with 37 tests, type checking, and the production
  build. Rust formatting passed. A direct local Rust link remains unavailable on
  this Windows installation because the MSVC linker is not installed; hosted
  native jobs are therefore the Rust execution authority.
- Hosted cross-platform run
  [30559452883](https://github.com/celestialcactus/forge-engine/actions/runs/30559452883)
  passed Windows and macOS. Hosted hybrid run
  [30559452477](https://github.com/celestialcactus/forge-engine/actions/runs/30559452477)
  passed Windows, macOS, and Ubuntu, including Rust format, clippy, tests, release
  build, Node conformance, the sovereign CLI exercise, and the latency gate.
- Six focused authority regressions prove baseline trusted-only support,
  descriptor incoherence rejection, required restricted-control preflight,
  provider/control spoof rejection, missing-control rejection, and a valid
  authenticated-host-shaped contract.
- The worktree transaction regression proves an unauthenticated host-managed
  request launches no verifier, retains no candidate, and leaves the original
  workspace unchanged.
- A fresh controlled VS Code regression retained exactly seven Forge tools, used
  exactly one workspace-summary call, used no built-in tools, and made no
  mutation. It returned run
  `run:02dbeb85-340d-41f5-8080-eb5f362136c7`, snapshot
  `workspace:7b3c009ae89d6632`, 147 files, `truncated: true`, and the canonical
  six-event sequence.

This acceptance proves the authority contract and fail-closed baseline. It does
not prove an authenticated host handshake or operating-system containment.
