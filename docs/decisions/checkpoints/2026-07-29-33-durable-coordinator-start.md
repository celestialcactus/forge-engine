# Checkpoint 2026-07-29-33: Durable ChangeSet v2 coordinator start

- **Status:** completed; accepted by Checkpoint 2026-07-30-34
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
| Use a bounded per-transaction filesystem manifest, before-images, and append-oriented transition journal | Accepted | It directly protects filesystem publication, reuses ChangeSet v2, and avoids premature database packaging | ADR-0011 |
| Treat repository locks as advisory | Accepted | External editors do not participate; exact path identities provide correctness | ADR-0011 |
| Guarantee process-crash recovery before power-loss durability | Accepted | This is the smallest honest functional gate; power-loss testing remains a named release slice | ADR-0011 |

## Validation performed

| Command or experiment | Result | Evidence |
|---|---|---|
| Source and plan audit | Passed | ChangeSet v2 candidate application existed; the text-only journal supplied a bounded precedent |
| Local TypeScript gate | Passed | `npm run check`: typecheck, 37/37 tests, and build |
| Hosted cross-platform gate | Passed | Windows/macOS run `30511168395` |
| Hosted hybrid kernel gate | Passed | Windows/macOS/Ubuntu run `30511168400` |
| Controlled VS Code regression | Passed | One `forge_workspace_summary` call; full evidence in Checkpoint 34 |

## Failures and surprises

- The accepted candidate represents executable intent through Git index state on
  Windows. Active-workspace mode publication needs its own explicit Tier-1 proof;
  the coordinator must fail before mutation if it cannot preserve and recover that
  state exactly.

## Known limitations

- Full-operation active promotion and process-restart reconciliation are now accepted.
- Power-loss durability and repair tooling remain release-hardening work.
- macOS abrupt verifier-owner death remains a separate Slice 2E gap.
- Forge-enforced restricted execution remains Slice 2F.

## Framework and service inventory

| Dependency/service | Purpose | Why selected | Lock-in/migration risk |
|---|---|---|---|
| Rust standard filesystem APIs | Journal, before-images, atomic path publication | Already shipped; direct semantics under Forge authority | Platform durability details require continued Tier-1 testing |
| Rust standard-library advisory file locks | Prevent concurrent Forge promotion in one repository | Existing accepted mechanism | External tools ignore it; never a correctness boundary |
| Git CLI (existing) | Repository/base/path evidence | Existing cross-platform repository authority | Output and platform behavior remain bounded and tested |

## Repository state

- Branch/commit: `feature/slice-2e-durable-coordinator` at implementation `8c29037` from `develop@5a02194`
- Files changed: Rust coordinator/tests, ADR-0011, task/build-plan records, and Checkpoints 33–34
- Production behavior available: private Rust ChangeSet v2 coordination; no public mutation surface

## Next checkpoint

Checkpoint 2026-07-30-34 records acceptance, hosted platform evidence, the
controlled VS Code regression, and the remaining Slice 2E-3 boundaries.
