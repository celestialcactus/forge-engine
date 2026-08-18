# Checkpoint 43: trusted-alpha replay and acceptance spike

- **Status:** replayed on the authority checkpoint; local acceptance passed and
  hosted acceptance awaits the reconciled replay branch
- **Date:** 2026-08-17
- **Related ADRs:** ADR-0017, ADR-0028, ADR-0031, ADR-0032, ADR-0035, ADR-0036,
  ADR-0037
- **Scope:** bounded replay of candidate `a023119` onto the reconciled CLI7-ALPHA
  lane

## Objective

Preserve the useful release intent from stale candidate `a023119` without merging
its `aa73e0e` ancestry or reintroducing superseded TypeScript-runtime, package,
configuration, documentation, sandbox, or CLI8 assumptions.

## Replay basis and architecture

- Canonical base: authority checkpoint `d654a92`, descended from
  `origin/develop@5fff597`.
- Replay branch: `codex/trusted-alpha-authority-replay`, created directly from
  that checkpoint.
- Preserved source candidate: `a023119` remains on `codex/trusted-alpha`.
- Runtime authority: the accepted Rust kernel, run store, policy, transaction, and
  evidence contracts from `develop`.
- Distribution authority: ADR-0032's exact-version universal main package plus one
  target-native package. No JavaScript fallback or postinstall downloader.

## Bounded replay changes

- Add one-command `forge onboard`/`npm run onboard` reporting runtime readiness,
  trusted/no-containment posture, accepted release contracts, and remaining
  implementation/evidence gates.
- Extend the accepted native package smoke through exact-pair update and uninstall;
  retain pack, clean install, doctor, and real Rust-backed inspection evidence.
- Add Ubuntu to portable Node conformance while retaining the existing three-OS
  hybrid/native package workflow as the hosted product gate.
- Add a bounded tester kit, issue template, and Apache-compatible provenance
  notice.
- Update README/changelog release truth without replacing the documentation PR's
  hierarchy or claiming a public release.

## Decisions accepted and gates retained

- Apache-2.0 is selected and package metadata is aligned; authority to license all
  existing contributions still requires attestation.
- ADR-0032 fixes package topology and ADR-0036 fixes the trusted-alpha target
  matrix; signing, provenance, and hosted evidence remain gates.
- ADR-0036 accepts configuration selection precedence and monotonic policy
  tightening. Onboarding reports that contract while full loader/conformance work
  remains pending.

## Acceptance evidence

| Gate | Status |
|---|---|
| Replay contains no stale candidate ancestry | Passed |
| Local TypeScript/Rust/hybrid/product gate | Passed with Rust 1.97.1 gnullvm fallback: formatting/Clippy, 175 Rust tests with 16 explicit ignores, 97 Node tests, 63 hybrid tests with 7 explicit environment skips, build, MCP, kernel discovery, and product smoke |
| Local exact-version package lifecycle | Passed for `forge-engine@0.1.0` + `forge-engine-kernel-win32-x64@0.1.0`: pack, clean install, packaged-kernel doctor, Rust-backed inspect, update, and uninstall |
| Hosted Windows/macOS/Ubuntu workflows | Pending branch push and dispatch |

The default MSVC attempt stopped before project compilation because this
workstation does not provide `link.exe`. The established
`1.97.1-x86_64-pc-windows-gnullvm` local fallback passed; hosted Windows remains
the MSVC-native acceptance authority.

## Non-claims and remaining blockers

- Trusted execution is not OS containment; no restricted provider is promoted.
- CLI8 learning modules are untouched and inactive.
- Private acceptance archives are not a public npm/open-source release.
- Contributor rights attestation, configuration precedence implementation,
  signing/provenance, and exact hosted evidence remain open gates.

## Repository state

The replay branch exists from `d654a92`, its bounded patch is reconciled, and its
local gates pass. The earlier statement that branch creation was blocked and no
commit could be made is superseded. This checkpoint travels with the reconciled
replay commit; it does not borrow acceptance from `a023119` or `c89e888`.

## Next checkpoint

Record the exact local and hosted workflow results for the replay commit. Public
promotion remains blocked until the rights, configuration-implementation,
provenance, and hosted-evidence gates above are closed.
