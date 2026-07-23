# SGU-005: Execution isolation contract

- **Status:** implemented locally; hosted cross-platform gate pending
- **Opened:** 2026-07-23
- **Branch:** feature/slice-2b-change-transaction
- **Decision:** ADR-0008
- **Does not implement:** a Forge-enforced restricted sandbox

## Objective

Put an interchangeable isolation-provider boundary underneath the accepted Slice
2B verification process before the host-facing mutation flow is built. Preserve
one Rust transaction authority while supporting honest `trusted` and
`host_managed` evidence and failing closed for unavailable `restricted` execution.

## Scope

1. Define request, policy, provider, process, and evidence contracts in Rust.
2. Move verifier launch and lifecycle ownership behind the provider interface.
3. Bind isolation selection to the approved capability input.
4. Keep isolation requirements in policy-owned verification configuration.
5. Implement the baseline `trusted` and `host_managed` paths.
6. Reject `restricted` with no verifier execution and recover the candidate.
7. Preserve the seven read-only MCP tools and defer public mutation wiring.

## Acceptance

- no worktree or trusted process is described as a sandbox;
- `trusted` retains approval and all non-OS transaction controls;
- host-managed execution requires an allowlisted provider, inherited boundary, and
  attested controls satisfying the policy minimum;
- evidence distinguishes no enforcement, host attestation, and future Forge
  enforcement;
- inconsistent adapter evidence cannot retain a candidate;
- a restricted request cannot silently fall back to trusted execution;
- Rust format, Clippy, tests, full hybrid conformance, and hosted Windows/macOS/Linux
  pass before acceptance.

## Deferred work

- authenticated TypeScript/host handshake for host isolation facts;
- host-facing candidate transaction bridge or CLI;
- Linux, Windows, and macOS restricted-provider spikes;
- promotion of a verified candidate into the active workspace;
- sandbox routing for MCP servers and other future process capabilities.