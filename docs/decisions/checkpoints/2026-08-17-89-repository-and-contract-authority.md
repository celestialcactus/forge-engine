# Checkpoint 89: Repository and contract authority

- **Status:** passed locally
- **Date:** 2026-08-17
- **Related ADRs:** ADR-0035, ADR-0036, ADR-0037
- **Scope:** repository/worktree guard, Apache-2.0 alignment, release/config/
  protocol decisions, memory explanation, and V1 system map

## Objective

Stop stale saved-project refs from producing merge-invalid worktrees and resolve the
front-loaded decisions that safely unblock the trusted-alpha replay. Explain, but
do not silently settle, the remaining memory/evaluation/extension choices.

## Architecture at this checkpoint

`origin/develop@5fff597` is the accepted baseline. Rust remains the single policy,
run, transaction, recovery, and artifact authority. TypeScript remains the CLI,
host, provider, and workflow integration layer. Storage indexes and OS/provider
implementations remain replaceable machinery.

## Changes since the previous checkpoint

- Added a read-only lineage guard and canonical worktree workflow.
- Added the complete Apache-2.0 license, non-owning NOTICE, and consistent package/
  Cargo metadata.
- Accepted the bounded alpha target matrix and effective-config precedence.
- Accepted protocol negotiation and durable migration rules.
- Added the clarified decision register, memory primer, and Mermaid system/build
  diagrams.

## Decisions proposed or adopted

| Decision | Status | Rationale | ADR |
| --- | --- | --- | --- |
| Reconstruction anchor plus fetched `origin/develop` defines worktree authority | Accepted | Prevents stale prototype ancestry without hard-coding a local path | ADR-0035 |
| Apache-2.0 plus bounded alpha matrix and monotonic config policy | Accepted; rights attestation remains | Supports enterprise forks while keeping release claims finite and authority non-bypassable | ADR-0036 |
| Per-contract negotiation and copy-on-write migration | Accepted | Separates live compatibility from durable-record evolution | ADR-0037 |
| Memory identity/lifecycle proposal | Review required | Durable semantics need fixture evidence before merge | Memory primer |
| Evaluation thresholds and public extension stability | Open | Evidence and adoption needs must precede promises | Decision register |

## Validation performed

| Command or experiment | Result | Evidence |
| --- | --- | --- |
| `npm run repo:authority -- --require-current-develop` | Passed | Canonical root, branch, `HEAD`, common Git directory, and `origin/develop` resolved; both refs contain `5fff597`. |
| Guard run from historical OneDrive prototype | Failed as required | Rejected stale `HEAD=4d3eb71` and `origin/develop=aa73e0e` without modifying the checkout. |
| Official Apache text comparison | Passed | Normalized staged `LICENSE` exactly matched `https://www.apache.org/licenses/LICENSE-2.0.txt`. |
| JSON/metadata validation | Passed | Root manifest, lockfile, and six native manifests parse; Cargo metadata reports Apache-2.0 for both workspace crates. |
| `npm ci` | Passed | 107 packages installed from the lockfile; npm reported zero vulnerabilities. |
| `npm run check` | Passed | TypeScript typecheck, 96/96 Node tests, and production build passed. |
| `cargo audit --deny warnings` | Passed | RustSec scanned 46 locked dependencies with no vulnerability or warning. |
| Bounded native-package staging fixture | Passed | Windows x64 staged manifest reports Apache-2.0 and includes byte-identical `LICENSE` plus `NOTICE`. |
| `npm pack --dry-run --json` | Passed | 136 entries, 142,672 packed bytes; root `LICENSE` and `NOTICE` included. |
| Changed-document link/headings check and `git diff --check` | Passed | All 14 changed Markdown documents resolve repository-local links; no whitespace errors. |

## Failures and surprises

- The first `npm run check` stopped before typecheck because the clean worktree had
  no `node_modules` and therefore no `tsc`. `npm ci` installed the exact lockfile
  graph; the unchanged gate then passed.
- The initial manually staged Apache text differed from the official file only by
  its leading blank line. The staged file was corrected and exact comparison passed.
- Cargo-audit and npm pack first hit managed-sandbox cache permissions. The same
  commands passed with normal cache access; no warning or assertion was suppressed.

## Known limitations

- The Codex saved project still needs one manual re-open of `C:\dev\forge-engine`;
  no project-path update API is exposed.
- Apache-2.0 selection does not prove that no employer or third party owns rights in
  an existing contribution.
- The configuration and protocol decisions are contracts; full runtime fixtures are
  subsequent bounded implementation work.
- CLI8A remains replay-required and runtime-inactive until memory policy review.

## Repository state

- Branch: `codex/architecture-authority-decisions`
- Base: `5fff597269168c250b15e89e7ae77d68f0510abc`
- Production behavior available: read-only repository authority check and license
  inclusion in staged packages; no runtime policy, memory, sandbox, or inference
  behavior changed.

## Next checkpoint

Merge this bounded authority increment, replay CLI7-ALPHA from the new
`origin/develop`, implement the accepted effective-config contract, and run the
declared hosted clean-install matrix. Settle the four memory-policy choices before
replaying CLI8A.
