# Checkpoint 31: verifier process ownership local gate

**Date:** 2026-07-28
**Status:** Local gate passed; hosted acceptance pending
**Branch:** `feature/slice-2e-process-ownership`
**Base:** protected `develop` at `c14edf5e1c668c4c69a5dc02cb17246493087f86`
**Decision:** ADR-0010

## Outcome

The Windows verifier lifecycle no longer uses `taskkill`. Rust now creates a
kill-on-close Job Object before the verifier, starts the verifier suspended,
assigns it to the job, validates/resumes its primary thread, and confirms the job
has no active process after teardown. An assignment failure prevents verifier code
from running. Closing the owner handle also terminates the hierarchy if Forge is
forcibly killed.

Unix/macOS still uses a pre-exec process group, now with checked signals and an
explicit empty-group confirmation. One `OwnedProcessTree` drives timeout,
cancellation, direct-child exit, observation error, early return, and drop cleanup.

## Local evidence

- Five consecutive focused stress passes succeeded. Each pass exercised three
  nested timeout trees, three nested cancellation trees, and one Windows abrupt
  owner-death tree: 35 nested process hierarchies total with no surviving
  grandchild.
- A successful direct verifier exit with a live child/grandchild also terminated the
  remaining hierarchy; the original worktree transaction regression passed.
- `npm run check:hybrid` passed Rust format, warnings-as-errors Clippy, all Rust
  suites/build, TypeScript typecheck, 37 tests/build, 27 hybrid/MCP assertions, the
  private CLI lifecycle, and the unchanged seven read-only MCP tools.
- The first `windows-sys` 0.61 evaluation failed the executable link gate because it
  required external `dlltool.exe` on the accepted GNU toolchain. Pinning target-only
  0.59 retained Cargo-contained import libraries and passed the complete gate.

## Honest limits

- Job ownership controls lifetime, not filesystem, network, credentials,
  privileges, subprocess behavior while alive, or resource consumption.
- macOS/Unix does not yet kill the verifier automatically if the Forge supervisor
  itself is forcibly terminated. A watchdog/parent-death mechanism remains P1.
- Hosted Windows/macOS/Ubuntu evidence is pending; this checkpoint is not yet an
  accepted cross-platform increment.
- A host job incompatible with nested assignment fails before verifier execution;
  installation diagnostics are not implemented yet.
- The future Forge `restricted` isolation profile remains unsupported.

## Delivery forecast at this checkpoint

Completion is measured by accepted behavioral gates, not source volume:

| Scope | Estimated complete | What remains |
| --- | ---: | --- |
| Core runtime and dependable local change machinery | 68% | Hosted ownership gate, macOS abrupt-owner handling, durable ChangeSet v2 coordinator/reconciliation, full-operation promotion/rollback, and final fault injection. |
| Shippable standalone CLI alpha | 42% | Core closure plus runtime convergence, one measured local and one cloud inference path, interactive multi-turn loop, effective configuration/doctor, packaging, and clean-install smoke tests. |
| Broader V1 platform | 25% | Context quality gates, durable projections, reviewed skills/memory, symmetric mutation integrations, restricted execution, connectors, and release hardening. |

Assuming one focused implementation lane, working hosted CI, and no scope expansion:

- curated evidence-backed CLI demo: **2–3 weeks**;
- dependable core local change engine: **3–5 weeks**;
- shippable standalone CLI alpha: **6–9 weeks**;
- broader enterprise pilot with real restricted execution and policy integration:
  **12–16 weeks**.

These are planning ranges, not commitments. Provider-access delays, macOS watchdog
complexity, packaging/signing, or new containment requirements move the dates.

## Next gate

Obtain hosted Windows/macOS/Ubuntu evidence for this exact implementation. Then
build the durable ChangeSet v2 coordinator and active-workspace publication path,
while closing the macOS abrupt-owner-death gap before Slice 2E completion.