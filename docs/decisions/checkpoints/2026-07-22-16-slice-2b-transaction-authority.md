# Checkpoint 2026-07-22-16: Slice 2B transaction authority

- **Status:** 2B-1 accepted; production adapter pending
- **Date:** 2026-07-22
- **Related ADRs:** ADR-0005, ADR-0006, ADR-0007
- **Scope:** Rust-authoritative candidate transaction contract and failure semantics

## Objective

Establish the transaction authority and executable proposal binding before adding
a production filesystem, Git worktree, or process adapter.

## Architecture at this checkpoint

TypeScript and future hosts may construct integration inputs, but they cannot
choose the final transaction status.

    Slice 2A proposal plus exact application manifest
                              |
           approved capability subject and ApprovalFacts
                              |
                   Rust validation and policy
                              |
        prepare -> apply -> verify -> retain or recover
                              |
         subordinate ChangeTransactionArtifact evidence
                              |
                 authoritative parent RunArtifact

The application manifest carries canonical path, before digest, after digest, and
exact replacement text. It is internal and is not added to the seven-tool MCP
projection.

## Changes since the previous checkpoint

- Added forge-core change transaction schemas and state machine.
- Added exact TypeScript-compatible proposal identity recomputation.
- Bound approval to transaction ID, proposal ID, snapshot ID, and verification
  check ID through the capability call input.
- Retained Slice 2A limits: 1 to 20 canonical UTF-8 replacements, at most 1 MiB
  each, no NUL payload.
- Added adapter evidence validation for boundary identity, original-workspace
  preservation, exact applied paths/digests, and verification consistency.
- Added deterministic recovery after post-boundary failure or cancellation.
- Added explicit terminal failure when recovery itself fails.
- Added sha2 0.10.9 under the locked Rust dependency graph.

## Decisions proposed or adopted

| Decision | Status | Rationale | ADR |
|---|---|---|---|
| Exact replacement payload belongs in an internal manifest | accepted for 2B-1 | bounded review diffs can be truncated and are not executable | ADR-0007 |
| Rust alone assigns transaction status and phase order | accepted | preserves the hybrid authority boundary | ADR-0007 |
| Successful candidate execution stops before promotion | accepted | active-workspace mutation needs a fresh-base and explicit policy gate | ADR-0007 |
| Transaction phases are subordinate evidence, not another run stream | accepted | RunArtifact remains the one host-neutral authority | ADR-0007 |
| Generic shell/write or an eighth MCP tool | rejected | would bypass proposal, policy, and recovery contracts | ADR-0007 |

## Validation performed

| Command or experiment | Result | Evidence |
|---|---|---|
| Focused locked Rust transaction suite | passed | 11 tests |
| Rust formatting and Clippy with warnings denied | passed | included in npm run check:hybrid |
| Complete Rust workspace tests | passed | 24 tests across context, transaction, policy, and runtime |
| TypeScript control suite | passed | 37 tests plus typecheck and production build |
| Hybrid and official MCP conformance | passed | 22 tests; exactly seven tools retained |
| TypeScript proposal identity vector | passed | change:53c6349f6e754aa91c10 matches Rust |
| Approval-subject swap fixture | passed | rejected before adapter work |
| Tampered and oversized replacement fixtures | passed | rejected before adapter work |
| Apply, verification, malformed evidence, and cancellation fixtures | passed | deterministic recovery |
| Cleanup failure fixture | passed | explicit terminal failure |
| Hosted hybrid kernel matrix | passed | exact commit `f47267c`; Windows, macOS, and Ubuntu; [run 29944643950](https://github.com/celestialcactus/forge-engine/actions/runs/29944643950) |
| Hosted TypeScript conformance matrix | passed | exact commit `f47267c`; Windows and macOS; [run 29944643938](https://github.com/celestialcactus/forge-engine/actions/runs/29944643938) |
| Controlled VS Code apprentice test | passed | one actual Forge Workspace Summary call; no terminal, built-in file search, or non-Forge tool |

The controlled VS Code call returned run
`run:67ed93cc-4e5e-4aff-9e96-dce4948250c0`, snapshot
`workspace:256988fd702fb27c`, 182 total files, and bounded/truncated evidence.
Its ordered event types were `run.started`, `context.planned`,
`capability.requested`, `approval.decided`, `capability.completed`, and
`run.completed`.

## Failures and surprises

- The Slice 2A artifact is reviewable but not executable because exact replacement
  content is intentionally absent. This required a separate internal manifest.
- Generic JSON maps could have produced a Rust-only proposal identity because
  TypeScript hashes insertion-ordered JSON. Ordered Rust serialization and a
  literal cross-language vector now prevent that drift.
- Approval facts bind to a call ID and capability ID, but the transaction also had
  to validate the call input against the exact proposal, snapshot, transaction,
  and verification selection to prevent subject swapping.
- The locked test gate correctly refused the new sha2 dependency until Cargo.lock
  was updated deliberately.

## Known limitations

- No production worktree or staged-copy adapter exists yet.
- The new state machine is not exposed through MCP, CLI, or the private bridge.
- No active developer workspace is mutated.
- Verified-candidate retention and final promotion remain unimplemented.
- Descendant-process termination, dependency availability, final diff evidence,
  and cleanup persistence remain 2B-2 gates.
- The internal replacement payload is in memory; a durable content-addressed
  artifact store is still needed for crash recovery.

## Framework and service inventory

| Dependency/service | Purpose | Why selected | Lock-in/migration risk |
|---|---|---|---|
| sha2 0.10.9 | SHA-256 manifest and proposal binding | small RustCrypto implementation with locked transitive graph | low; algorithm and vectors are standard |
| serde and serde_json | private schema serialization | already accepted by the Rust kernel bridge | moderate schema coupling; protected by fixtures |
| Git worktree | future candidate boundary | already validated as a clean-base recoverability mechanism | not yet production accepted |

## Repository state

- Branch: feature/slice-2b-change-transaction
- Base: 69d2b743fc472ff00658c108f74450286f9044f8
- Accepted implementation commit: f47267cbd4c8f467c1cd5a84a0ded8f43a887b95
- Production behavior available: none; service and MCP surfaces remain unchanged

## Next checkpoint

Implement Increment 2B-2 as a Rust clean-revision worktree adapter. It must prove
base revision and every before digest, apply only inside the detached candidate,
resolve a policy-owned verification check, preserve the original workspace, and
recover on every failure. Do not add promotion or MCP mutation in that increment.
