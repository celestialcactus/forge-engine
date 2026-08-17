# Checkpoint 43: CLI8A bounded learning foundation

- **Status:** passed with environment-limited validation
- **Date:** 2026-08-17
- **Related ADRs:** ADR-0006, ADR-0007, ADR-0011, ADR-0016
- **Scope:** additive Rust memory observation ledger, projection tests, and evaluation fixture

## Objective

Prepare CLI8A's attributable learning foundation and CLI8B evaluation fixture
without activating retrieval or changing the alpha runtime.

## Architecture at this checkpoint

The existing Rust run/event/artifact path remains authoritative and unchanged.
`forge_core::memory` is a separate append-only record stream with a deterministic
projection. It can be serialized and reconstructed, but nothing in the run
coordinator, planner, CLI, MCP adapter, bridge, packaging, release workflow, or
sandbox provider calls it.

## Changes since the previous checkpoint

- Audited existing run, event, artifact, bridge, and storage contracts.
- Added typed observations for six CLI8 memory kinds.
- Added deterministic identities, provenance, scope isolation, confidence,
  observed time, freshness, supersession, correction links, and tombstones.
- Added contradiction, poisoned repository text, restart/rebuild, scope, and
  correction/deletion tests.
- Added paired no-memory/retrieved-memory evaluation data and a metrics JSON schema.

## Decisions proposed or adopted

| Decision | Status | Rationale | ADR |
|---|---|---|---|
| Keep CLI8A memory isolated from run/event/artifact contracts | adopted | Avoids a contested protocol migration before evaluation | ADR-0016 |
| Treat repository text as untrusted evidence and exclude it by default | adopted | Prevents repository prompt injection from becoming operational memory | ADR-0016 |
| Preserve contradictions for explicit evaluation | adopted | Avoids silent loss of conflicting evidence | ADR-0016 |
| Defer automatic retrieval and durable/graph/vector storage | adopted | Keeps the foundation bounded and attributable | ADR-0016 |

## Validation performed

| Command or experiment | Result | Evidence |
|---|---|---|
| `cargo fmt --all` | passed | Rust sources and tests formatted. |
| `cargo test -p forge-core --test memory_foundation` | environment-limited | Build could not link because `link.exe` is not installed. |
| `cargo check -p forge-core --tests --locked` | environment-limited | Windows MSVC dependency build also requires unavailable `link.exe`. |
| Static contract review | passed | No edits to run/event/artifact/bridge/CLI/MCP/release/provider internals. |

## Failures and surprises

- The requested `4e15226` baseline is not present locally; this checkout is at
  `aa73e0e` and was preserved without rewriting history.
- The managed environment lacks the Windows MSVC linker, so executable Rust test
  validation could not complete here.

## Known limitations

- The ledger is an in-memory owner of an append-only record vector; durable local
  storage and crash recovery are not implemented.
- Retrieval is an explicit library query only; there is no automatic planner or
  run integration.
- The fixture defines metrics and paired cases but does not claim measured results.

## Framework and service inventory

| Dependency/service | Purpose | Why selected | Lock-in/migration risk |
|---|---|---|---|
| Existing `serde`/`serde_json` | Typed record serialization and restart fixture | Already part of Rust authority | Low; records are versioned and isolated |
| Existing `sha2` | Deterministic observation/tombstone identity | Already a workspace dependency | Low |

## Repository state

- **Branch/commit:** detached `HEAD` at `aa73e0e` before local commit
- **Files changed:** `forge_core::memory`, focused Rust tests/fixtures, audit, ADR, checkpoint
- **Production behavior available:** no runtime/CLI behavior change; explicit library foundation only

## Next checkpoint

Evaluate the paired fixture and decide whether a reviewed retrieval/result contract
is warranted. Do not connect memory to automatic runtime retrieval until trust,
scope, correction, deletion, and artifact accounting are accepted.
