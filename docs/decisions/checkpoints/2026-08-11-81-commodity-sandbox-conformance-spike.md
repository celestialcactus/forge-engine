# Checkpoint 81: bounded commodity sandbox conformance spike

> **2026-08-12 follow-up:** this initial setup-blocked record is preserved as
> historical evidence. Approved local setup and the completed 17-case matrix are
> recorded in [Checkpoint 82](2026-08-12-82-commodity-sandbox-conformance-completion.md).

**Date:** 2026-08-11
**Branch:** `codex/transaction-sandbox-hardening`
**Decision:** adapt the commodity provider pattern later; do not adopt or promote
`@anthropic-ai/sandbox-runtime@0.0.71` from this spike

## Scope and authority

This was a bounded checkpoint, not a production promotion. Rust remains the sole
authority for policy compilation, `EffectiveSandboxPlan`, provider selection,
transaction/lifecycle decisions, events, artifacts, and fail-closed readiness.
The new JavaScript harness is a temporary execution probe: it accepts exact
Rust-emitted plan case records, validates that each case's executable and working
directory match the plan, and cannot select or broaden policy.

Changed files:

- `scripts/sandbox-conformance.mjs` — temporary provider-neutral adversarial and
  compatibility harness plus SRT status/adapter probe;
- ADR-0033, ADR-0034, the CLI7 task, the validated build plan, and the architecture
  changelog — evidence and sequencing updates;
- this checkpoint.

The pre-existing uncommitted Rust, package, lockfile, native-package, architecture,
and checkpoint changes were preserved. The pinned package addition remains
uncommitted and unwired.

## Harness coverage

The required exact-plan case IDs are:

`allowed_candidate_write`, `workspace_outside_write_denied`,
`protected_path_write_denied`, `sensitive_read_denied`, `direct_network_denied`,
`credential_environment_scrubbed`, `child_grandchild_contained`,
`timeout_cancel_owner_death`, `residue_orphan_check`, `shell_compatibility`,
`node_npm_compatibility`, `git_compatibility`, and `cargo_rust_compatibility`.

Each case record carries its own Rust plan/digest and launch fields. The harness
reports setup latency, launch latency, exit/termination correctness, output bytes,
residue before/after, retries/corrective turns, and tokens (`null` when no inference
provider is involved). A setup failure reports all cases as unexecuted; it does not
turn setup failure into a pass or silently fall back to trusted execution.

## Commands and exact results

| Command | Result |
|---|---|
| `node scripts/sandbox-conformance.mjs --provider=srt --status-only` | Passed as a probe; `adapterState=setup_required`, 13 required cases, 0 executed, setup/launch `null`, bytes `0`, tokens `null`, retries `0`, corrective turns `0`. |
| Published SRT Windows status/dependency/WFP calls with the vendored helper | Setup-blocked: `srt-win user status failed: spawn EPERM`; direct user/WFP/status calls also returned `EPERM`; `verifyWindowsWfpEgress` returned `spawn_failed`. |
| `npm run typecheck` | Passed. |
| `npm test` | Passed, 96/96 tests. The restricted first attempt failed 20/20 at test-runner child spawn with `EPERM`; the escalated rerun passed without changing repository state. |
| `npm audit --json` | Passed: 0 info/low/moderate/high/critical vulnerabilities; 144 installed dependency entries. |
| `git diff --check` | Passed, with one pre-existing CRLF normalization warning for `src/cli.ts`. |
| `cargo test -p forge-core isolation::windows_appcontainer::tests -- --nocapture` | Not runnable locally: the default MSVC linker `link.exe` is absent. An escalated gnullvm attempt also stopped during dependency build because host build scripts still required `link.exe`. No Rust test result is claimed here. |

The existing Checkpoint 80 record remains the source for the prior 9/9 AppContainer
focused result; this turn did not relabel that historical result as a new local
Rust pass.

## Dependency and legal/maintenance audit

The installed package is exactly `0.0.71`, resolved from the npm registry, and is
Apache-2.0 licensed. Its published README labels it a beta research preview and
describes native macOS/ Linux mechanisms plus a Windows alpha path. The package
exports `SandboxManager`, status/dependency/WFP helpers, and Windows install APIs.
The probe used only the non-install status helpers and the documented manager
wrapping surface; no implementation source was copied.

The lockfile contains 145 package records. The SRT subtree has four direct runtime
dependencies (`@pondwader/socks5-server`, `commander`, `node-forge`, and nested
`zod`), with no known vulnerabilities in the repository audit. Maintenance risks
are the beta API, bundled native helper, Windows account/WFP/ACL machine setup,
platform-specific behavior, and the need for Forge-owned NOTICE/provenance and
upgrade policy if the dependency is ever shipped.

## Measurements, failures, and uncertainty

No provider launch latency, compatibility outcome, descendant, cancellation,
owner-death, or residue result was recorded for SRT because the helper could not be
spawned and setup was not present. This is a setup failure, not evidence of either
containment or insecurity. No token or corrective-turn measurement is meaningful
for this non-inference probe. The existing Forge baseline and AppContainer behavior
remain the comparison baselines, but native Rust execution could not be rebuilt on
this workstation because the MSVC linker is missing.

Important open gaps remain: a disposable approved Windows host with explicit UAC
approval; exact-plan execution across the full matrix; toolchain/dependency
projection; sensitive credential channels beyond environment; child/grandchild and
forced owner-death cleanup; resource ceilings; root-path durability; residue and
ACL/profile recovery; packaged `doctor`; and hosted Windows/macOS/Linux acceptance.

## Recommendation and next smallest production slice

Recommendation: **adapt**, not build a new universal sandbox and not adopt SRT as a
Forge authority. Keep the Rust contract and use the dedicated low-privilege
identity, broker/runner, restricted-token/Job, recoverable ACL, WFP, and proxy
pattern as replaceable machinery behind it. The SRT dependency should remain only
temporarily in this unmerged spike checkout for reproducibility; remove it before
merge/package publication unless a later implementation slice explicitly accepts
its setup and maintenance surface.

The next smallest production slice is a read-only Windows feasibility gate on a
disposable approved host: install the provider only after explicit UAC approval,
generate the exact Rust plan case set, run the 13-case matrix against trusted,
AppContainer preview, and commodity baselines, and publish setup/launch,
compatibility, cleanup, and failure evidence. Restricted readiness must remain
`setup_required` until that gate and packaged/hosted checks pass.

References: [SRT README](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/README.md),
[SRT license](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/LICENSE),
[ADR-0033](../ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
[ADR-0034](../ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md).
