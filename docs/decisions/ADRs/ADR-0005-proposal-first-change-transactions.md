# ADR-0005: proposal-first change transactions

- **Status:** accepted for Slice 2A
- **Date:** 2026-07-22
- **Owners:** ForgeEngine project
- **Checkpoint:** 2026-07-22-11
- **Supersedes:** none
- **Superseded by:** none

## Context

The next V1 slice introduces mutation, process execution, recovery, and worktree
decisions. Adding a generic write or terminal tool first would make the model's
incidental actions the transaction boundary and would weaken the evidence protocol.

Forge already returns bounded file evidence. A safe change loop needs an immutable,
reviewable artifact that binds a proposed result to the exact base content before
approval or execution is considered.

## Decision drivers

- evidence before mutation;
- deterministic artifacts across hosts;
- stale-base conflict detection;
- all-or-nothing proposal semantics;
- bounded output and source sizes;
- no implied apply or sandbox guarantee;
- a contract usable by later CLI, MCP, and embedded hosts.

## Options considered

### Expose generic file write and process tools

Fast to demonstrate, but approval, partial failure, review, and recovery become host
conventions rather than Forge contracts.

### Apply unified patches immediately

Reviewable in principle, but parser ambiguity and stale bases can still mutate the
workspace before a durable decision artifact exists.

### Produce a digest-bound proposal before apply

Adds one explicit phase but makes the requested change, base identity, diff, limits,
and approval boundary inspectable before mutation.

## Decision

Slice 2 begins with workspace.change.propose as a Forge-native read-only capability.

Each target must be a canonical snapshotted UTF-8 file and must include the SHA-256
digest returned by Forge read evidence. The proposal produces deterministic before
and after digests plus a bounded unified diff. Any stale digest conflicts the whole
proposal. Exact no-ops are reported without invented changes.

Proposal identity hashes semantic file identities and content digests, not the
chosen diff output bound. The artifact explicitly reports that it did not mutate the
workspace and that approval is required before apply.

The capability is service-only in Slice 2A. MCP mutation exposure, write semantics,
verification commands, worktree design, and rollback remain undecided.

## Consequences

### Positive

- A model cannot silently overwrite a file changed since its evidence read.
- Review and approval can bind to one deterministic proposal ID.
- Diff truncation does not change proposal identity.
- The first Slice 2 artifact is host-neutral and independently testable.

### Negative

- Replacement-text proposals are not yet a full patch language.
- Whole-file replacement can be less efficient than structured edits.
- No developer task is completed until apply and verification are implemented.

### Risks and mitigations

- Duplicate path aliases: reject after canonical snapshot resolution.
- Binary or oversized content: reject before proposal construction.
- Partial proposal on one conflict: return no changes and explicit conflicts.
- Diff volume: byte-bound output while retaining full before and after digests.
- Premature security claims: keep apply and process capabilities unregistered.

## Validation plan

- deterministic proposal for identical inputs;
- source bytes unchanged after proposal;
- stale digest returns an explicit conflict;
- canonical duplicate targets are rejected;
- no-op returns no diff;
- proposal ID is stable across diff bounds;
- full strict check and build suite passes.

## Revisit or replacement conditions

Revisit replacement text after fixtures compare structured edit, unified patch, and
language-aware edit fidelity. Do not replace digest binding or proposal-first
approval without equivalent conflict and audit guarantees.

## References

- docs/architecture/slice-2-change-transaction.md
- tests/change-proposal.test.ts
