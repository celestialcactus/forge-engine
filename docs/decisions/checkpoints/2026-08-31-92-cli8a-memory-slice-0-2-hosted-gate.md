# Checkpoint 92: CLI8A memory Slices 0–2 hosted gate

**Date:** 2026-08-31

**Decision:** accept `CLI8A-MEMORY-FOUNDATION` Slices 0–2 for merge

**Implementation candidate:** `e9e8cd9421dcc10a5210c662b40824ef17e1af80`

**Pull request:** [#32](https://github.com/celestialcactus/forge-engine/pull/32)

**Accepted baseline:** `origin/develop` at
`f36a76726621c22a453152ee9e334605022ecc06` (PR #31)

## Accepted capability boundary

Forge now provides an explicit, repository-scoped memory lifecycle without
activating automatic capture or retrieval. A developer can use `forge memory
remember`, `find`, `show`, `explain`, `correct`, `history`, `restore`, and `status`
without editing storage or supplying a full internal identifier. Human selectors
fail closed when ambiguous.

Rust is the authority for memory validation, deterministic claim and observation
identity, exact scope, append/rebuild, integrity, correction, bounded recovery,
restoration, and erasure rewrite. TypeScript owns command orchestration and human/
JSON presentation; it does not become a second memory authority. Durable success
is reported only after the Rust operation succeeds, and restart rebuilds the same
active/recovery truth.

`memory_text_v1` conservatively normalizes line endings and outer ASCII whitespace.
Explicit developer admission is required. Correction can either retain the prior
version in bounded recovery or erase it from Forge memory state. Recovery is bounded
by 30 days, five lineage versions, and 16 MiB per exact scope; active memory is not
silently evicted. `explain` and `status` report that retrieval is inactive.

## Local evidence

The implementation and product gate ran on Windows x64 with Node.js `22.19.0`, npm
`10.9.3`, Rust `1.97.1`, Visual Studio Build Tools 2022 `17.14.37614.0`, MSVC
`14.44.35207`, and Windows SDK `10.0.26100.0`.

- The four focused Rust memory binaries passed 16/16 tests (contract 8, lifecycle
  3, retention 2, store 3).
- `npm run check` passed 154/154 Node tests plus typecheck and build.
- A real source CLI lifecycle passed across 15 separate processes: remember,
  restart/find/show/explain, bounded correction, history, restore, and
  `correct --erase-previous`. One active version remained; erased tracer content
  was absent from Forge memory-state files; stderr remained empty.
- `tests/hybrid/memory-product.hybrid.ts` passed 1/1. No provider, planner,
  retrieval, discovery, or network work occurred.
- The complete supported-MSVC `npm run check:product` gate passed: 191 Rust tests
  passed with 16 explicit ignores, 154 Node tests passed, 59/66 hybrid scenarios
  passed with seven explicit environment skips, and source `doctor`/`inspect`
  smoke passed with the `source-debug` kernel.
- `npm run rust:audit` passed over 46 locked dependencies. The isolated release
  lifecycle, native-package pack, and 20-sample benchmark passed; Rust bridge mean/
  p95/max were 73.445/90.757/92.163 ms.
- After the timeout-fixture amendment, the focused service file passed ten
  consecutive runs and all 154 Node tests, typecheck, and build passed. After the
  retention-root amendment, the focused two-test Rust binary passed 100 consecutive
  runs (200 individual cases) under MSVC.

## Hosted evidence

Both required workflows passed on exact candidate `e9e8cd9`:

- [Cross-platform run 33433043538](https://github.com/celestialcactus/forge-engine/actions/runs/33433043538):
  Windows x64, macOS ARM64, macOS x64, and Ubuntu x64 Node/typecheck/build gates.
- [Hybrid run 33433043562](https://github.com/celestialcactus/forge-engine/actions/runs/33433043562):
  RustSec plus Windows x64, macOS ARM64, macOS x64, and Ubuntu x64 Rust,
  native-package, hybrid, configured-product, clean-install package, and benchmark
  gates.

The gate produced three useful test corrections before acceptance. Initial run
`33429950359` found that the new hybrid fixture selected the Windows `.exe` kernel
name on Unix; candidate `c38c355` now selects the platform-native name. Replacement
run `33430447022` then exposed a 10 ms filesystem-snapshot race in an existing
service timeout test on macOS x64; candidate `fe0f842` supplied a deterministic
snapshot fixture and tests planner cancellation with a bounded 500 ms deadline.

Hybrid run `33431484624` attempt 1 on `fe0f842` passed all macOS x64 product
behavior through the clean-install package proof, then GitHub artifact storage
returned DNS `ENOTFOUND` during upload. The targeted attempt-2 rerun then exposed
that the two new Rust retention tests could derive the same temporary root from PID
plus a coarse concurrent wall-clock value and correctly contend on the scope lock.
Final candidate `e9e8cd9` adds a process-local atomic nonce to test-root identity.
No product lock or retry semantics were weakened.

## Explicit non-claims

This checkpoint does not claim:

- autosave, standing grants, `off|ask|auto`, or non-blocking undo (Slice 3);
- forget, tombstone restore, privacy purge, or recovery-history clear (Slice 4);
- context preview, automatic planner/provider injection, retrieval, quality
  improvement, or token reduction (Slice 5 and CLI8B);
- reviewed-skill learning or activation (CLI8C);
- team/organization memory, cross-device synchronization, shared knowledge bases,
  vector search, or a public MCP memory-mutation surface;
- erasure of canonical runs/artifacts, filesystem backups, media snapshots, or
  storage outside Forge's memory-state boundary;
- public package publication, signing, provenance, contributor-rights clearance,
  or native restricted-containment promotion.

## Next lane

Slices 3–5 remain unapproved. The next smallest proposed lane is Slice 3: explicit
repo-scoped autosave `off|ask|auto` with a Rust-validated standing grant and visible
undo. Its Product, Architecture, Program Design, and Vertical Slice authorization
must be confirmed before implementation. CLI8B retrieval remains gated until the
complete CLI8A control lifecycle and its separate evaluation plan are accepted.
