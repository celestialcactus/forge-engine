# Checkpoint 93: CLI8A memory Slice 3 hosted and VS Code gate

**Date:** 2026-09-01

**Decision:** accept `CLI8A-MEMORY-FOUNDATION` Slice 3 for merge

**Implementation candidate:** `26f011e7f983d6c3d24dfd1fd7b786aedd09f938`

**Pull request:** [#33](https://github.com/celestialcactus/forge-engine/pull/33)

**Accepted baseline:** `origin/develop` at
`d3d3a7aea61fede259977c03cbda9e4ada4e4cfe` (PR #32)

## Accepted capability boundary

Forge now provides current-repository memory capture modes `off`, `ask`, and
`auto`; `ask` remains the default. Only an explicit local user action can create
or revoke an `auto` standing grant. Rust binds that grant to the exact developer
actor and repository scope, validates it at admission, appends before reporting
success, and remains authoritative for the canonical memory ledger.

TypeScript owns UX and orchestration. Its no-pause path admits only a narrow,
deterministic direct-preference grammar. Ambiguous preference-like text falls back
to `ask`; ordinary task text is ignored. Secret-like, structured, remote,
authority-changing, repository, model, and tool material cannot self-authorize or
use the automatic candidate path.

An automatic save is visible and attributable. The developer can immediately
undo the save from the same interactive session. Undo is a narrow Rust-authorized
atomic rewrite: the admitted content is removed from Forge memory state, a
content-free receipt remains, and no recovery copy is created. Existing
`find`/`show`/`explain` behavior observes the admitted preference across process
restart. `explain` and `status` continue to report that retrieval is inactive.

The interactive TypeScript adapter now separates TTY editing from deterministic
non-TTY queued ingestion. A real TTY owns raw Backspace, forward Delete, cursor,
history, prompt redraw, and raw-mode cleanup; piped fixtures retain early
multi-line queuing. This changes no Rust run, policy, transaction, or memory
authority.

## Local evidence

The final candidate ran on Windows x64 with Node.js `22.19.0`, npm `10.9.3`, Rust
`1.97.1`, Visual Studio Build Tools 2022 `17.14.37614.0`, MSVC `14.44.35207`, and
Windows SDK `10.0.26100.0`.

- `npm run repo:authority` passed on the clean authoritative branch.
- `npm run check:product` passed: 195 Rust tests passed with 16 explicit
  helper/external-fixture ignores; 162 Node tests passed; 60/67 hybrid scenarios
  passed with seven explicit separate-kernel environment skips; source
  `doctor`/`inspect` smoke passed with the source-release kernel.
- The focused interactive suite passed 7/7. It proves Backspace, forward Delete,
  left/right editing, raw-mode restoration, stdin cleanup, and preservation of
  queued non-TTY multi-line input.
- A genuine Windows PTY changed `/helpx` to `/help`, visibly redrew the line,
  echoed `/help` and `/exit`, and exited zero.
- `npm run rust:audit` scanned 46 locked dependencies against 1,235 advisories
  with no finding.
- `npm run release:smoke` passed the packaged lifecycle: pack, clean install,
  config path/init/validate/show/partial-route refusal, doctor, onboard,
  memory `ask`/`auto`/`off`, inspect, update, and uninstall. The packaged kernel
  was selected and run `run:d743ffd9-1709-40c4-b413-46e7f416d40e` completed.
- `npm run package:native:pack` produced the Windows x64 package at 1,917,210
  archive bytes and 5,401,129 unpacked bytes, with shasum
  `0b072de562f0c38624e4e6a66b24e6e83982a00f`.
- The exact-head 30-sample benchmark passed its assertion. TypeScript control
  mean/p50/p95/max were 0.170/0.092/0.302/1.449 ms; the Rust process bridge was
  71.363/69.279/91.493/92.417 ms.

## Exact VS Code evidence

The candidate was exported without changing the pinned validation checkout to
`C:\Users\gabri\AppData\Local\Temp\forge-validation-26f011e-20260831-190608`.
An isolated `npm ci` installed 107 packages and `npm run build:product` passed
under MSVC. The exact debug kernel SHA-256 was
`12D0A20C23545C99C1CDC842D94D53750B3B61DF3108E391593EA04B7BDBD58D`.

The VS Code pilot task then targeted that exact dist, kernel, and a fresh state
root. In the actual Windows integrated terminal the developer confirmed that
Backspace removed the prior character, `/help` executed correctly, input remained
visible, and `/exit` exited correctly. The temporary diagnostic launchers were
removed. This evidence exercised Slice 3 only.

## Hosted evidence

Both required workflows passed on exact candidate `26f011e`:

- [Cross-platform run 33449198939](https://github.com/celestialcactus/forge-engine/actions/runs/33449198939):
  Node/typecheck/build passed on Windows x64, macOS ARM64, macOS x64, and Ubuntu
  x64.
- [Hybrid run 33449198943](https://github.com/celestialcactus/forge-engine/actions/runs/33449198943):
  RustSec plus Rust, native-package, hybrid, configured-product, clean-install
  package, and benchmark gates passed on Windows x64, macOS ARM64, macOS x64, and
  Ubuntu x64.

## Corrections found by the gate

The acceptance sequence found four product defects rather than treating an early
green unit suite as acceptance:

1. The first live pilot accepted typed input but did not display it. `33ee986`
   bound readline to the terminal output.
2. The corrected pilot exposed doubled terminal punctuation. `5c84a97` corrected
   the undo copy.
3. The first corrected hosted attempt parsed memory protocol output on child
   `exit` before stdout closed on Ubuntu. `3849cd0` waits for stream `close` and
   adds a delayed-writer regression.
4. Candidate `49baf8d` still ignored Backspace in the real VS Code TTY even though
   input/output were TTYs, raw mode was active, and the key arrived as code 127.
   `26f011e` owns bounded terminal editing while retaining the historical queued
   pipe behavior.

## Explicit non-claims

This checkpoint does not claim:

- Slice 4 forget/tombstone restore/privacy purge/recovery-history clear;
- Slice 5 context preview or complete CLI8A acceptance;
- automatic planner/provider memory injection, retrieval, quality improvement,
  or token reduction (CLI8B);
- reviewed-skill learning or activation (CLI8C);
- developer-profile, team, or organization standing grants;
- team/organization memory, cross-device synchronization, shared knowledge bases,
  vector search, or a public MCP memory-mutation surface;
- erasure of canonical runs/artifacts, filesystem backups, media snapshots, or
  storage outside Forge's memory-state boundary;
- public package publication, signing, provenance, contributor-rights clearance,
  or native restricted-containment promotion.

## Next lane

Slice 4 is not authorized by this checkpoint. The next smallest gate is a separate
Product/Architecture/Program Design/Vertical Slice review for the privacy
lifecycle: forget, restore, purge, and recovery-history clear. Slice 5 context
preview retains its own later authorization. Retrieval remains inactive until
CLI8A completes and CLI8B passes a separately approved evaluation gate.
