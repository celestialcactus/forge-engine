# Checkpoint 62 - Prepared ChangeSet approval binding accepted

**Date:** 2026-08-04
**Branch:** `feature/cli-edit-verification-composition`
**Implementation:** `3262e3b`
**Base:** merged `develop` at `742b8c8` (PR #18)
**Pull request:** draft PR #19
**Status:** increment 4B-1 accepted; interactive composition is next

## Accepted result

The bounded machinery decision in
[ADR-0023](../ADRs/ADR-0023-prepared-changeset-approval-binding.md) is now validated
against the real product on Tier-1 Windows/macOS and compatibility Ubuntu.

Rust prepares exact ChangeSet v2 identity without creating a candidate or mutating
the source workspace. Approved execution retains the call and Rust decision with
attributable facts, recomputes the ChangeSet, and fails identity drift before
candidate creation. The schema-2 result retains a canonical outcome contract that
requires exact ChangeSet identity, every selected verifier, and durable candidate
registration. MCP remains seven read-only tools.

## Hosted validation

Exact commit `3262e3b` passed all five required jobs:

- cross-platform Node 22 on Windows and macOS: Actions run `30925912676`;
- Rust kernel plus TypeScript product on Windows, macOS, and Ubuntu: Actions run
  `30925913647`.

The hybrid jobs ran native Rust format/lint/tests/build, preserved the ordinary
TypeScript behavior, exercised the differential/MCP/hybrid contract, ran product
CLI auto-discovery, built optimized kernels, retained artifacts, and enforced the
bridge latency ceiling. The new no-consent and stale-prepared-identity cases passed
on every hosted product platform.

## Exact Windows artifact validation

Downloaded Actions artifact `forge-kernel-Windows-X64` (artifact `8899186885`) from
the successful hybrid run. With the exact `forge-kernel.exe`:

- `forge doctor --json` reported kernel `0.1.0`, run bridge v4, transaction v2,
  candidate v1, and sovereign change protocol v3;
- all 41 hybrid tests passed locally with zero skips;
- product doctor plus real workspace inspection smoke passed with outcome
  `verified` and the canonical seven-event sequence.

The first full local hybrid attempt had one harness-only failure: the product
auto-discovery test deliberately removes `FORGE_KERNEL_BINARY` and searches
`target/release`, while the artifact had been downloaded to a separate temp
folder. Copying the exact unchanged binary into that ignored discovery path made
the complete rerun pass. No source correction was required.

## What this does not accept

- The current JSON/policy `forge change propose` command is still an expert/debug
  surface, not the target developer UX.
- A provider is not yet permitted to submit a change-plan capability in the live
  interactive loop.
- The complete edit lifecycle is not yet one canonical RunArtifact.
- Visible interactive approval, diff presentation, and accept/discard prompts remain
  increment 4B-2.
- No MCP mutation tool or OS sandbox was added.

## Next bounded increment: 4B-2

Compose, without a parallel runtime:

1. a CLI-only provider change-plan tool using the existing digest-bound TypeScript
   planner and review diff;
2. Rust preparation of the exact ChangeSet;
3. a visible approval callback naming the ChangeSet and verifier plan;
4. Rust candidate application, bounded verification, and outcome assessment;
5. explicit accept or discard;
6. one attributable run/evidence record for the whole lifecycle;
7. Windows/macOS product tests followed by controlled read-only VS Code inspection.