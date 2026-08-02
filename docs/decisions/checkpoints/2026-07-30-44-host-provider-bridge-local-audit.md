# Checkpoint 44: host provider/bridge local implementation audit

- **Date:** 2026-07-30
- **Branch:** `feature/slice-2f2b-host-provider-bridge`
- **Base:** protected `develop` at `aa73e0e`
- **State:** local implementation and VS Code tether accepted; hosted/native acceptance pending
- **ADR:** [ADR-0016](../ADRs/ADR-0016-rust-derived-host-execution-grant.md)
- **Task:** [Slice 2F-2b](../../tasks/SLICE-002F2B-host-provider-bridge.md)

## Implemented contract

Rust now derives domain-separated capability and verification-policy identities
from the validated transaction and selected check. After the disposable worktree
exists and before candidate application, the authenticated host provider issues a
short-lived challenge, verifies and durably consumes one Ed25519 host statement,
and creates an opaque one-use execution grant. Before verifier launch it re-reads
the consumed evidence and requires the exact provider, binding, policy controls,
and inherited-process claim.

`forge.kernel.transaction.v2` carries the bounded challenge/statement exchange.
TypeScript may invoke a host-owned signer and transport its response, but it cannot
supply the Rust binding, boundary ID, controls, trust store decision, or grant.
The resulting artifact preserves the full authorization evidence.

## Second-audit corrections

1. The pending-grant lock now covers authorization. A duplicate request fails
   before a second challenge is signed or consumed.
2. Transaction control frames are capped at 64 KiB and the statement channel has
   capacity one. Additional pending statements cancel the transaction rather than
   building an unbounded queue.
3. The corrupt-ledger native regression now asserts the actual stable fail-closed
   error instead of expecting serde implementation wording.
4. Public challenge issuance validates and removes expired pending records before
   capacity enforcement. Invalid or unexpectedly shaped ledger entries still fail
   closed; consumed audit evidence is never silently reaped.

## Local evidence

- Rust workspace check with tests compiled: pass.
- rustfmt check: pass.
- Clippy across all targets with warnings denied: pass.
- `npm run check`: pass, including 39/39 Node tests, typecheck, and production build.
- TypeScript/Rust transcript golden vector: pass within the Node suite.
- Native Rust execution: blocked locally because all installed Windows targets lack
  their required linker (`dlltool.exe`, `link.exe`, or
  `x86_64-w64-mingw32-clang`).

## Remaining acceptance

- Open the draft PR and pass native Windows/macOS plus Ubuntu compatibility gates.
- Prove host-managed success, invalid signature before apply/launch, cancellation
  during negotiation, durable evidence revalidation, and trusted compatibility.
- Only then mark Slice 2F-2b accepted or increase the core-completion estimate.

## VS Code acceptance addendum (2026-08-02)

The exact feature worktree was opened as a trusted VS Code workspace, the MCP
server discovered all seven Forge tools, and no built-in tools were enabled. A
fresh Agent chat made exactly one `forge_workspace_summary` call with
`maxFiles: 20` and completed without retry, artifact externalization, or fallback.
The response reported run `run:859f6ea9-86a2-4cbe-a082-a4f983449654`, snapshot
`workspace:8bd7b47cfdf4b512`, 267 files, `truncated: true`, and ordered events
`run.started`, `context.planned`, `capability.requested`, `approval.decided`,
`capability.completed`, `run.completed`. A post-test `git status --short --branch`
was clean.

## Honest boundary

This checkpoint proves local contract composition and fail-closed ordering. It is
not native cross-platform acceptance, an OS sandbox, restricted execution, key
lifecycle management, organization policy distribution, or a public mutation
surface.
