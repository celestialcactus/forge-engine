# Checkpoint 94: CLI8A memory Slice 4 hosted privacy gate

**Date:** 2026-09-02

**Decision:** accept `CLI8A-MEMORY-FOUNDATION` Slice 4 for merge

**Implementation candidate:** `20b9bac54e785b6817838cb9972c586d0de04ae4`

**Pull request:** [#34](https://github.com/celestialcactus/forge-engine/pull/34)

**Accepted baseline:** `origin/develop` at
`4f9288016f2b82f0678a2ad616e97f8a02e438ab` (PR #33)

## Accepted capability boundary

Forge now provides an explicit privacy lifecycle for current-repository memory.
`forget` moves the selected active memory into bounded recovery; `restore` returns a
forgotten or superseded version to active memory. `purge` removes the selected
lineage from active and recovery state, while `memory history clear` removes all
recovery content without removing active memories.

Rust remains authoritative for exact actor/scope validation, lineage validity,
durable locking, ledger and projection rebuild, recovery, and atomic rewrite before
acknowledgement. Recovery records distinguish superseded versions from forgotten
lineage terminals, and older compacted records remain readable. Every rebuilt
lineage must contain a valid same-lineage replacement chain; an active lineage has
no forgotten terminal and an inactive recovery lineage has exactly one.

TypeScript owns orchestration and approachable human/JSON UX. Destructive purge and
history-clear operations require an exact terminal confirmation; non-interactive
and JSON use require `--yes`. Their receipts contain operation metadata but no
memory content, memory identifiers, content digest, statement, or subject. All
destructive output states that Forge memory is the only affected boundary: runs,
artifacts, conversations, backups, and media may be retained independently.

The implementation adds no planner/provider retrieval, context injection, network
activity, or skill activation. Existing `explain` and `status` behavior continues
to report retrieval inactive.

## Local evidence

The exact implementation candidate ran on Windows x64 with Node.js `22.19.0`, npm
`10.9.3`, Rust `1.97.1`, Cargo `1.97.1`, and Windows `10.0.26200` x64.

- `npm ci` installed 107 packages with no vulnerability finding.
- `npm run repo:authority` passed on the clean authoritative branch at exact
  `20b9bac` against `origin/develop` `4f92880`.
- `npm run check:product` passed: 200 Rust tests passed with 16 explicit
  helper/external-corpus ignores; 165 Node tests passed; 61/68 hybrid scenarios
  passed with seven explicit separate-kernel environment skips; source
  `doctor`/`inspect` smoke passed.
- Focused memory lifecycle/store tests passed, including correction, forget,
  compaction, restart, restoration of an older version, purge, recovery clear,
  actor/scope rejection, receipt minimization, and pre-publication rewrite failure.
- `npm run rust:audit` scanned 46 locked dependencies against 1,239 advisories with
  no finding.
- `npm run release:smoke` passed the packaged lifecycle. Its exact lifecycle was
  `pack`, `clean-install`, configuration path/init/validate/show/partial-route
  refusal, doctor, onboard, memory ask/auto/off, memory forget/restore/purge/history
  clear, inspect, update, and uninstall. The packaged kernel completed run
  `run:4c9beca0-5068-4ee5-9809-6fcee73a6b0b`.
- `npm run package:native:pack` produced the Windows x64 package at 1,943,706
  archive bytes and 5,491,241 unpacked bytes, with shasum
  `ff858e7f7ae16808e92302eb8e8944f2bf4de915`. The packaged binary was 5,478,912
  bytes.
- The exact-head 20-sample benchmark passed its assertion. TypeScript control
  mean/p50/p95/max were 0.220/0.146/0.349/1.412 ms; the Rust process bridge was
  70.121/68.521/90.182/93.897 ms.
- The release kernel SHA-256 was
  `BF755A3B300B560F6645D71FB9139FA71D279EDB952E3A0729A40999AF237FBA`; the debug
  kernel SHA-256 was
  `BDAC1071D118F74C2CC581C55D1A84FABD5B94436A6F535AEB9884ACD24E640D`.

## Hosted evidence

Both required workflows passed on exact implementation candidate `20b9bac`:

- [Cross-platform run 33644567336](https://github.com/celestialcactus/forge-engine/actions/runs/33644567336):
  Node/typecheck/build passed on Windows x64, macOS ARM64, macOS x64, and Ubuntu
  x64.
- [Hybrid run 33644567346](https://github.com/celestialcactus/forge-engine/actions/runs/33644567346):
  RustSec plus Rust, native-package, hybrid, configured-product, clean-install
  package, and benchmark gates passed on Windows x64, macOS ARM64, macOS x64, and
  Ubuntu x64.

## Correction found by the gate

The first optional replacement-pointer design handled a single forgotten memory
but failed the multi-version case after correction, forget, compaction, and restart:
older recovery versions could retain valid pointers while the lineage no longer had
an active terminal. The final candidate replaces that record-local assumption with
lineage-level validation and restoration. A deterministic regression corrects a
memory more than once, forgets it, forces compaction, reopens the store, restores an
older version, and verifies the rebuilt state across another restart.

## Explicit non-claims

This checkpoint does not claim:

- Slice 5 context preview or complete CLI8A acceptance;
- automatic planner/provider memory injection, retrieval, quality improvement,
  token reduction, or evaluation acceptance (CLI8B);
- reviewed-skill learning or activation (CLI8C);
- developer-profile, team, or organization standing grants;
- team/organization memory, cross-device synchronization, shared knowledge bases,
  vector search, or a public MCP memory-mutation surface;
- erasure of canonical runs/artifacts, conversations, filesystem backups, media,
  storage-device remnants, journal copies, or state outside Forge's memory store;
- organization inference governance, provider/model allowlists, RBAC, residency, or
  a cloud policy subsystem;
- public package publication, signing, provenance, contributor-rights clearance,
  or native restricted-containment promotion.

## Next lane

First merge PR #34 without widening this boundary. Slice 5 remains unapproved: its
bounded context-preview contract requires a separate explicit authorization before
implementation. Runtime retrieval stays inactive until complete CLI8A acceptance
and a separately approved CLI8B evaluation gate.
