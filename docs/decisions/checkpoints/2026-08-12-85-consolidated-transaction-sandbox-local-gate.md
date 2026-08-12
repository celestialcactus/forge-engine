# Checkpoint 85: consolidated transaction and sandbox hardening local gate

- **Date:** 2026-08-12
- **Branch:** `codex/transaction-sandbox-hardening`
- **Decision:** accept the consolidated local publication gate; keep provider
  lifecycle acceptance, restricted readiness, and production provider selection open

## Outcome

The recovery, transaction-retention, Windows sandbox evaluation, native-package,
and disposable-lab preparation work is internally consistent enough to publish for
hosted review. This does **not** accept either Windows candidate as a production
restricted provider. Rust remains the policy, lifecycle, resource, and evidence
authority; both Windows candidates remain `setup_required` and
`restrictedReady=false`.

The branch contains seven committed recovery/continuation increments after remote
`develop`, followed by the reviewed transaction/sandbox/native-package changes in
the working tree. The scope is one core-hardening line rather than a parallel
runtime: TypeScript discovers and presents the Rust kernel, while evaluation
providers consume the exact Rust-compiled `EffectiveSandboxPlan` and cannot broaden
it or silently fall back.

## Independent integration validation

All commands ran from `C:\tmp\forge-engine-cli-run-recovery` after the sandbox
spike paused.

| Gate | Result |
|---|---|
| `npm ci` | Exit 0; 107 packages installed; 114 packages audited; 0 vulnerabilities. |
| `npm run check:product` with Rust `1.97.1-x86_64-pc-windows-gnullvm` | Exit 0 after the managed execution tool was allowed to write generated `target/` artifacts. Rust formatting, Clippy with warnings denied, 175 workspace tests with 16 explicit ignored helpers/conformance cases, Rust build, TypeScript typecheck/build, 96 Node tests, 63 exact-kernel hybrid tests, MCP/product smoke, and automatic kernel discovery passed. |
| `npm run package:smoke` | Exit 0; optimized kernel built and the clean-install smoke selected `forge-engine-kernel-win32-x64@0.1.0` as `packaged`; run `run:0c8a6a82-7a67-49b7-a9c4-bfd31105d9b3`. |
| `npm audit --omit=dev --audit-level=moderate` | Exit 0; 0 vulnerabilities. |
| `cargo audit --deny warnings` using `cargo-audit 0.22.2` | Exit 0; 1,216 advisories loaded and 46 locked crate dependencies scanned with no finding. |
| optimized process-bridge benchmark, 20 samples, `--assert` | Passed; Rust mean 63.718 ms, p50 60.893 ms, p95 72.028 ms, max 127.835 ms. |
| fresh five-control provider-neutral corpus | Exported 17 cases for `forge.windows.managed.preview` with filesystem, process, network, credentials, and resources controls. |
| AppContainer corpus | 17/17 passed in 30.02 s; report SHA-256 `c8068b3b35c9720c61083692647879a8dc75ebe2150afac0d8f6863861bd9a0a`. |
| managed Windows corpus | 17/17 passed in 165.10 s; report SHA-256 `63b52b4dd80c7a1f3240a54fb0ccd048ee550ae6c2e1cebbf91fd0774cf17c86`. |
| script/static gate | 8 Node scripts parsed, 7 PowerShell lab scripts parsed, no TODO/FIXME/HACK markers in the new sandbox/package surface, and `git diff --check` passed. |

The fresh corpus SHA-256 is
`3b6ff0b630ea397495b6b16e7905411709cef66ffa55d8861829039a13273ff9`.
Generated reports remain ignored under
`target/sandbox-conformance/integration-five-control-4a65481f1c164c85ad1c44fc1e85e612/`.

## Corrective facts

- The first `check:product` attempt was blocked before compilation because the
  managed tool sandbox denied Cargo's generated build lock under `target/`. The
  identical command passed with narrowly scoped generated-artifact permission.
- The first independent corpus command used the generator's legacy four-control
  default and therefore failed the managed test's explicit source-provider identity
  assertion. The checked-in lifecycle runner already uses the correct explicit
  `export --provider-id=forge.windows.managed.preview --include-resources` contract;
  a fresh corpus using that command passed 17/17 against both providers.
- The GNU-LLVM linker emitted the known unused `-no-pie` warning. MSVC `link.exe`
  remains absent from this shell, so hosted Windows must still prove the standard
  MSVC lane.

## Open gates

This local acceptance does not supply the missing clean-VM install/reboot/upgrade/
rollback/uninstall/residue evidence, a second approved provider pin, hosted
Windows/macOS/Ubuntu results, macOS containment, broader Windows credential-channel
coverage, signing/notarization, or controlled VS Code acceptance for this exact
head. The schema-2 finalizer must continue to fail until those artifacts exist.

The next gate is a protected pull request into `develop`, with the hosted
Windows/macOS/Ubuntu matrix, RustSec job, native-package smokes, and benchmark
assertion required before merge. Provider promotion remains a separate later
decision even if that PR is green.

References: [Checkpoint 83](2026-08-12-83-managed-windows-provider-adapter-local-gate.md),
[Checkpoint 84](2026-08-12-84-packaged-provider-lifecycle-gate-preparation.md),
[ADR-0033](../ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
and [ADR-0034](../ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md).
