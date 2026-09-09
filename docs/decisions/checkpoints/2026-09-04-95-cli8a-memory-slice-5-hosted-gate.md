# Checkpoint 95: CLI8A memory Slice 5 hosted eligibility-preview gate

**Date:** 2026-09-04

**Updated:** 2026-09-09 for the pre-merge dependency remediation

**Decision:** accept `CLI8A-MEMORY-FOUNDATION` Slice 5 for merge

**Implementation candidate:** `0c08a0600696f95122126e0e329664b7515e49a1`

**Dependency-remediation candidate:** `0014ddba44fde46dcd0e13ef48b912d322cb2dff`

**Pull request:** [#35](https://github.com/celestialcactus/forge-engine/pull/35)

**Accepted baseline:** `origin/develop` at
`9bba75e4eb09f8022ad6fd7813592b1d3533a300` (PR #34)

## Accepted capability boundary

Forge now provides `forge memory preview [--max-bytes <1..262144>] [--json]` as a
bounded, deterministic explanation of baseline memory-context eligibility. Rust
opens only the trusted current-repository scope plus the derived local-developer
scope and owns final admission, omission reasons, canonical ordering, and UTF-8
byte accounting. TypeScript invokes, validates, and presents one Rust result.

The default budget is 65,536 bytes and the hard maximum is 262,144 bytes. Preview
uses active projections only, admits no future-dated observation, and omits explicit
contradictions, inferred hypotheses, ineligible provenance, expired explicit
validity, and unresolved evidence/run freshness with stable reasons. First-fit may
skip an oversized record and admit a later smaller record.

Forgotten and recovery content never enters the candidate set. Preview reports
only aggregate forgotten and superseded-recovery counts; it exposes no ledger head
or other fingerprint derived from hidden recovery history. It does not compact the
store or change saved memory records.

This capability does not perform task relevance ranking, retrieval, provider or
network work, or planner/provider prompt injection. JSON continues to report
`retrievalActive=false`, `plannerInjection=false`, and
`providerWorkPerformed=false`.

## Local evidence

The exact implementation candidate ran on Windows x64 with Node.js `22.19.0`, npm
`10.9.3`, Rust `1.97.1`, Cargo `1.97.1`, and Windows `10.0.26200` x64.

- `npm run repo:authority` passed at exact head `0c08a06` against
  `origin/develop` `9bba75e`; `git diff --check` passed.
- `npm run check:product` passed: 205 Rust tests passed with 16 explicit
  helper/external-corpus ignores; 173 Node tests passed; 62/69 hybrid scenarios
  passed with seven explicit separate-kernel environment skips; source
  `doctor`/`inspect` smoke passed.
- The focused memory-context suite passed 10/10, including hidden-recovery output
  and identity invariance, rejection of a reintroduced ledger fingerprint, exact
  scope, deterministic identity, policy omissions, canonical byte accounting, and
  first-fit admission after an oversized record.
- `npm run rust:audit` scanned 46 locked dependencies against 1,239 advisories with
  no finding.
- `npm run release:smoke` passed the packaged lifecycle, including
  `memory-context-preview`. The packaged kernel completed run
  `run:29d78678-f533-4168-81cc-a2f143e865d0`.
- `npm run package:native:pack` produced the Windows x64 package at 1,987,437
  archive bytes and 5,624,361 unpacked bytes, with shasum
  `0bc7b4b92229a889488ec52e1e8e29cb4ed467ad`. The packaged binary was 5,612,032
  bytes.
- The exact-head 20-sample benchmark passed its assertion. TypeScript control
  mean/p50/p95/max were 0.206/0.113/0.310/1.416 ms; the Rust process bridge was
  77.711/67.990/82.114/239.439 ms.
- The release kernel SHA-256 was
  `BAD09564829DF06C43AA6AB20BFB8630A95AD74648851DB32E8DB5062A16C758`; the debug
  kernel SHA-256 was
  `FD7F85C8538B0B46CF6C30BABAC5C7D381A1E59765F4E3FEC44AC88691E3FF7E`.

The 2026-09-04 npm advisory feed initially reported inherited `fast-uri` and `qs`
findings through `@modelcontextprotocol/sdk@1.30.0`; a newly published `hono`
finding was also visible before merge on 2026-09-09. Dependency-remediation
candidate `0014ddb` updates only `package-lock.json`: `fast-uri` 3.1.5 to 3.1.7,
`qs` 6.15.3 to 6.16.0, and `hono` 4.13.0 to 4.13.7. The direct MCP SDK version and
application code are unchanged. A clean `npm ci` followed by `npm audit --json`
reported zero vulnerabilities in the current advisory feed. The complete product,
release-smoke, native-package, RustSec, and asserted benchmark gates passed again
with the patched installed graph.

## Hosted evidence

Both required workflows passed on exact implementation candidate `0c08a06`:

- [Cross-platform run 33925597815](https://github.com/celestialcactus/forge-engine/actions/runs/33925597815):
  Node/typecheck/build passed on Windows x64, macOS ARM64, macOS x64, and Ubuntu
  x64.
- [Hybrid run 33925597769](https://github.com/celestialcactus/forge-engine/actions/runs/33925597769):
  RustSec plus Rust, native-package, hybrid, configured-product, clean-install
  package, and asserted benchmark gates passed on Windows x64, macOS ARM64, macOS
  x64, and Ubuntu x64.

Both workflows passed again on exact dependency-remediation candidate `0014ddb`:

- [Cross-platform run 34376523507](https://github.com/celestialcactus/forge-engine/actions/runs/34376523507)
  passed Node/typecheck/build on all four declared targets.
- [Hybrid run 34376523494](https://github.com/celestialcactus/forge-engine/actions/runs/34376523494)
  passed RustSec plus the complete Rust, native-package, hybrid, clean-install,
  product, and asserted benchmark matrix on all four declared targets.

## Correction found by independent review

Initial candidate `882e00c` exposed each complete ledger head in
`scopeHeads[].ledgerHeadSha256` and included it in the preview identity. Although
the recovery text remained absent, that digest could change solely because hidden
recovery history changed, exceeding the frozen aggregate-count-only boundary.

Final candidate `0c08a06` removes the ledger head from Rust output, TypeScript
contracts, validation, and identity. TypeScript rejects a reintroduced extra scope
field. A Rust regression proves that different hidden recovery content and ledger
heads with the same disclosed aggregate counts produce identical preview output
and identity. The same correction adds the previously missing direct first-fit
regression.

## Explicit non-claims

This checkpoint does not claim:

- task-relevance ranking, automatic planner/provider memory injection, retrieval,
  quality improvement, token reduction, or CLI8B evaluation acceptance;
- reviewed-skill learning or activation (CLI8C);
- general prompt-injection resistance;
- developer-profile, team, or organization standing grants;
- team/organization memory, cross-device synchronization, shared knowledge bases,
  vector search, or a public MCP memory-mutation surface;
- erasure of canonical runs/artifacts, conversations, filesystem backups, media,
  storage-device remnants, journal copies, or state outside Forge's memory store;
- public package publication, signing, provenance, contributor-rights clearance,
  immunity from future dependency advisories, or native restricted-containment
  promotion.

## Next lane

First merge PR #35 without widening this boundary. CLI8B retrieval remains disabled
until a separate four-gate authorization and paired no-memory/retrieved-memory
quality and isolation evaluation. CLI8C reviewed skills and terminal
observable-activity work remain separate gated lanes.
