# Checkpoint 84: packaged provider lifecycle gate preparation

- **Date:** 2026-08-12
- **Decision:** accept the bounded non-mutating preparation; keep provider lifecycle
  acceptance, restricted readiness, dependency promotion, and production selection open
- **Recommendation:** adapt

## Outcome

The separately packaged disposable-lab lifecycle path is ready for audit, but the
provider acceptance gate is **not** passed. This slice performed no hypervisor/VM
installation or launch, firmware change, UAC action, account/group/profile mutation,
WFP/firewall/network mutation, provider promotion, commit, push, or merge.

Rust remains authoritative for `EffectiveSandboxPlan` compilation, five-control
validation, provider selection, resource Jobs, process lifecycle, timeout,
cancellation, owner death, cleanup, events, artifacts, and fail-closed readiness.
PowerShell orchestrates immutable inputs and evidence phases only. TypeScript is not
a second policy/runtime authority.

The managed Windows, AppContainer, and provider-conformance paths remain explicitly
named **evaluation modules**. They independently evaluate architecture, composition
patterns, and obvious structures that fit Forge. The payload uses separately
attributed published packages/APIs; no external implementation source was copied
verbatim into Forge-owned modules.

## Prepared gate

1. `scripts/stage-managed-provider-evaluation.mjs` creates an immutable payload from
   exact cached published archives. It verifies the expected package/version/license
   tuple for the provider and four direct dependencies, preserves the five license
   texts and a third-party notice, records archive/adapter/file SHA-256 values, and
   marks the payload `evaluation_only`.
2. Bundle schema 2 binds the payload manifest independently from Forge's root
   `package.json`/`package-lock.json`. Missing, changed, duplicate, reparse-point,
   escaped, oversized, or unmanifested payload files fail before bundle creation.
3. The schema-2 guest runner has write-once phases for payload verification, elevated
   install, post-install hard-reboot persistence, one guest-generated Rust corpus
   against managed Windows and AppContainer, elevated uninstall, post-uninstall
   hard-reboot residue, and guest finalization. A repeated phase cannot replace its
   evidence.
4. Corpus gating requires 17 unique cases, all five controls, exact plan equivalence,
   filesystem/read/network/credential negatives, child/grandchild/timeout/
   cancellation/owner-death containment, clean ACL/process/descendant residue, and
   shell/Node/npm/Git/Cargo/rustc compatibility. Measurements are labeled whole-case
   latency because they include prepare, launch/execution, and cleanup.
5. The VirtualBox driver records a sequence/hash-chained host lifecycle. The read-only
   finalizer requires clone create/start, post-install and post-uninstall hard resets,
   exact guest artifact hashes, exactly one unsandboxed canary reachability request,
   both corpus reports, a real upgrade, uninstall/residue evidence, export, shutdown,
   and clone destruction.

The provider's published Windows instructions say no logout is required after
install. Forge's hard reboots are therefore stronger persistence/crash-recovery
checks, not an invented package prerequisite. Direct-network denial comes from the
Rust corpus case; the host canary is only an independent unsandboxed reachability
control.

## Files changed for this preparation

- `scripts/stage-managed-provider-evaluation.mjs`
- `scripts/lab/New-ForgeLabBundle.ps1`
- `scripts/lab/Invoke-ForgeVirtualBoxLab.ps1`
- `scripts/lab/Test-ForgeLabArtifacts.ps1`
- `scripts/lab/guest/Invoke-ForgeProviderLifecycleGuest.ps1`
- `scripts/sandbox-provider-srt.mjs` (evaluation-module provenance comment)
- `crates/forge-core/src/bin/forge-sandbox-conformance.rs` (evaluation-module
  provenance comment)
- `crates/forge-core/src/isolation/windows_managed.rs` and
  `crates/forge-core/src/isolation/windows_appcontainer.rs` (evaluation-module
  provenance comments)
- ADR-0033, ADR-0034, Slice CLI7, the validated build plan, architecture changelog,
  evaluation-lab runbook, and Checkpoint 83 cross-context wording

All other existing uncommitted work was preserved.

## Exact local validation and measurements

All commands ran from `C:\tmp\forge-engine-cli-run-recovery`. Generated payloads,
bundles, guest copies, and artifacts live under ignored `target/` paths.

| Command/check | Exact result |
|---|---|
| PowerShell parser over the four schema-2 bundle/host/finalizer/guest scripts | Passed for all four. |
| `node --check scripts/stage-managed-provider-evaluation.mjs` | Passed. |
| payload staging from the inspected `@anthropic-ai/sandbox-runtime@0.0.71` tree and cached archives | Exit 0; 5 packages; 16 payload files; 4,921,051 bytes. Final smoke took 7,705.8747 ms and reproduced all five original archive SHA-256 values. |
| pristine payload manifest used by the bundle smoke | SHA-256 `079df28116248debb22833d13c4b7354f55da09acb27915d94cf7bdd061c1ecb`; status `evaluation_only`. |
| payload-local `npm ci --offline --ignore-scripts --no-audit --no-fund` | Exit 0; 1,535.2173 ms; 834 installed files; 13,850,582 bytes; exact provider version `0.0.71`; Forge root package/lock hashes unchanged. |
| bundle rejection using the installed smoke payload containing unmanifested `node_modules` | Exit 1 with the expected unmanifested-file error; no bundle output created. |
| pristine schema-2 bundle creation | Exit 0; 2,688.5671 ms; 146 Forge files; 16 payload files; exact payload-manifest binding; new guest runner present; root dependency absent. |
| first local non-elevated guest `VerifyPayload` simulation | Exit 0; wall 6,554.9662 ms; Forge offline install 2,608.9511 ms; payload offline install 1,654.1947 ms; root dependency absent. |
| final guest verify after exact transitive identity/license checks | Passed; Forge offline install 2,637.6548 ms; payload install 1,594.9089 ms; all 5 exact identities/licenses validated. |
| repeated `VerifyPayload` against the same run | Exit 1 with the expected already-attempted error; existing evidence SHA-256 unchanged. |
| schema-2 finalizer against payload-only incomplete evidence | Exit 1; valid JSON result; `Passed=false`; 12 explicit problems including absent upgrade, canary, and host lifecycle evidence. |
| `npm run typecheck` | Exit 0. |
| `npm test` | Exit 0; 96 passed, 0 failed, 0 skipped. |
| `npm run build` | Exit 0. |
| `cargo fmt --all -- --check` | Exit 0. |
| `cargo +1.97.1-x86_64-pc-windows-gnullvm test -p forge-core --locked --offline --test isolation_authority` | Exit 0; 11 passed, 0 failed. The gnullvm linker emitted the known unused `-no-pie` warning for three targets; this shell still has no MSVC `link.exe`. |
| root dependency check after all validation | `package.json` dependency/devDependency absent; `package-lock.json` package entry absent. |
| `git diff --check` | Exit 0; Git emitted the existing warning that `src/cli.ts` CRLF would become LF if Git next touches that unrelated dirty file. |

The five validated package identities were:

- `@anthropic-ai/sandbox-runtime@0.0.71` — Apache-2.0;
- `@pondwader/socks5-server@1.0.10` — MIT;
- `commander@12.1.0` — MIT;
- `node-forge@1.4.0` — BSD-3-Clause or GPL-2.0 dual expression;
- `zod@3.25.76` — MIT.

No inference participated in these checks, so token usage is unavailable/null and
there were no model retries or corrective turns. These are packaging/orchestration
measurements, not new sandbox enforcement results. The accepted local 17/17 + 17/17
same-plan results remain those in Checkpoint 83.

## Failures, uncertainties, and open acceptance conditions

Preparation exposed and retained these corrective facts rather than rewriting them
as first-attempt passes:

- packing the local installed package directory invoked its published `prepare`/
  Husky lifecycle despite the initial suppression attempt, so that approach was
  rejected;
- an offline package-name spec required uncached registry metadata and failed with
  `ENOTCACHED`; exact registry tarball URLs with `npm pack --offline` succeeded from
  the existing cache and now have explicit identity/hash checks;
- the managed tool sandbox initially denied generated writes under this `C:\tmp`
  checkout (`EPERM` for payload staging and access denied for Cargo's build lock).
  The exact local checks were rerun with narrowly scoped generated-artifact write
  permission; no host/provider mutation was authorized;
- the first duplicate-phase capture wrapper treated the expected child stderr as a
  terminating PowerShell error. A read-only rerun captured exit 1 and proved the
  original evidence hash was unchanged.

Open acceptance conditions are:

1. There is only one approved exact provider pin. Reinstalling `0.0.71` would not be
   a real upgrade, so the guest/host finalizers intentionally require the absent
   `provider-upgrade-result.json` and fail.
2. Firmware virtualization is disabled, VirtualBox is absent, no licensed/template
   Windows VM exists, and no host-only network/canary has been configured. None was
   changed here.
3. Therefore install readiness across reboot, same-corpus parity inside a clean VM,
   package upgrade/rollback, uninstall across reboot, account/group/profile/WFP
   residue, artifact export, and clone destruction are designed but unmeasured.
4. Whole-case latency is reported honestly; the current Rust parity reports do not
   isolate process-launch-only latency from provider prepare/cleanup.
5. Environment scrubbing is covered, but broader Windows credential channels remain
   a production gap.
6. Published Windows support remains alpha/research-preview maturity. Elevated local
   account, DPAPI, WFP, ACL, Node, and lifecycle assumptions remain maintenance and
   operational debt.

## Dependency disposition and recommendation

`@anthropic-ai/sandbox-runtime` should remain **absent** from Forge's application
`package.json` and `package-lock.json`. Keep only the ignored/generated exact payload
as disposable evaluation infrastructure. Do not commit or promote the package in
this slice.

Recommendation remains **adapt**: preserve Forge's provider-neutral Rust contract and
independently reproduce the dedicated-identity/WFP/broker/recoverable-ACL composition
patterns that fit Forge, optionally using replaceable published execution machinery
only after the lifecycle gate passes. Do not adopt external TypeScript policy
authority, do not copy implementation source verbatim, and do not build a universal
sandbox from scratch before the measured provider path is exhausted.

## Next smallest production slice

Select and legally/operationally audit a second exact provider pin, extend the
immutable payload and guest runner with a true two-payload upgrade/rollback phase,
and validate that phase locally without host mutation. Then, in the separately
approved virtualized-lab task, run the complete fresh-clone sequence and feed the
exported artifacts to the schema-2 finalizer. Production readiness may change only
if that finalizer passes with no fallback or policy broadening.

References: [ADR-0033](../ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
[ADR-0034](../ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md),
[Checkpoint 83](2026-08-12-83-managed-windows-provider-adapter-local-gate.md), and
[evaluation lab](../../testing/forge-evaluation-lab.md).
