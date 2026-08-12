# ForgeEngine core correctness and quality audit

**Audit date:** 2026-08-10

**Branch:** `codex/transaction-sandbox-hardening`

**Scope:** current Rust kernel, TypeScript product adapter, transaction retention,
isolation claims, tests, package contents, and release documentation

**Limit:** this is a focused engineering audit, not a third-party security review or
formal proof.

## Verdict

The narrow evidence and ChangeSet core is internally coherent at the local gate.
Rust remains the transaction and policy authority, TypeScript remains transport and
presentation, and the audit found no second production runtime. The transaction
retention increment closes a real startup race and gives operators a bounded,
non-destructive inventory of durable work.

The repository is not yet a distributable or sandboxed alpha. The Windows x64 local
clean-install gap is closed by an exact-version platform-native package, but hosted
Windows/macOS/Linux packaging, signing/provenance, a root license, native
Windows/macOS containment, and exact-head hosted/controlled VS Code acceptance remain
open. Those are release blockers, not wording issues.

## Findings

### Closed locally on Windows x64: npm clean-install contract

The initial `npm pack --dry-run --json` produced 134 entries, 135,835 packed bytes,
and **zero native kernel/watchdog entries**. That defect is now addressed by the
platform-native package contract in ADR-0032. The universal package names exact
optional native dependencies; target staging adds npm `os`/`cpu` guards and release
executables; the adapter rejects target/version mismatches.

An empty-directory Windows x64 smoke packed and installed the two tarballs with
install scripts disabled, reported `kernel.source=packaged` through `doctor`, and
completed a real Rust-backed inspection. Hosted target smokes, signing/notarization,
release provenance, and publication remain open; this is not yet a public package.

### P0: open-source license is unresolved

Cargo and npm metadata currently say MIT, but there is no root `LICENSE`. The
architecture plan identifies Apache-2.0 as the technical candidate because of its
explicit patent terms, while requiring owner and company legal/open-source review.
No license was invented during this increment.

Required remediation: owner selects the intended license, obtains the appropriate
review, then makes the root license, package/Cargo metadata, contribution guidance,
and notices consistent before public distribution.

### P1: Forge-enforced OS containment does not exist

The baseline provider supports `trusted` only. The exact kernel probe reports zero
restricted controls and `restrictedReady=false`. Windows Job Objects and Unix/macOS
process groups/watchdogs provide lifecycle ownership, not filesystem, network, or
credential containment.

Required remediation: implement Windows AppContainer and a signed macOS App Sandbox
helper as separate native providers behind the existing Rust contract. Each provider
must fail before child launch unless every requested control is established and must
pass adversarial native-OS tests. Until then, `restricted` must remain unavailable.

### P1: exact-head cross-platform and VS Code acceptance is pending

Local Windows and official MCP-client gates passed. Hosted Windows/macOS/Ubuntu and
a fresh controlled VS Code run have not executed against this exact branch. macOS
sandbox correctness cannot be inferred from Windows compilation or mocks.

Required remediation: publish the exact head, run hosted Node/Rust/hybrid matrices,
then run the established one-call/seven-tool VS Code regression after rebuilding and
restarting the workspace MCP server.

### P2: durable transaction storage needs a long-lived compaction policy

The coordinator now fails closed when its state root exceeds 4,096 entries. This
bounds startup and audit work, but terminal transaction journals are retained, so a
long-running installation can eventually reach the ceiling.

Required remediation: before an enterprise pilot, add an explicit archive/export
projection with corruption checks and a tested migration path. Do not silently
delete prepared or repair-required transactions.

### Closed in the follow-up: repeatable RustSec advisory coverage

`npm audit --omit=dev` reported zero production vulnerabilities across 95 production
dependencies. `cargo-audit` 0.22.2 is now installed locally, and the locked 46-package
Rust graph returned zero vulnerabilities and zero warnings against the 1,200-entry
RustSec database snapshot. The repository exposes `npm run rust:audit`, and hosted CI
installs that exact cargo-audit version before running `cargo audit --deny warnings`.

`cargo tree --duplicates` reports only the expected `syn` v2/v3 split through
`curve25519-dalek` and `serde`; no forced dependency rewrite is justified by that
fact alone. Any future advisory exception must be explicit, ID-scoped, explained,
and time-bounded rather than hidden in a broad warning allowance.

## Correctness defects found and fixed in this pass

1. Coordinator startup cleaned transaction staging before acquiring the repository
   publication lock. Cleanup now uses the same lock, so concurrent startup fails
   closed without deleting in-flight publication.
2. `SovereignChangeService` recreated the coordinator per operation, losing the
   startup cleanup count and repeating lifecycle scans. One service now owns one
   coordinator.
3. Cleanup accepted a broad filename prefix/suffix. It now validates the exact
   digest/PID/timestamp grammar, requires a directory, and bounds state-root scans.
4. Human `forge change audit` output initially fell through to the generic change
   renderer. It now presents transaction count, cleanup count, retained candidate,
   state, recommendation, and review-due status.
5. Required isolation probe fields were initially added without a protocol advance.
   The readiness probe first advanced to `forge.kernel.probe.v2`; ADR-0033 now uses
   `forge.kernel.probe.v3`; the managed-provider local gate advances it to
   `forge.kernel.probe.v4` so the Rust-selected provider is distinct from bounded,
   fail-closed candidate diagnostics. The TypeScript adapter rejects malformed,
   duplicated, unknown, or internally inconsistent capability claims.
6. `doctor` initially accepted an engine root nested in the governed workspace even
   though Rust correctly rejected transaction commands. Doctor now fails that
   lexical preflight and states that Rust revalidates canonical paths.

## Validation evidence

- Rust format: passed.
- Rust Clippy: full workspace/all targets, warnings denied, passed.
- Rust tests: `forge-core` 77 passed / 5 helper fixtures ignored; every integration
  suite passed; `forge-kernel` 9/9 passed.
- Rust workspace build: passed.
- Node/TypeScript: typecheck, 94/94 tests, and production build passed.
- Exact-kernel hybrid: 63/63 passed with zero skips, including official MCP client,
  transaction audit/cleanup, recovery, process ownership, and CLI doctor behavior.
- Packaged source-tree smoke: valid external engine root passed; nested engine root
  failed with exit 1; empty transaction audit rendered correctly.
- npm production dependency audit: zero reported vulnerabilities.
- RustSec: cargo-audit 0.22.2 reported zero vulnerabilities and zero warnings for
  the locked 46-package graph; the same deny-warnings gate is now in hosted CI.
- Clean package: an empty Windows x64 npm project installed packed main/native
  artifacts without scripts, Cargo, or source discovery; packaged `doctor` and one
  real Rust-backed inspection passed.
- Active `src` and `crates` debt-marker scan: no TODO/FIXME/HACK/XXX matches.
- `git diff --check`: passed.

## Release decision

Accept transaction-retention increment 7A and the Windows x64 packaging contract at
their **local gates only**. Do not claim native sandbox or cross-platform installable
alpha completion. The next defensible gates are exact-head hosted/VS Code acceptance,
hosted signed native packages plus the owner license decision, and separately proven
Windows/macOS restricted providers.

## 2026-08-11 addendum: Windows preview and second correctness pass

The AppContainer work changes the wording but not the release decision. Forge now has
a real, conformance-only Windows boundary experiment with nine passing local tests;
the production provider remains `setup_required`, `doctor` remains
`restrictedReady=false`, and ordinary Node/npm/Cargo toolchains are not yet projected
into that boundary. “No production-selectable OS sandbox” remains the accurate claim.

The second repository pass found and fixed four additional correctness issues:

1. `validate_effective_sandbox_plan` verified a plan's self-hash but did not re-derive
   every path and limit from the requested process. A caller able to re-hash a changed
   plan could therefore present an escaped writable root, raised resource ceiling, or
   substituted executable as internally consistent. Validation now canonicalizes and
   compares executable/working-directory identity, exact writable/protected paths,
   ordered unique controls, exact timeout/output, and fixed resource ceilings.
2. The AppContainer launcher created the Job Object after the suspended process.
   Job-creation failure could leave a suspended process without kill-on-close
   ownership. Job creation/configuration now precedes `CreateProcessW`; assignment
   failure explicitly terminates, waits for, and drains the failed launch.
3. Recovery records did not reject duplicate grant/protected paths or protected paths
   outside the four compiled metadata names. Schema-v2 validation now enforces exact,
   unique candidate-scoped entries. Failure to derive an abandoned profile SID no
   longer removes the journal as if cleanup succeeded.
4. Local source discovery always preferred `target/release`, allowing a stale probe-v2
   binary to mask a freshly built probe-v3 debug kernel. Explicit and packaged paths
   retain priority; source discovery now selects the newest debug/release build and
   has a regression.

After these fixes, the exact head again passes strict Rust format/clippy, the full
workspace Rust test/build gate, 96/96 Node tests/build, and 56/56 executed hybrid tests
with seven explicit environment-dependent skips. RustSec still reports no advisory
for the 46 locked dependencies. The final rebuilt Windows x64 staged package selected
the packaged kernel and completed a real inspection (`run:c6bc06a0-db1a-4fab-9f2d-86ce6e9e0e5b`).
