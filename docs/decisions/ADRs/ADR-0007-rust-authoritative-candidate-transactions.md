# ADR-0007: Rust-authoritative candidate transactions

- **Status:** accepted for Slice 2B Increment 2B-1
- **Date:** 2026-07-22
- **Owners:** ForgeEngine project
- **Checkpoint:** 2026-07-22-16
- **Supersedes:** none
- **Superseded by:** none

## Context

Slice 2A creates deterministic, digest-bound proposals but intentionally cannot
apply them. The proposal evidence contains before and after digests plus a bounded
diff; it does not contain the exact replacement payload needed for execution.
Resubmitting unrelated text at apply time would break the approval binding.

SGU-003 and SGU-004 establish Rust as the authority for policy, execution state,
cancellation, and recovery. A TypeScript-owned change transaction would recreate
the authority split those gates removed.

A detached Git worktree is an accepted recoverability candidate for a clean
committed base. It is not an operating-system sandbox, cannot represent dirty or
untracked developer state automatically, and does not solve final promotion back
to the active workspace.

## Decision drivers

- exact proposal-to-application binding;
- one Rust-owned transaction status and phase order;
- original workspace unchanged during candidate execution;
- policy-named verification rather than model-supplied commands;
- recovery attempted after every post-boundary failure or cancellation;
- no generic write, shell, or eighth MCP tool;
- bounded, cross-platform behavior suitable for a one-month prototype.

## Options considered

### Let TypeScript apply and report the result

This is fast but makes the integration adapter the transaction authority. Rust
would only record a claim about work it did not schedule or recover.

### Apply the existing bounded diff

The diff is presentation evidence and may be truncated. It is not a complete or
unambiguous executable patch.

### Bind an internal application manifest to the proposal

An internal manifest carries canonical paths, before and after SHA-256 digests,
and exact replacement text. Rust recomputes the proposal identity and replacement
digests before approval or adapter work. Host-facing evidence continues to use
bounded diffs and digests; replacement payloads are not added to MCP output.

## Decision

Slice 2B introduces a Rust-owned candidate transaction beneath the existing
RunArtifact authority.

The first increment validates an internal schema-versioned application manifest,
resolves the existing Rust policy facts for workspace.change.apply, prepares an
isolated candidate boundary, applies the manifest, runs one policy-named
verification check, and produces one deterministic transaction artifact.

The transaction artifact is subordinate capability evidence, not a second run
event stream. The parent Forge run remains the authority for run identity, event
ordering, and terminal status.

A successful first increment ends at verified_candidate. It does not promote the
candidate into the developer's active workspace. Promotion is a later explicit
gate with its own fresh-base check and recovery contract.

## Consequences

### Positive

- Approval and execution refer to the same content.
- TypeScript cannot decide transaction success or recovery status.
- Failed apply, verification, malformed adapter evidence, and cancellation have
  one deterministic recovery path.
- The active workspace can remain unchanged during candidate execution.

### Negative

- Exact replacement text exists in an internal manifest and must later move to a
  content-addressed durable artifact store for crash recovery.
- A verified candidate is not yet a completed developer change.
- Worktree lifecycle, descendant-process termination, and dependency availability
  remain adapter gates.

### Risks and mitigations

- Large replacement payloads: retain Slice 2A limits and never project the
  application manifest through MCP.
- Adapter lies or malformed evidence: Rust validates boundary, applied paths,
  after digests, verification identity, and success consistency.
- Cleanup failure: record it as terminal failure rather than claiming recovery.
- Dirty workspace mismatch: the production adapter must require a clean matching
  revision or reject before creating the candidate.
- Premature sandbox claims: document worktrees as recoverability boundaries only.

## Validation plan

- deterministic verified-candidate phase sequence;
- denial performs zero boundary work;
- tampered replacement content fails before approval or adapter work;
- apply and verification failures recover;
- malformed adapter evidence recovers and cannot advance;
- cancellation after boundary creation recovers;
- cleanup failure is explicit and terminal;
- production adapter later passes Windows, macOS, and Linux fixture gates;
- VS Code and the official MCP client continue to expose exactly seven tools.

## Revisit or replacement conditions

Revisit the internal payload shape when a durable content-addressed artifact store
is introduced. Revisit worktrees if a staged-copy boundary produces better dirty
workspace fidelity without weakening path and digest guarantees. Do not move final
transaction authority into TypeScript.

## References

- docs/architecture/slice-2-change-transaction.md
- docs/architecture/slice-2-windows-worktree-process-boundary.md
- docs/decisions/ADRs/ADR-0005-proposal-first-change-transactions.md
- docs/decisions/ADRs/ADR-0006-hybrid-rust-kernel-evaluation.md
- docs/tasks/SLICE-002B-candidate-transaction.md
