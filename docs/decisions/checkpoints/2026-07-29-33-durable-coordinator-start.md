# Checkpoint 2026-07-29-33: Durable ChangeSet v2 coordinator start

- **Status:** in-progress
- **Date:** 2026-07-29
- **Related ADRs:** ADR-0009, ADR-0011
- **Scope:** Slice 2E-2 process-crash coordination and full-operation publication

## Objective

Prove that the accepted ChangeSet v2 candidate can be promoted or rolled back
through one Rust-owned, restart-reconcilable transaction without silently
overwriting concurrent developer work.

## Architecture at this checkpoint

ChangeSet v2 validation, CAS staging, and candidate-side application are accepted.
The older text-only lifecycle has durable leases and promotion backups, but there
is no v2 lifecycle record, full-operation active publication, or startup scan for
incomplete v2 transactions.

## Changes since the previous checkpoint

- Started a clean feature branch from protected `develop` at `5a02194`.
- Audited the ChangeSet v2 adapter and the accepted text-only promotion journal.
- Proposed ADR-0011 to generalize the proven filesystem-journal approach without
  creating a database or TypeScript mutation authority.

## Decisions proposed or adopted

| Decision | Status | Rationale | ADR |
|---|---|---|---|
| Use a bounded per-transaction filesystem manifest, before-images, and append-oriented transition journal | Proposed | It directly protects filesystem publication, reuses ChangeSet v2, and avoids premature database packaging | ADR-0011 |
| Treat repository locks as advisory | Proposed | External editors do not participate; exact path identities provide correctness | ADR-0011 |
| Guarantee process-crash recovery before power-loss durability | Proposed | This is the smallest honest functional gate; power-loss testing remains a named release slice | ADR-0011 |

## Validation performed

| Command or experiment | Result | Evidence |
|---|---|---|
| Source and plan audit | Passed | ChangeSet v2 candidate application exists; v2 promotion/coordinator is absent; the text-only journal is reusable precedent |

## Failures and surprises

- The accepted candidate represents executable intent through Git index state on
  Windows. Active-workspace mode publication needs its own explicit Tier-1 proof;
  the coordinator must fail before mutation if it cannot preserve and recover that
  state exactly.

## Known limitations

- No full-operation active promotion exists at checkpoint start.
- No v2 startup reconciliation or transition fault injection exists.
- macOS abrupt verifier-owner death remains a separate Slice 2E gap.
- Forge-enforced restricted execution remains Slice 2F.

## Framework and service inventory

| Dependency/service | Purpose | Why selected | Lock-in/migration risk |
|---|---|---|---|
| Rust standard filesystem APIs | Journal, before-images, atomic path publication | Already shipped; direct semantics under Forge authority | Platform durability details require continued Tier-1 testing |
| Rust standard-library advisory file locks | Prevent concurrent Forge promotion in one repository | Existing accepted mechanism | External tools ignore it; never a correctness boundary |
| Git CLI (existing) | Repository/base/path evidence | Existing cross-platform repository authority | Output and platform behavior remain bounded and tested |

## Repository state

- Branch/commit: `feature/slice-2e-durable-coordinator` from `develop@5a02194`
- Files changed: ADR-0011 and this checkpoint
- Production behavior available: unchanged at checkpoint start

## Next checkpoint

Accept or reject the coordinator after transition fault injection, local and hosted
platform gates, and a controlled VS Code regression run.