# Checkpoint 79: transaction retention and isolation readiness local gate

**Date:** 2026-08-10

**Branch:** `codex/transaction-sandbox-hardening`

**Decision:** accept CLI ship-lane 7A locally; retain native sandbox, hosted, VS Code,
packaging, and license gates

## Objective

Close the unsafe unpublished-transaction cleanup race, make retained ChangeSet work
inspectable without silent deletion, and turn the sandbox gap into an executable
kernel/doctor fact. Preserve one Rust authority and do not label process ownership,
environment clearing, worktrees, or host attestations as OS containment.

## Implemented contract

- Startup acquires the repository publication lock before removing exact unpublished
  transaction staging. A competing coordinator fails closed and cannot delete active
  staging.
- Cleanup validates `.transaction-{64-lowerhex}-{u32 pid}-{u64 timestamp}.tmp`,
  requires a directory, and fails closed on lookalikes and over-limit state roots.
- Published prepared transactions are never age-deleted. At 24 hours they become
  review-due; only exact approved accept/discard operations are destructive.
- Rust exposes a 256-result transaction audit over at most 4,096 state entries,
  prioritized by repair-required, overdue prepared, prepared, then terminal state.
- `SovereignChangeService` retains one coordinator so cleanup, reconciliation, and
  audit report one consistent service lifecycle.
- The private change protocol is `forge.kernel.changeset.v4`; TypeScript validates
  identities, bounds, enums, age, recommendation, and review-due consistency.
- `forge change audit` has bounded JSON and human projections.
- Kernel probe v2 derives isolation capabilities from the selected Rust provider.
  The baseline reports `forge.baseline`, `trusted` only, zero restricted controls,
  and `restrictedReady=false`.
- `doctor` reports the exact provider posture and now rejects an engine root nested
  in or containing the governed workspace before a transaction command is attempted.

## Exact local validation

- Rust format passed.
- Full-workspace/all-target Clippy passed with warnings denied.
- Rust workspace tests passed: `forge-core` 77 passed / 5 helper fixtures ignored,
  all integration suites passed, and `forge-kernel` 9/9 passed.
- Rust workspace build passed.
- TypeScript typecheck, 94/94 Node tests, and production build passed.
- Exact compiled-kernel hybrid suite passed 63/63 with zero skips.
- Official MCP client still discovered and invoked exactly seven read-only Forge
  tools through the Rust kernel.
- Source-tree CLI smoke reported bridge v10, ChangeSet v4, valid external state-root
  separation, trusted-only baseline isolation, and an empty bounded transaction
  audit. The nested-state negative smoke failed with exit 1 as intended.
- `npm audit --omit=dev` reported zero vulnerabilities.
- Changed-source debt-marker scan and `git diff --check` were clean.

## Audit findings

The focused [core correctness and quality audit](../../audit/2026-08-10-core-correctness-and-quality-audit.md)
found and corrected the startup race, duplicate coordinator lifecycle, human audit
rendering, probe versioning, strict host validation, and doctor configuration drift.
It did not find an open transaction-state correctness failure after those changes.

The audit also confirmed two P0 alpha blockers: the 134-entry npm package contains
zero native kernel/watchdog entries, and the repository has no root license while
metadata still declares MIT. These were not papered over with a Windows-only debug
binary or an unapproved license choice.

## Complications and what they meant

1. The pinned MSVC Rust toolchain could not link because Visual Studio build tools
   were absent in this environment. Validation used the already installed pinned
   Windows GNU/LLVM host toolchain and suppressed only rustc's known linker-message
   diagnostic; warnings remained denied.
2. The concurrency regression initially expected blocking lock acquisition. The
   actual contract is intentionally non-blocking fail-closed, so the test asserts
   that behavior and verifies staging survives until an uncontended restart.
3. Recreating the coordinator hid the cleanup count even though cleanup occurred.
   Removing that duplicate lifecycle was required; copying the count into a second
   TypeScript state store would have created another authority.
4. Package smoke initially used state inside the repository. Rust rejected it while
   doctor said healthy, exposing a real preflight inconsistency that is now fixed.
5. The restricted shell denied Node test-worker spawning with `EPERM`. The exact
   trusted project-test rerun passed; this was execution-environment denial, not a
   retried product failure.

## Honest limits

1. No Forge-enforced OS sandbox exists. Restricted execution remains unavailable.
2. Windows AppContainer and the signed macOS App Sandbox helper are decisions and
   acceptance plans, not implemented providers.
3. Exact-head hosted Windows/macOS/Ubuntu and controlled VS Code acceptance remain
   pending.
4. The npm package is structurally valid but unusable as a standalone Forge product
   because it omits the required Rust kernel/watchdog.
5. The root open-source license needs an explicit owner/legal decision.
6. RustSec advisory scanning did not run because `cargo audit` is not installed.
7. The 4,096-entry state ceiling needs an archive/export policy before sustained
   enterprise use.

## Next gate

Publish and run this exact head through hosted Windows/macOS/Ubuntu plus the
controlled VS Code read-only regression. In parallel, define the cross-platform
native package contract and obtain the license decision. The following machinery
increment is the real Windows AppContainer provider; the macOS signed helper must be
implemented and accepted on macOS rather than inferred from Windows.
