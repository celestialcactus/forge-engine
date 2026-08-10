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

The repository is not yet a distributable or sandboxed alpha. The npm package omits
the Rust kernel, the repository has no root license file, native Windows/macOS
containment is absent, and this exact head has not passed hosted or controlled VS
Code acceptance. Those are release blockers, not wording issues.

## Findings

### P0: npm package is not a usable product package

`npm pack --dry-run --json` produced 134 entries, 135,835 packed bytes, and **zero
native kernel/watchdog entries**. The declared `forge` executable therefore cannot
discover its required Rust authority after a clean npm-only install.

Required remediation: define one cross-platform binary distribution contract,
package or download only integrity-pinned Windows x64/arm64 and macOS x64/arm64
artifacts, make installation failure explicit, and run clean-install/update/doctor
smokes on each supported platform. Do not solve this by silently shipping only the
current Windows debug binary.

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

### P2: Rust dependency advisory coverage is not installed locally

`npm audit --omit=dev` reported zero production vulnerabilities across 95 production
dependencies. `cargo audit` is not installed, so no RustSec result is claimed.
`cargo tree --duplicates` reports only the expected `syn` v2/v3 split through
`curve25519-dalek` and `serde`; no forced dependency rewrite is justified by that
fact alone.

Required remediation: add a pinned RustSec advisory job to hosted CI and define the
exception/update policy before release.

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
   The probe is now `forge.kernel.probe.v2`, and the TypeScript adapter rejects
   malformed, duplicated, unknown, or internally inconsistent capability claims.
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
- Active `src` and `crates` debt-marker scan: no TODO/FIXME/HACK/XXX matches.
- `git diff --check`: passed.

## Release decision

Accept transaction-retention increment 7A at the **local gate only**. Do not claim
native sandbox completion or installable alpha completion. The next defensible gates
are exact-head hosted/VS Code acceptance, native binary packaging plus the owner
license decision, and the separately proven Windows/macOS restricted providers.
