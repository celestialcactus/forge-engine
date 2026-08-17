# CLI8A memory foundation contract audit

- **Baseline inspected:** detached worktree at `aa73e0e` (`origin/develop`)
- **Requested baseline:** `4e15226`, unavailable in the local object database
- **Scope:** additive CLI8A learning foundation; no shared protocol migration

## Existing authority

| Contract | Current authority | Finding |
|---|---|---|
| Run state and lifecycle | `crates/forge-core/src/runtime.rs` | Rust `Slice0Runtime` owns sequencing, status, cancellation, capability execution, and terminal artifact assembly. |
| Events | `crates/forge-core/src/contracts.rs` | Rust `RunEvent`/`RunEventData` are ordered by `run_id` and `sequence`; the TypeScript Slice 0 shape is a parity adapter. |
| Terminal artifact | `crates/forge-core/src/contracts.rs` | Rust `RunArtifact` v1 is the host-neutral artifact; the hybrid adapter verifies streamed events match it. |
| Bridge transport | `crates/forge-kernel/src/protocol.rs` and `main.rs` | Private NDJSON bridge only; no memory messages or memory retrieval were added. |
| Storage | `crates/forge-core/src/candidate_lease.rs`, change-set/transaction modules | Durable storage exists for candidate/transaction lifecycle evidence only. There is no general run or memory store. |
| Future projections | ADR-0006, ADR-0007, ADR-0011, architecture changelog | SQLite/event-store and graph projections remain future or derived concerns; neither is a current authority. |

## CLI8A boundary

The new `forge_core::memory` module is an isolated append-only ledger and deterministic
projection. It defines typed observations for workspace architecture, repository
convention, domain fact, developer preference, workflow step, and correction/negative
evidence. It does not alter `RunEvent`, `RunArtifact`, the bridge protocol, planner
requests, CLI commands, MCP output, packaging, release workflows, or sandbox providers.

The ledger carries deterministic content identity, typed provenance, workspace/repository/
branch/actor scope, bounded confidence, observed time, freshness policy, supersession,
correction links, and append-only tombstones. Rebuilding the projection from serialized
records is the restart/recovery behavior for this foundation.

Repository text is retained as explicitly untrusted provenance and is excluded from
default retrieval. Explicit inclusion returns it as evidence with its provenance intact;
the module never interprets repository text as an instruction or executes it.

## Deferred work

- No automatic retrieval is connected to planning or runs.
- No public memory CLI or MCP behavior exists.
- No SQLite, graph, vector, embedding, or skill-promotion infrastructure exists.
- Any future integration that changes the run/event/artifact or bridge contracts requires
  a separate reviewed checkpoint.
