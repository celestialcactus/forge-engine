# Checkpoint 19: clean-rebuild PR and Slice 2C start

**Date:** 2026-07-23
**Status:** Slice 2 PR opened; Slice 2C design gate opened
**Slice 2 branch:** `feature/slice-2b-change-transaction`
**Slice 2 accepted head:** `bfb670a`
**Slice 2 pull request:** [#1](https://github.com/celestialcactus/forge-engine/pull/1)
**Slice 2C branch:** `feature/slice-2c-host-transaction-bridge`

## Repository decision

Pull request #1 targets the original `master` and deliberately replaces the prototype with the validated reconstruction. The prototype remains under `docs/archive/prototype`, but its abstractions are not architectural authority.

The feature branch is a direct descendant of `origin/master`; the merge base is the current master head. No history rewrite or unrelated base branch is hidden in the PR. Its large diff is expected because this is the clean rebuild, not a compatibility patch over the prototype. The PR remains draft while exact-head checks and human review complete.

## Limitations made explicit

The authoritative build plan now states that Forge has no OS sandbox, host-managed evidence is an allowlisted assertion without an authenticated handshake, and the baseline verifier inherits Forge's process environment and permissions. The existing CLI and seven MCP tools remain read-only; no host-facing transaction CLI, MCP mutation, promotion, or public write capability exists.

The qualified wording matters: Forge already has a read-only CLI, so saying it has "no CLI" would be inaccurate.

## Next-increment finding

The private host bridge cannot simply spawn Rust, receive a verified artifact, and exit. Slice 2B retains a candidate worktree in adapter memory. Without durable identity, that candidate becomes an orphan and later cleanup or promotion cannot safely locate it.

Slice 2C therefore begins with a Rust-owned opaque candidate lease and restart-safe cleanup contract. It then adds a separate bounded transaction protocol and embedded TypeScript adapter. This keeps lifecycle state with Rust machinery and prevents the integration layer becoming a second transaction engine.

## Scope guard

Slice 2C is on a separate branch created exactly from PR #1's head and must not expand that PR. It is private and trusted-mode-only. Host-managed awaits authenticated handshake; restricted awaits Forge-owned containment. Promotion, transaction CLI, and MCP mutation remain later decisions.

See `docs/tasks/SLICE-002C-host-transaction-bridge.md`.
