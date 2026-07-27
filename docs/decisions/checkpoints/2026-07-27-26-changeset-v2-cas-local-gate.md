# Checkpoint 26: ChangeSet v2 and CAS local gate

**Date:** 2026-07-27
**Status:** Increment 2E-0 accepted
**Branch:** `feature/slice-2e-change-fidelity`
**Accepted implementation:** `fd3d9ebedfe5dd2c19dc2a72f16f83612cc418fa`

## Implemented boundary

`forge-core::change_set_v2` now defines a Rust-owned schema-version-2 control
manifest with five tagged operation variants covering create, replace, delete,
move/rename, repository executable-mode changes, and bounded binary/text content.
Existing-file operations bind the before content digest and repository mode;
replace/move/mode operations also bind the intended after mode.

After-content is represented by a bounded `BlobRef` containing SHA-256, byte count,
and content kind. `FileBlobStore` stages immutable bytes outside the governed
workspace under digest-derived paths. It validates existing content, detects
corruption, and publishes a synced temporary file with an atomic no-overwrite hard
link. Concurrent writers of the same content converge on one verified object.

Manifest validation is order-independent and rejects invalid schema/identity,
absolute/traversal/backslash/drive-style paths, operation path collisions and move
cycles, malformed/stale-shaped digests, no-ops, inconsistent blob metadata,
per-blob/aggregate limits, and the unrecognized symlink operation shape.

Path collision authority is an injected Rust trait rather than unconditional
lowercasing. The first platform implementation rejects Windows reserved/trailing/
invalid path forms and supports detected case-sensitive or case-insensitive Windows
and macOS workspaces. The repository adapter must supply the real workspace case
semantics before v2 can drive mutation.

## Local evidence

`npm run check:hybrid` passes:

- Rust formatting and warnings-as-errors Clippy;
- 19 `forge-core` unit tests, including 11 focused ChangeSet/CAS tests;
- 14 transaction, 5 policy, 7 runtime, and 12 active worktree-adapter tests;
- 3 kernel protocol and 5 active private-bridge tests;
- Rust debug build;
- 37 TypeScript tests, typecheck, and production build;
- 27 hybrid/MCP checks, including the unchanged seven-tool MCP surface.

## Honest limits

- ChangeSet v2 and the CAS are not connected to candidate application or promotion.
  ChangeSet v1 remains the accepted mutation contract until later Slice 2E gates.
- The lexical/platform path resolver is not a substitute for querying the actual
  filesystem/repository case and canonical-name behavior. That adapter is next.
- Repository mode intent is represented and identity-bound, but not yet applied.
- CAS garbage collection, quotas across multiple change sets, schema migration,
  and repair tooling are not implemented.
- File data is synced and publication is atomic/no-overwrite. This does not claim a
  power-loss transaction; Windows directory metadata durability remains unproven.
- Symlinks remain unsupported. No public write, MCP mutation, shell, sandbox, or
  host-authentication capability was added.

## Hosted evidence

Exact implementation `fd3d9ebedfe5dd2c19dc2a72f16f83612cc418fa` passed:

- [Cross-platform conformance](https://github.com/celestialcactus/forge-engine/actions/runs/30287825688) on Windows and macOS, including typecheck, 37 TypeScript tests, production build, and packaged CLI exercise;
- [Hybrid kernel conformance](https://github.com/celestialcactus/forge-engine/actions/runs/30287824859) on Windows, macOS, and Ubuntu, including Rust format/lint/tests/build, accepted TypeScript behavior, 27 hybrid/MCP checks, optimized kernel build, and the process-bridge latency ceiling.

ADR-0009 and Increment 2E-0 are accepted. Slice 2E remains open. The next gate is
the repository-backed path-identity and candidate-operation adapter; ChangeSet v2
still may not mutate the active workspace.
