# Checkpoint 25: Slice 2E Windows/macOS-first start

**Date:** 2026-07-27
**Status:** Open
**Branch:** `feature/slice-2e-change-fidelity`
**Base:** accepted Slice 2D documentation checkpoint `3b2b62f`

## Decision checkpoint

Windows and macOS are now Tier-1 ForgeEngine platforms. Ubuntu remains a required
compatibility gate, but new developer machinery is accepted only after both primary
enterprise desktop environments pass their relevant semantics and hosted matrices.

Slice 2D is accepted but intentionally narrow. Slice 2E will build the missing core
rather than moving on to memory, compression, or skills: ChangeSet v2, content-
addressed staging, richer bounded operations, a durable transaction coordinator,
concurrent-edit protection, graceful cancellation, and a complete high-level local
CLI flow.

The security gaps now have an explicit destination. Slice 2F owns authenticated
host-managed negotiation, policy/audit exchange, a minimum real restricted backend
for Tier-1 platforms, and one high-level MCP/VS Code mutation workflow. Trusted mode
continues to state that it is not contained; restricted mode continues to fail
closed until its backend is proven.

## Plain-language impact

Forge can already safely replace a known text file. The next work makes it capable
of handling the shapes of change developers actually make and of remembering what
it was doing if its process dies. Windows and macOS have different filesystem and
process edge cases, so passing on one will never be treated as proof for the other.

## First gate

Implement only the Rust ChangeSet v2 validator and content-addressed blob boundary.
Do not connect it to active-workspace mutation until invalid operation graphs,
corrupt/missing blobs, bounds, and platform path collisions are covered by tests.
