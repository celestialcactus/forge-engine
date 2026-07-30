# Checkpoint 38: sovereign CLI hosted and VS Code gate

- **Date:** 2026-07-30
- **Branch:** `feature/slice-2e3b-sovereign-cli`
- **Accepted implementation:** `16c5569`
- **Decision:** accept Slice 2E-3b and close the dependable local ChangeSet v2 loop

## Accepted behavior

Forge now exposes one high-level `forge change` workflow over the Rust-owned
ChangeSet v2 service and durable coordinator:

1. `propose` stages bounded content, derives repository identities, creates an
   external candidate, runs operator-policy verification, and durably registers
   only verified work;
2. `inspect` returns durable operation, verification, candidate, and transition
   evidence;
3. `accept --approve` promotes through the coordinator and removes the candidate
   before acknowledging the terminal state; and
4. `discard --approve` records an explicit durable discard without mutating the
   active workspace.

TypeScript transports and renders this protocol. It does not decide mutation,
verification policy, recovery, or terminal state.

## Failure found during the gate

The first hosted CLI exercise failed closed because repository observation encoded
the current file bytes as hexadecimal instead of hashing them. The candidate was
not created and the active workspace was not mutated. Commit `16c5569` corrected
the implementation to compute SHA-256 and added a direct regression for the
expected 64-character identity.

This was a real core defect. The useful result is not that CI caught it; it is that
the transaction contract rejected the malformed identity before mutation.

## Validation evidence

- Local `npm run check`: 37/37 tests, TypeScript typecheck, and production build
  passed.
- Rust formatting passed locally. Local Rust linking remains unavailable on this
  workstation because the MSVC linker is not installed, so hosted execution is
  authoritative.
- Cross-platform conformance run
  [30556929564](https://github.com/celestialcactus/forge-engine/actions/runs/30556929564)
  passed on Windows and macOS.
- Hybrid kernel run
  [30556929739](https://github.com/celestialcactus/forge-engine/actions/runs/30556929739)
  passed on Windows, macOS, and Ubuntu. Each platform compiled, formatted, linted,
  and tested Rust; preserved the accepted TypeScript suite; exercised the hybrid
  and sovereign CLI flows; built the optimized kernel; and passed the bridge
  latency ceiling.
- Hybrid sovereign-change fixtures cover propose/inspect/accept, idempotent
  terminal operations, explicit discard, failed verification cleanup, and missing
  verifier cleanup.
- Coordinator and adapter fixtures prove terminal candidates are absent,
  discarded state is truthful, proposal commands cannot select verification
  executables, and the TypeScript wire frame matches the Rust protocol.

## Controlled VS Code regression

The existing `C:\dev\forge-engine` sandbox remained read-only and clean.

- Exactly seven Forge tools were selected; all built-in tools were disabled.
- A fresh Agent chat called `Forge Workspace Summary` exactly once with
  `maxFiles: 20`.
- The call completed in four seconds with no retry or alternate tool.
- Run: `run:3ce11b30-1ce6-40b3-9f73-bed46c995606`.
- Snapshot: `workspace:7b3c009ae89d6632`.
- Files: 147; `truncated = true`.
- Events:
  `run.started -> context.planned -> capability.requested -> approval.decided ->
  capability.completed -> run.completed`.
- `git status --short` remained empty after the test.

## Honest boundary

This closes the dependable trusted-mode local change transaction, not the whole
Forge product:

- verification is still trusted execution, not an OS sandbox;
- no authenticated host handshake or independently verified host containment
  exists yet;
- no public MCP mutation workflow was added;
- the standalone CLI still lacks the real provider/inference loop, polished
  interactive turn lifecycle, packaging, and clean-install release gate; and
- power-loss durability and repair tooling remain release work.

## Next increment

Proceed to Slice 2F in bounded sub-slices. First define authenticated host/policy
negotiation and the restricted-execution provider contract. Then implement and
adversarially prove the minimum Windows/macOS restricted backend before exposing a
high-level MCP mutation workflow. Keep Ubuntu behind the same interface as a
compatibility target. Do not add raw shell or file-write authority.
