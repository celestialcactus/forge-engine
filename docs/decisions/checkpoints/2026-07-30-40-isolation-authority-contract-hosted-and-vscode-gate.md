# Checkpoint 40: isolation authority contract hosted and VS Code gate

- **Date:** 2026-07-30
- **Status:** accepted
- **Slice:** 2F-1
- **Implementation:** `ef0a125`
- **Branch:** `feature/slice-2f1-host-auth-restricted-contract`

## Plain-language outcome

Forge used to accept a caller-supplied statement that an enclosing host had
sandboxed the verifier. The evidence label was honest, but the caller could forge
the statement. That executable shortcut is now removed.

The baseline provider runs only the explicit `trusted` profile. A host-managed or
restricted request fails before the verifier launches unless a separately wired
provider advertises and can defend that authority. Forge validates the provider's
advertised profiles and controls before launch, then validates its returned
evidence against the request and policy before a candidate can be retained.

## What was implemented

- `IsolationProviderCapabilities` records provider identity, supported profiles,
  authenticated-host authority, and enforceable restricted controls.
- Provider descriptors are rejected when empty, duplicate, or internally
  inconsistent.
- Request preflight rejects unsupported profiles and missing required controls
  before `execute`.
- Returned evidence must match the executing provider, requested/effective
  profile, enforcement provenance, policy-required controls, and advertised
  controls.
- `forge.baseline` advertises trusted execution only.
- Failed host/restricted validation launches no verifier, retains no candidate,
  and leaves the original workspace unchanged.

## Validation evidence

- Local `npm run check`: passed, 37 tests plus type checking and production build.
- Rust formatting: passed.
- Local Rust link: not available because this Windows installation lacks the MSVC
  linker; no local-link success is claimed.
- Hosted cross-platform run
  [30559452883](https://github.com/celestialcactus/forge-engine/actions/runs/30559452883):
  passed Windows and macOS.
- Hosted hybrid run
  [30559452477](https://github.com/celestialcactus/forge-engine/actions/runs/30559452477):
  passed Windows, macOS, and Ubuntu, including Rust format, clippy, tests, release
  build, Node conformance, sovereign CLI, and latency gates.
- Controlled VS Code read-only regression: exactly seven Forge tools selected,
  exactly one workspace-summary call, no built-in tools, and no mutation. Result:
  run `run:02dbeb85-340d-41f5-8080-eb5f362136c7`, snapshot
  `workspace:7b3c009ae89d6632`, 147 files, `truncated: true`, with ordered events
  `run.started`, `context.planned`, `capability.requested`, `approval.decided`,
  `capability.completed`, `run.completed`.
- The VS Code workspace remained clean. This read-only regression proves tether
  compatibility, not the new restricted execution path.

## Honest boundary

This checkpoint does **not** add:

- an OS sandbox or permission containment;
- authenticated host identity, freshness, or replay resistance;
- a Windows or macOS restricted provider;
- a public MCP mutation tool;
- a generic shell or unrestricted write capability.

The executing provider is selected by trusted Rust composition, not from a
caller-deserialized capability descriptor. Slice 2F-2 must add the actual
authenticated host handshake. Slice 2F-3 must prove a minimum restricted backend
on Windows and macOS. Slice 2F-4 may then expose one bounded high-level mutation
workflow through MCP.

## Progress and next gate

The dependable core is conservatively estimated at **93%**, up from 92% because
the provider/evidence authority gap is closed, not because containment exists.
With one focused lane and healthy hosted CI, the remaining dependable-core work
still estimates at **1–3 weeks**. The next bounded increment is Slice 2F-2:
authenticated, freshness-bound, capability-bound host negotiation with
spoof/stale/replay rejection and durable decision evidence.