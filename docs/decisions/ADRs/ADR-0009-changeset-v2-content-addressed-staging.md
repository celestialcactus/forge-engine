# ADR-0009: ChangeSet v2 and content-addressed staging

**Status:** Accepted; exact implementation `fd3d9eb` passed hosted Windows/macOS and Ubuntu gates
**Date:** 2026-07-27

## Context

The accepted Slice 2D manifest embeds replacement text and supports only existing
regular UTF-8 files. That was appropriate for proving policy, verification, and
promotion, but it cannot represent common developer changes or efficiently carry
bounded binary content. Expanding the existing replacement struct would couple
large payload transport, operation semantics, and lifecycle persistence.

Windows and macOS also differ in path case behavior, file locking, executable-mode
meaning, and atomic publication details. Those differences must live below one
semantic contract rather than leak into host workflows.

## Decision

Forge will introduce a Rust-owned `ChangeSet v2` whose deterministic manifest
contains bounded, tagged operations and SHA-256 blob references. A local
content-addressed store outside the governed workspace owns the bytes. The first
contract represents create, replace, delete, move/rename, executable-mode intent,
and bounded binary content. Symlink operands are rejected until their policy and
escape semantics receive a separate decision.

The manifest is the control plane; the CAS is the bounded data plane. Rust validates
both and remains the sole authority for application and terminal outcome. TypeScript
may transport manifests and bytes but does not assign canonical paths, identities,
or success.

Path comparison is supplied by the repository/filesystem adapter. It is not defined
as unconditional lowercasing: Windows and typical macOS volumes may be
case-insensitive, while case-sensitive macOS and Linux workspaces remain valid.

## Consequences

- Lifecycle records can reference immutable content without embedding source bytes.
- Retries, deduplication, audit, and recovery share one content identity.
- Create/delete/move/binary changes can enter the same approval and evidence model.
- CAS garbage collection, corruption detection, bounds, and schema migration become
  explicit responsibilities.
- Platform adapters still differ internally, but hosts see one operation contract.
- This does not by itself provide sandboxing, power-loss transactions, or protection
  from external editors; the coordinator and later restricted provider address
  those separate boundaries.

## Rejected alternatives

- **Keep embedding text in manifests:** simple but scales transport and persistence
  with content, excludes binary, and conflates intent with storage.
- **Let TypeScript apply rich edits:** faster initially but creates a second policy
  and transaction authority.
- **Use Git alone as the transaction engine:** Git object identity is useful, but
  Git does not supply Forge approval, active-workspace concurrency policy, terminal
  artifacts, or cross-host lifecycle semantics.
- **Adopt a graph/document database for blobs:** unnecessary operational weight;
  content-addressed files plus small durable journals are sufficient for this slice.

## Acceptance

The ADR becomes accepted only after the Slice 2E-0 contract and CAS pass local and
hosted Windows/macOS gates plus Ubuntu compatibility. Until then, ChangeSet v1
remains the accepted production-private contract.
