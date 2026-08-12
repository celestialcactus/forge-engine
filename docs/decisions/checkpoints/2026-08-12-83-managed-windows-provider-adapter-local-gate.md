# Checkpoint 83: managed Windows provider adapter local gate

**Date:** 2026-08-12
**Branch:** `codex/transaction-sandbox-hardening`
**Decision:** the local implementation gate passes; keep both Windows candidates
`setup_required` and adapt the external machinery only as a separately packaged,
replaceable provider after disposable-lab, package, uninstall, and hosted gates

## Outcome

The next Rust-owned production slice now exists without promoting a production
sandbox. Rust consumes and validates the complete schema-v4
`EffectiveSandboxPlan`, launches the provider-prepared executable itself inside
Forge's process-count/memory-limited Job Object, owns timeout/cancellation and
descendant teardown, and emits the execution evidence. The temporary JavaScript
adapter uses only the pinned package's published API to prepare and reset its
Windows boundary. It cannot compile policy, select a provider, broaden a plan, or
silently fall back.

This checkpoint names that work the **managed Windows provider evaluation module**.
It evaluates the documented dedicated-user, ACL, WFP, manager/runner, and cleanup
architecture in Forge's context. The outer Rust Job/resource composition,
schema-v4 validation, lifecycle/evidence flow, module organization, and tests are
original Forge work. No external implementation source was copied verbatim or used
as a template for internal module layout. The separately pinned package is invoked
only through its published API and executable contract. The AppContainer and shared
conformance paths are likewise identified as evaluation modules under ADR-0033.

A fresh provider-neutral corpus containing all five controls passed 17/17 against
both `forge.windows.managed.preview` and
`forge.windows.appcontainer.preview`. Every target plan normalized to the same
enforced restrictions as its source plan. Allowed candidate writes, denied
outside/protected writes, sensitive-read denial, direct-network denial,
credential/environment scrubbing, descendants, timeout, cancellation, true
separate-owner death, residue, and shell/Node/npm/Git/Cargo/rustc compatibility
all passed.

This is a local conformance gate, not production restricted readiness. The kernel
probe protocol is v4 and reports the selected trusted baseline separately from
both Windows candidates. Both candidates remain `setup_required` and
`restrictedReady=false`; `doctor` is intentionally side-effect-free and does not
execute an environment-selected adapter. Production `execute_restricted` remains
fail-closed, and direct managed execution is compiled only into conformance tests.

## Files changed by this slice

- `crates/forge-core/src/isolation/windows_managed.rs`: managed Windows provider
  evaluation module: status,
  exact-plan validation, conformance-only adapter session, Rust-owned Job/resource
  execution, cleanup, and 17-case report.
- `scripts/sandbox-provider-srt.mjs`: temporary published-API evaluation
  adapter/probe with
  exact-plan validation, bounded argv/environment handling, setup status, and
  reset handshake; it is not in the application manifest.
- `crates/forge-core/src/isolation/windows_appcontainer.rs`: AppContainer evaluation
  module with read/execute-only
  policy-owned toolchain projection, schema-v3 recovery records, same-corpus
  execution, owner-death recovery, per-case timing, and ACL/marker residue checks.
- `crates/forge-core/src/isolation.rs`, `windows_job.rs`, and
  `forge-sandbox-conformance.rs`: provider-conformance evaluation module with
  five-control schema-v4 plan/corpus support,
  `.forge-toolchain` protection, and reusable Job resource limits.
- `crates/forge-kernel/src/main.rs`, `protocol.rs`,
  `src/hybrid/kernel-binary.ts`, `src/cli.ts`, and hybrid tests: bounded probe-v4
  candidate diagnostics without changing selected-provider authority.
- ADR-0033, ADR-0034, Slice CLI7, the validated build plan, architecture changelog,
  evaluation-lab guide, and this checkpoint: measured result and remaining gates.

No commit, push, merge, dependency promotion, production-provider selection, UAC
operation, installer, or uninstaller was performed in this slice. Existing dirty
worktree changes were preserved.

## Commands and exact results

| Command | Exact result |
|---|---|
| `npm install --prefix C:\tmp\forge-srt-provider-0.0.71 --package-lock=false --no-save @anthropic-ai/sandbox-runtime@0.0.71` | Added 5 packages in 7 s outside the checkout; no Forge manifest/lock change. |
| fresh corpus export to `target/sandbox-conformance/run-20260812-managed-5/corpus.json` | Passed; schema 2, plan schema 4, 17 cases, five required controls. |
| ignored exact AppContainer corpus test | 1 passed, 0 failed; 17/17 cases; 34.16 s test time. |
| ignored exact managed-provider corpus test | 1 passed, 0 failed; 17/17 cases; 173.80 s test time. |
| `node --check scripts/sandbox-provider-srt.mjs` | Passed. |
| `cargo fmt --all -- --check` | Passed. |
| gnullvm `cargo clippy --workspace --all-targets --locked --target x86_64-pc-windows-gnullvm -- -D warnings` | Passed with no Clippy diagnostic. |
| gnullvm `cargo test --workspace --locked --target x86_64-pc-windows-gnullvm` | 175 passed, 0 failed, 16 ignored conformance/helper tests. The linker printed its known unused `-no-pie` warning. |
| `npm run typecheck` / `npm run build` | Both passed. |
| `npm test` | 96 passed, 0 failed, 0 skipped. |
| exact-kernel `npm run test:hybrid` | Final run 63 passed, 0 failed, 0 skipped. The preceding run was 62/63 because auto-discovery selected a stale generated probe-v3 kernel; refreshing the generated debug artifact from the just-built probe-v4 kernel corrected it. |
| root `npm audit --json` | 0 info/low/moderate/high/critical vulnerabilities; 139 aggregate dependency entries. |

The ordinary MSVC `cargo check` path remains unavailable in this shell because
`link.exe` is absent; all Rust gates above used the installed
`1.97.1-x86_64-pc-windows-gnullvm` toolchain. This is an environment limitation,
not a rewritten pass.

## Measurements

Durable evidence is untracked build output under
`target/sandbox-conformance/run-20260812-managed-5/`.

- corpus SHA-256: `5c538d1eb70d9956cb2dbd2d9ccebfd718fff206829142730186df40e7241e67`;
- AppContainer report SHA-256: `6573ce6d9dea17975ae54e0f34563ca3c0bd7f06ca74f36f3e7bbad1c7f72142`;
- managed report SHA-256: `bfd703ef7ae99f8fc5f1b95731ccf32805bb1ebba480daaf02b09cb776c96450`.

| Provider | Passed | Mean/case | P95 | Minimum | Maximum | Sum |
|---|---:|---:|---:|---:|---:|---:|
| AppContainer preview | 17/17 | 1,972.14 ms | 4,277.12 ms | 643.64 ms | 4,277.12 ms | 33,526.36 ms |
| managed SRT adapter | 17/17 | 8,940.12 ms | 19,711.26 ms | 7,806.99 ms | 19,711.26 ms | 151,982.03 ms |

Both reports record retries `0`, tokens `null`, all plan-equivalence checks true,
and clean ACL, descendant, process, recovery, and residue evidence. No inference
call participated; this corpus tests command/toolchain compatibility and operating-
system enforcement, not model quality or local inference. Each provider captured
128 stdout bytes and 155 stderr bytes across the matrix. The generated compatibility
fixture contained 2,502 files / 633,409,708 bytes after the runs. The managed result
measures cold initialize/reset per case and is about 4.5x AppContainer's measured
per-case mean, so it is not yet an acceptable unoptimized default path.

The temporary package tree at
`C:\tmp\forge-srt-provider-0.0.71\node_modules` contains 834 files and
13,850,607 bytes. The package itself is 153 files / 8,383,570 bytes, exact version
`0.0.71`, Apache-2.0, and requires Node >=20.11.0. Its four direct dependencies are
`@pondwader/socks5-server` 1.0.10 (MIT), `commander` 12.1.0 (MIT),
`node-forge` 1.4.0 (BSD-3-Clause OR GPL-2.0), and `zod` 3.25.76 (MIT). The temporary
`--no-save --package-lock=false` install has no lockfile, so `npm audit` correctly
returned `ENOLOCK`; do not misstate the root application audit as an audit of that
standalone tree. The published package remains a research preview and labels Windows
support alpha; its account, DPAPI, WFP, ACL, Node, and elevated install/uninstall
assumptions are therefore package-lifecycle debt, not implicit Forge setup.

## Corrective turns and security observations

The first Rust-managed full-matrix attempt passed 5/17 while exposing argv
projection and overly broad process-inventory defects; the final adapter path
passed 17/17. The earlier temporary non-Rust adapter recorded its own 12/17 and
14/17 corrective turns before Checkpoint 82.
Earlier shared AppContainer projection turns progressed 8/17, 14/17, 16/17, then
17/17. A timing-report refactor initially failed compilation and was corrected.
One reused AppContainer fixture later failed 8/17 because an earlier owner-death
marker had inherited a stale provider SID; the runner now removes its marker,
compares ACLs before/after, fails on preclean errors, and a fresh fixture passed
17/17. These are development corrective turns; the final harness itself retried no
case.

One direct exploratory diagnostic outside the Rust-cleared launch path serialized
an inherited wrapper environment and exposed a host secret in tool output. The
secret is not copied into this checkpoint or either durable report. The final path
starts the adapter with `env_clear()` plus Forge's bounded baseline, requires the
adapter itself to reject unexpected process environment names, rejects any returned
credential-like names in Rust, caps names/values/counts, and suppresses malformed
frame contents. A final scan found no credential names in either run report. This
incident is also why `doctor` must not execute configured adapter code.

## Dependency disposition, recommendation, and remaining debt

`@anthropic-ai/sandbox-runtime` must remain absent from Forge's application
`package.json` and `package-lock.json`; it is absent. Keep the separately installed
temporary payload only as local evaluation infrastructure until the disposable lab
can reproduce this gate. Do not ship or promote it from this slice. Existing
machine account/WFP setup remains in place; uninstall is a separate system mutation
requiring explicit approval and must be measured in the disposable lab.

Recommendation: **adapt**. Reuse the published, pinned execution machinery behind
the Rust-owned plan/lifecycle/evidence contract if and only if the separately
packaged payload passes the remaining gates. Do not directly adopt its TypeScript
manager as Forge's policy/runtime authority, and do not spend the product lane
building another universal sandbox from scratch.

Here, `adapt` means independently implementing the architecture, patterns, and
obvious structural ideas that fit Forge while preserving attribution and the
evaluation-module label. It does not authorize verbatim source reuse. A proposal to
ship copied or substantially derived implementation code would require a new,
explicit adoption and legal/provenance decision.

Remaining production gaps are explicit:

1. reproduce both exact 17-case reports from a clean disposable Windows VM and
   retain clone-level setup, restart, uninstall, and destruction evidence;
2. define and test a separate package with exact payload hash, licenses/NOTICE,
   install/upgrade/rollback/uninstall behavior, and no root app dependency;
3. pass hosted Windows and packaged-kernel gates; capture elevated WFP enumeration
   plus behavioral denial without weakening the no-silent-fallback rule;
4. expand Windows credential-channel probes beyond environment variables;
5. optimize or amortize cold managed setup/reset only after correctness and
   lifecycle gates remain green;
6. complete Tier-1 macOS provider work independently.

The next smallest production slice is therefore the **disposable-lab packaged
provider lifecycle gate**: create an exact separately packaged payload, exercise
clean install/reboot/same-corpus/upgrade-uninstall from the VM lab, export hashes
and license/NOTICE evidence, and leave production selection closed unless every
artifact validates. The separate lab task is waiting for the user's virtualization
framework and host-mutation choices.

References: [ADR-0033](../ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
[ADR-0034](../ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md),
[Checkpoint 82](2026-08-12-82-commodity-sandbox-conformance-completion.md), and
[evaluation lab](../../testing/forge-evaluation-lab.md).

Follow-up: [Checkpoint 84](2026-08-12-84-packaged-provider-lifecycle-gate-preparation.md)
records completion of the non-mutating schema-2 payload/lifecycle preparation. It
does not retroactively close this checkpoint's VM, real-upgrade, or hosted gates.
