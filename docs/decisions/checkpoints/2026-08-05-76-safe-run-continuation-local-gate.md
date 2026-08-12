# Checkpoint 76: safe run continuation exact-head local gate

**Date:** 2026-08-05
**Branch:** `feature/cli-safe-continuation`
**Base:** `feature/cli-run-recovery` at `1caaf65`
**Decision:** accept CLI ship-lane 6B locally and in controlled VS Code; retain hosted gates

## Outcome

Forge can restart one interrupted run without creating a second runtime or logical
run. Rust remains the authority for the request, canonical event prefix, capability
replay descriptors, durable interaction transcript, continuation classification,
execution lock, and terminal artifact. TypeScript restores provider conversation
state and supplies integrations, but it cannot decide that an unsafe frontier is
retryable.

## Implemented contract

- Bridge v9 persists planner, approval, and capability intent before host dispatch
  and completion before runtime use.
- `continuation.json` and `interactions.jsonl` are bounded and digest checked.
- Completed responses are replayed through the existing `Slice0Runtime`; exact
  durable-prefix events are compared and suppressed, and only new events append.
- Planner checkpoints bind provider, model, tool-call IDs, names, arguments, and
  tool results with 4 MiB / 256-message bounds.
- An unresolved `read_only_retryable` capability requires explicit CLI permission
  and may be retried once total. A crash during that retry blocks later retries.
- Ambiguous planner/approval work, missing checkpoints, descriptor divergence, and
  unresolved `non_idempotent` capabilities fail closed before live host work.
- The OS owns the per-run execution lock; a persistent filename is not ownership.
- Explicit resume validates and atomically publishes a complete temporary terminal
  artifact rather than repeating the run.
- `forge runs inspect` and `forge runs resume` use the same store and runtime path.

## Exact validation

`npm run check:hybrid` passed at the checkpoint head in 162.8 seconds:

- `cargo fmt --all -- --check`: pass;
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: pass;
- full Rust workspace: pass, including forge-core 67 passed / 5 helper tests ignored
  and forge-kernel 8/8 unit tests;
- Node typecheck and 92/92 tests: pass;
- production TypeScript build: pass;
- retained-kernel hybrid suite: 59 total, 53 passed and 6 deliberately skipped
  because their separate explicit `FORGE_KERNEL_BINARY` fixture was not requested.

`npm run smoke` also passed with a disposable `FORGE_ENGINE_ROOT`: `doctor` found
the debug Rust kernel, reported `forge.kernel.bridge.v9` and the honest recovery
posture, and a bounded real-workspace inspection returned a verified seven-event
terminal artifact.

A controlled VS Code test initially failed because its long-lived MCP Node process
still spoke the pre-v9 protocol while the freshly built Rust kernel required v9.
After `MCP: List Servers` -> `forge-engine` -> `Restart Server`, VS Code rediscovered
exactly seven tools. A fresh exact prompt made one Forge Workspace Summary call and
completed in four seconds: run `run:71ee5072-51e2-411c-a523-fe566e7d24aa`, snapshot
`workspace:de59dea7bee6aba1`, 358 files, truncated true, `outcome.status=verified`,
`runStatus=completed`, and the canonical seven ordered events. No built-in tool or
workspace mutation was used.

Focused restart evidence additionally proves:

- a raw child-process crash at a pending evidence capability;
- completed planner and approval frames replay with zero host calls;
- the authorized evidence retry invokes exactly once;
- unresolved non-idempotent work invokes zero planner, approval, or capability work;
- terminal resume returns the identical artifact with no provider work;
- completed capability evidence is consumed without live dispatch;
- reordered/tampered/transcript-bounds failures are rejected.

## Complications found and corrected

- The Windows shell initially selected an MSVC Rust toolchain without `link.exe`;
  validation now pins the installed GNU/LLVM toolchain and `rust-lld`.
- Clippy caught a missing explicit `truncate(false)` on the lock-file open and large
  enum variants. Both were corrected without changing the JSON protocol.
- A `plannerCheckpoint: null` resume frame could be mistaken for a supplied
  checkpoint. The host now omits the field when unavailable.
- A synchronized but unpublished terminal temporary artifact was initially left as
  incomplete. Explicit resume now validates and atomically promotes it.
- Retry permission originally could be reused after a retry crash. The durable
  attempt record now makes the one-retry ceiling total, not per process.
- VS Code retained a stale MCP Node process across the protocol rebuild. The first
  controlled call failed honestly with `Unsupported protocol start type or version`;
  the documented server restart aligned both sides and the fresh retest passed.

## Retained gaps

1. Hosted Windows/macOS/Ubuntu has not run against this exact continuation head.
2. The outer interaction record does not yet cross-link a retained ChangeSet
   transaction identity. This does not permit replay: governed change is explicitly
   non-idempotent and blocks, while its Rust ChangeSet journal remains authoritative.
3. A crash after initial `request.json` publication but before continuation/event
   record initialization reports repair required rather than self-healing.
4. Unresolved provider and approval requests are intentionally never retried;
   continuation requires the same bridge protocol version.
5. Cross-device continuation, distributed locking, power-loss guarantees beyond
   the tested synchronization boundary, sandboxing, and durable query projections
   remain outside this gate.

## Next gate

Run the exact head on hosted Windows/macOS/Ubuntu. Then decide whether the two
local retained gaps are trusted-alpha blockers or
explicitly documented release-hardening work before packaging the developer alpha.