# Slice 2F-2b: authenticated host provider and bridge

- **Status:** Local implementation complete; hosted/native and VS Code acceptance pending
- **Opened:** 2026-07-30
- **Branch:** `feature/slice-2f2b-host-provider-bridge`
- **Base:** protected `develop` at `aa73e0e`
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu

## Problem

Slice 2F-2a can verify and durably consume a signed host statement, but its
capability and policy digests are still supplied to the ledger by its caller.
Nothing yet proves that those values came from the exact Rust-owned transaction
and verification check. No executing provider consumes the verified evidence, and
the TypeScript/kernel bridge cannot perform the challenge exchange.

Enabling `host_managed` at this point would therefore authenticate bytes without
proving that the bytes describe the operation Forge actually executes.

## Bounded decision

This increment will:

1. Replace caller-supplied host boundary assertions with a provider selection.
   The boundary ID and controls are learned only from verified host evidence.
2. Derive a domain-separated capability digest in Rust from the validated
   transaction, exact capability call, manifest identity, and verification
   selection.
3. Derive a domain-separated policy digest in Rust from the selected verification
   check, process/environment bounds, isolation policy, provider, and controls.
4. Prepare a single-use host execution grant after the disposable boundary is
   created but before candidate content is applied or a verifier is launched.
5. Require the authenticated provider to revalidate the durable consumed evidence
   and exact Rust-derived bindings when it consumes the grant.
6. Add bounded kernel/host challenge and response frames. TypeScript transports
   the Rust-issued challenge to a host signer and returns the signed statement; it
   does not create or reinterpret authority facts.
7. Export the derived digests and complete authenticated host evidence in the
   transaction artifact.

The authenticated provider reuses Forge's accepted process-tree supervision and
environment minimization. Host-managed evidence states that the enclosing host
claims containment; Forge does not independently prove those controls in this
slice.

## Lifecycle

1. Validate the transaction and resolve approval.
2. Prepare the disposable worktree boundary.
3. Derive exact capability and policy bindings in Rust.
4. Issue, exchange, verify, and durably consume the host challenge.
5. Record the single-use execution grant.
6. Apply the candidate change.
7. Consume the grant and launch the verifier.
8. Validate and export the resulting isolation evidence.
9. Retain only a verified candidate; otherwise recover the boundary.

Failure or cancellation during steps 3-5 must recover the prepared worktree before
candidate application. Failure after application must recover it before return.

## Acceptance gates

- Raw caller-provided boundary IDs, controls, signatures, capability digests, and
  policy digests cannot enable host-managed execution.
- Capability and policy digests are deterministic, domain separated, and change
  when any bound semantic fact changes.
- A challenge for one transaction/check/provider cannot authorize another.
- Host authentication completes before candidate application and verifier launch.
- Grants are single-use and cannot be constructed by TypeScript or replayed through
  the provider.
- The provider re-reads and validates consumed ledger evidence before launch.
- Altered, stale, replayed, mismatched, missing, or corrupt evidence fails closed.
- Negotiation frames are newline terminated, size bounded, request correlated, and
  cancellation/expiry aware.
- The exported artifact reconstructs provider, key, challenge, capability, policy,
  boundary, controls, signature, and timestamps.
- Trusted transactions remain behaviorally compatible.
- Native Rust and hybrid gates pass on Windows/macOS; Ubuntu remains compatible.
- The controlled seven-tool VS Code read-only tether remains mutation free.

## Local implementation checkpoint

The feature branch now contains the Rust-derived binding, authenticated provider,
one-use grant, durable evidence revalidation, transaction v2 challenge/statement
frames, and TypeScript signer transport described above. A second audit added these
service-core corrections before hosted validation:

- duplicate authorization is rejected before another challenge is issued or
  consumed;
- at most one 64 KiB host statement may be pending in the transaction protocol;
- corrupt consumed evidence has a regression matching the actual fail-closed
  error path; and
- expired abandoned challenges are validated and reaped before the pending-ledger
  capacity gate, preventing handshake failures from permanently exhausting it.

Local gates pass Rust workspace check, rustfmt, all-target Clippy with warnings
denied, and `npm run check` with 39/39 Node tests. Native Rust test execution is
still unavailable on this workstation: GNU lacks `dlltool.exe`, MSVC lacks
`link.exe`, and GNU/LLVM lacks `x86_64-w64-mingw32-clang`. Hosted Windows/macOS/
Ubuntu runners remain the executable authority. The controlled VS Code tether is
also still pending for this head.

Core completion remains 94% until those external gates pass. Consumed host records
remain bounded and durable; retention/export/rotation is an explicit later policy
problem and Forge does not silently delete audit evidence.

## Explicitly deferred

- Forge-enforced filesystem, process, network, credential, or resource containment.
- The minimum real Windows/macOS restricted provider (Slice 2F-3).
- Key provisioning, rotation, revocation, organization policy distribution, and
  remote attestation.
- Public CLI or MCP host-managed mutation.
- Generic shell or unrestricted write capabilities.

Passing this slice proves authenticated provider composition. It does not prove
that the enclosing host's claimed controls are effective.