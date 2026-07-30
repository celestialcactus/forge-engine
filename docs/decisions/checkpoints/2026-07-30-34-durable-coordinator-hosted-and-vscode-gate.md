# Checkpoint 2026-07-30-34: Durable coordinator hosted and VS Code gate

- **Status:** accepted
- **Date:** 2026-07-30
- **Related ADRs:** ADR-0009, ADR-0010, ADR-0011
- **Scope:** Slice 2E-2 process-restart coordination and integration regression
- **Implementation:** `8c290379ec930f0edb379d2c3246f51bb8603cdc`

## Outcome

Accept the bounded Rust ChangeSet v2 coordinator. Forge now has a deterministic,
restart-reconcilable publication and rollback protocol for the supported operation
algebra. The result is strong enough to continue to Slice 2E-3; it is not yet a
public CLI/MCP mutation feature or a power-loss filesystem transaction.

## What changed

- Added one Rust-owned transaction manifest, exact before-images, and synchronized
  append-oriented transition journal per registered ChangeSet v2 transaction.
- Added deterministic operation ordering, fresh digest/mode/absence validation,
  advisory repository and transaction locks, verified promotion, rollback, graceful
  cancellation, terminal replay, and process-restart reconciliation.
- Added strict transition/sequence validation. Unrecognized partial state, corrupt
  evidence, or divergent developer content becomes `repair_required`; Forge does
  not overwrite it automatically.
- Kept Windows executable create/mode changes and case-only active rename fail-before-
  mutation until those operations can preserve exact Tier-1 semantics.

## Validation evidence

| Gate | Result | Evidence |
|---|---|---|
| Local TypeScript/runtime gate | Passed | `npm run check`: typecheck, 37/37 tests, production build |
| Coordinator fault fixtures | Passed | Promotion/rollback interruptions, sequence corruption, cancellation, same-size divergence, terminal replay |
| Hosted cross-platform conformance | Passed | Run `30511168395`; Windows and macOS |
| Hosted hybrid kernel conformance | Passed | Run `30511168400`; Windows, macOS, and Ubuntu |
| Hosted Rust quality gates | Passed | Formatting, clippy with warnings denied, tests/build, release build, latency gate |
| Controlled VS Code tether | Passed | One Forge summary call, no other tool calls, completed before the first five-second observation |

The local Windows workstation could not natively link the Rust suite because the
required MSVC/GNU linker was absent. Hosted Windows is therefore the native Rust
acceptance evidence; this limitation is not hidden as a local pass.

## Controlled VS Code result

VS Code 1.130.0 opened the exact feature worktree. The `forge-engine` tool set was
the only selected set; all seven child Forge tools were discovered and checked.
In a fresh Agent chat, this exact bounded request was issued:

> Use only Forge tools. Call Forge Workspace Summary exactly once with maxFiles 20.
> Report the Forge run ID, snapshot ID, totalFiles, truncation status, and ordered
> event sequence. Do not use built-in file search or terminal.

Observed result:

- exactly one `Forge Workspace Summary` MCP call;
- run `run:2ce9c1c3-e591-4215-9c4a-be6dc4989a71`;
- snapshot `workspace:300507622a52e944`;
- 232 workspace files, bounded to 20 paths, `truncated = true`;
- ordered events: `run.started` → `context.planned` → `capability.requested` →
  `approval.decided` → `capability.completed` → `run.completed`;
- no built-in file search, terminal, retry, follow-up Forge call, artifact
  externalization, or stall.

This VS Code test proves the accepted seven-tool read-only tether did not regress.
It does not exercise the new coordinator directly because Forge intentionally has
no public MCP mutation surface yet.

## Remaining limitations and assigned slices

- No power-loss transaction is claimed; filesystem durability experiments, repair
  tooling, schema migration, and garbage collection remain release hardening.
- Windows executable-mode active publication and case-only active rename remain
  explicitly unsupported and fail before mutation.
- Complete candidate cleanup/ownership and the high-level propose → verify → inspect
  → accept/discard CLI remain Slice 2E-3.
- Abrupt macOS verifier-owner death remains a separate Slice 2E gate.
- No public MCP mutation, authenticated host handshake, or Forge-enforced restricted
  execution backend exists; those remain Slice 2F.
- The baseline supervised child still has lifecycle isolation, not a security
  sandbox. Host-managed containment remains an assertion until authenticated
  negotiation exists.

## Forecast after acceptance

The dependable core local change machinery is approximately **82% complete**.
With one focused lane and working hosted CI, the current planning ranges are:

- curated evidence-backed CLI demonstration: **2–3 weeks**;
- dependable core local change engine: **2–4 weeks**;
- shippable standalone CLI alpha: **5–8 weeks**;
- broader enterprise pilot with restricted execution and policy integration:
  **12–16 weeks**.

These remain planning ranges, not promises. The largest near-term uncertainties are
macOS abrupt-owner handling and composing the private coordinator into one clean,
recoverable public CLI without duplicating runtime semantics.

## Next increment

Proceed with Slice 2E-3: close abrupt macOS owner-death handling and expose the
accepted Rust transaction authority through one complete sovereign CLI workflow.
Do not begin context compression, memory, skills, or public MCP mutation in
parallel with this core gate.
