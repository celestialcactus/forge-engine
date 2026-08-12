# Checkpoint 82: commodity sandbox conformance completion

**Date:** 2026-08-12
**Branch:** `codex/transaction-sandbox-hardening`
**Decision:** adapt the managed Windows provider pattern in a later Rust-owned
slice; do not adopt or promote `@anthropic-ai/sandbox-runtime@0.0.71` here

## Outcome

The bounded spike gate is complete. A Rust-generated schema-v4 corpus bound 17
unique launches and plans. The temporary SRT adapter executed all 17 without a
case retry or fallback and passed filesystem, sensitive-read, direct-network,
credential/environment, descendant, timeout, cancellation, broker-owner-death,
residue, and representative toolchain cases. ACL snapshots, recovery directories,
helper/broker process inventories, and provider account/WFP behavior were clean or
stable after every run.

This is not production restricted readiness. The evaluated plan requires
filesystem, process, network, and credential controls. SRT's published Windows
surface does not represent Forge's process-count and process-memory ceilings, so
the adapter rejects any plan containing the `resources` control. The current
AppContainer preview passed its native baseline but still cannot execute the same
toolchain-projection corpus. No provider status or `restrictedReady` claim changed.

Rust remains authoritative for plan compilation, launch binding, provider
selection, policy/transaction decisions, lifecycle truth, and evidence. The
JavaScript file is a temporary execution adapter only. It validates the exact
Rust record, rejects unknown/mismatched/resource-bearing plans, never compiles or
broadens policy, and has no fallback path.

## Files changed by this completion pass

- `crates/forge-core/src/isolation.rs` and its construction/test call sites:
  schema-v4 `EffectiveSandboxPlan` now binds canonical readable,
  denied-read, and denied-write roots into the launch and plan digests.
- `crates/forge-core/src/bin/forge-sandbox-conformance.rs`: Rust-owned 17-case
  corpus/fixture exporter and adversarial helper executable.
- `scripts/sandbox-conformance.mjs`: exact-plan SRT adapter, behavioral matrix,
  artifact/process/ACL/provider-state checks, and durable JSON output.
- `scripts/lab/**` and `docs/testing/forge-evaluation-lab.md`: fail-closed
  VirtualBox linked-clone lab scaffold; no VM or host feature was installed.
- `package.json` and `package-lock.json`: the temporary SRT package was removed
  surgically; all unrelated workspace/native-package edits were preserved.
- ADR-0033, ADR-0034, the CLI7 task, validated build plan, architecture
  changelog, Checkpoint 81, and this checkpoint: measured evidence and sequencing.

No commit, push, merge, dependency promotion, or production-provider wiring was
performed.

## Commands and exact results

| Command | Exact result |
|---|---|
| `node node_modules/@anthropic-ai/sandbox-runtime/dist/cli.js windows-install` (approved elevation) | Passed. Provisioned hidden `srt-sandbox` SID ending `-1004`, `sandbox-runtime-users` SID ending `-1003`, DPAPI credential state, and SID-scoped WFP setup. Wall-clock setup duration was not captured and is an explicit measurement gap. |
| `node scripts/sandbox-conformance.mjs --provider=srt --status-only` | `adapterState=ready`; dependency errors `0`; account/group/credential checks passed; behavioral WFP probe returned blocked with Windows socket error `10013`. Non-elevated WFP enumeration remained `cannot-read`, as documented by the provider. |
| final `forge-sandbox-conformance.exe ...run-20260812-4\corpus.json` | Passed. Corpus schema `1`; plan schema `4`; 17 cases; 17 unique plan digests; 2,501 fixture files; 632,868,524 fixture bytes. |
| final `node scripts/sandbox-conformance.mjs ... --output=...\srt-report.json` | Passed 17/17; missing IDs `0`; `providerStateClean=true`; `allExecutedCasesPassed=true`; every case had `aclClean`, `recoveryClean`, `processClean`, `descendantClean`, and `residueClean` true. |
| focused native AppContainer baseline | 9 passed, 0 failed, 82 filtered, 3.15 s. |
| focused Windows Job Object lifecycle baseline | 3 passed, 0 failed, 5 helper tests ignored, 83 filtered, 9.17 s; includes nested normal-exit, repeated timeout/cancellation, and forced owner-death cleanup. |
| `cargo test -p forge-core --test isolation_authority` | 11 passed, 0 failed, including same-input provider-plan restriction equivalence. |
| `cargo fmt --all -- --check` | Passed. |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed. The gnullvm linker separately prints its known unused `-no-pie` message during link steps; Clippy emitted no denied diagnostic. |
| `cargo test --workspace --locked` | 174 passed, 0 failed, 14 helper tests ignored. |
| `npm ci` after dependency removal | Passed; 107 packages added; 114 audited; 0 vulnerabilities. |
| `npm run typecheck` / `npm run build` | Both passed. |
| `npm test` | 96 passed, 0 failed, 0 skipped. |
| exact-kernel `npm run test:hybrid` | 63 passed, 0 failed, 0 skipped. |
| `npm audit --json` | 0 info/low/moderate/high/critical vulnerabilities; 139 dependency entries in npm's aggregate metadata. |
| lab PowerShell parse/config/bundle checks | 6/6 `.ps1` files parsed; data config imported; bundle `-WhatIf` passed and created nothing; host preflight correctly returned `Ready=false`. |

## Measurements and corrective evidence

The durable final report is
`target/sandbox-conformance/run-20260812-4/srt-report.json` (untracked build
evidence). Final means were 1,196.59 ms setup, 1,116.80 ms reset, and 325.05 ms
launch. P95 values were 1,415.45 ms setup, 1,290.86 ms reset, and 1,006.85 ms
launch. Captured child output was 185 bytes; tokens are `null` because no inference
provider participated.

The harness retried no command internally. At spike level there were three
corrective matrix turns after the initial run: 12/17 (extended-path cwd, missing
read deny, explicit env, and Git projection defects), 14/17 (outside-write scope
and rustup-shim defects), then 17/17. A fourth fresh-fixture 17/17 run added durable
process inventory and post-provider-state evidence. These failures were retained
as design evidence rather than relabeled as passes.

The compatibility fixture is intentionally expensive: 632.9 MB because it
projects Node, Git runtime files, the selected Rust toolchain binaries, and the
probe. SRT itself occupied 749 files / 11,977,766 bytes in the measured install.
Its four direct runtime dependencies are `@pondwader/socks5-server`, `commander`,
`node-forge`, and `zod`; the package is Apache-2.0. The published project calls the
overall package a research preview and Windows support alpha.

## Acceptance interpretation and remaining debt

The exact four-control SRT plan passed the bounded provider gate: no adapter policy
broadening, no silent degradation, positive/negative filesystem behavior,
network and credential isolation, descendants, timeout, cancellation,
broker-owner-death, compatibility, performance, and residue are evidenced. Native
Forge baselines independently passed the overlapping controls and the stronger
Forge owner-death Job test.

The full production gate remains deliberately closed:

1. SRT cannot represent the plan's `resources` control through its published API.
2. The AppContainer preview has not consumed the same 17-record corpus and still
   lacks general read-only toolchain projection; category baselines are not a claim
   of byte-identical cross-provider execution.
3. WFP filter enumeration was not captured elevated; only behavioral pre/post
   denial was measured.
4. The one-time install duration was not captured. Machine setup currently remains
   on this workstation: account, group, DPAPI state, WFP filters, and sandbox-user
   profile. It can be removed later only with an explicitly approved
   `windows-uninstall`.
5. The VirtualBox lab is scaffolded but cannot run until VT-x is enabled, a
   hypervisor/host-only adapter is approved, and a licensed Windows image/template
   exists. No such host mutation occurred.
6. Hosted Windows/macOS/Linux and packaging/upgrade/uninstall gates remain open.

## Dependency disposition and recommendation

Remove the dependency from Forge's application manifest and lockfile: done. Keep
the already provisioned machine state only as local evaluation infrastructure for
now. The virtual lab installs the exact package offline and `--no-save`, so future
evaluation does not convert it into an application dependency.

Recommendation: **adapt**, not wholesale build and not direct adopt. Preserve the
Rust contract and Forge Job/resource authority; reuse or independently implement
the dedicated identity, restricted broker/runner, recoverable ACL, and WFP pattern
as replaceable machinery. The measured SRT compatibility is materially better than
the current AppContainer projection, but its alpha setup/API/maintenance surface
and missing resource mapping make direct production adoption premature.

The next smallest production slice is a Rust-owned managed-Windows provider
adapter that consumes the complete schema-v4 plan, composes the provider machinery
inside Forge's resource-limited Job, reports setup/cleanup through `doctor`, and
runs the same corpus against managed Windows and AppContainer inside the disposable
lab. Only that later slice may decide whether to ship a separately packaged pinned
provider payload. It must remain `setup_required` until full-resource,
same-corpus, packaged, uninstall, and hosted evidence passes.

References: [ADR-0033](../ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
[ADR-0034](../ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md),
[evaluation lab](../../testing/forge-evaluation-lab.md),
[SRT README](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/README.md),
[SRT license](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/LICENSE).
