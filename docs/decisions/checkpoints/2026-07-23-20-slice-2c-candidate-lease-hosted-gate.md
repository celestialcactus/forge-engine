# Checkpoint 20: Slice 2C candidate lease hosted gate

**Date:** 2026-07-23
**Status:** Increment 2C-0 accepted; private protocol remains pending
**Branch:** `feature/slice-2c-host-transaction-bridge`
**Implementation commit:** `4c248e62b62c53f59899ea1cf7132a00d70ac1ac`
**Accepted correction:** `a985119d9e17336ed12ce810d0f05194ad32b11c`

## Decision checkpoint

Forge can now retain a verified candidate across the lifetime of the creating Rust process without losing its identity. Rust issues an opaque candidate ID and writes bounded, append-only lifecycle transitions outside the governed workspace. A new store instance can load that identity, record cleanup failure, retry discard, and prove the candidate path was removed while the original workspace remained unchanged.

The lease is deliberately narrow. It contains canonical machine-local paths, repository/base/proposal/snapshot identities, before/after digests, diff digest, timestamps, and lifecycle status. It contains neither replacement text nor a public mutation instruction. It is not the general Forge event store and possession of the ID does not authorize promotion.

The approved `workspace.change.apply` subject now includes the expected base revision. Rust rejects a prepared boundary whose actual base does not match that approved revision.

## Platform finding and correction

The first hosted implementation passed macOS and Windows but failed one parallel Ubuntu discard. Closing the lock file implicitly was insufficiently reliable for the advisory-lock lifecycle used by the Linux test process; the next operation observed the same lease as still locked.

Commit `a985119` wraps the file in an explicit Rust RAII unlock guard. The same correction also phase-synchronizes the hybrid approval-cancellation fixture. Its previous 25 ms timer could abort during planning on a slower build and test the wrong phase; it now waits until the approval collector is actually active and then cancels a deliberately non-cooperative provider.

These are bounded cross-platform machinery and test-contract corrections. They do not expand the product surface.

## Validation

Local complete gate passed:

- Rust format and Clippy with warnings denied;
- 39 active Forge core tests, including restart lookup, failed-cleanup evidence, retry, idempotent discard, and base-revision binding;
- Rust workspace build;
- 37 TypeScript tests and production build;
- 22 hybrid/MCP checks;
- three additional consecutive hybrid runs of the synchronized cancellation fixture.

Exact accepted commit hosted gates passed:

- [Cross-platform conformance](https://github.com/celestialcactus/forge-engine/actions/runs/30028544726): Windows and macOS TypeScript, build, and packaged read-only CLI;
- [Hybrid kernel conformance](https://github.com/celestialcactus/forge-engine/actions/runs/30028544758): Windows, macOS, and Ubuntu Rust/TypeScript/hybrid/MCP/latency gates.

## Honest boundary after 2C-0

- No private transaction protocol or TypeScript transaction adapter exists yet.
- No transaction CLI, MCP mutation tool, promotion flow, or public write exists.
- The lease makes a verified candidate recoverable; it does not make execution sandboxed.
- `host_managed` remains unavailable to the future bridge until authenticated handshake work exists; `restricted` remains unavailable until Forge owns an OS isolation backend.

## Next gate

Implement bounded `forge.kernel.transaction.v1` dispatch in Rust while preserving `forge.kernel.bridge.v2`. The transaction protocol must support bounded frames, structured terminal failure, trusted-only policy configuration, and in-flight cancellation without transferring final policy or transaction status to TypeScript.
