# ADR-0025: Rust-owned capability context and edit lifecycle

- **Status:** Accepted for CLI ship lane increment 4B-3
- **Date:** 2026-08-04
- **Scope:** Canonical run contract, approvals, capability evidence, interactive edits

## Context

Increment 4B-2 proved that Forge can combine provider-selected evidence with the
Rust ChangeSet v2 transaction safely enough to propose, verify, and promote a
bounded edit. It also exposed a real lifecycle seam: the Rust planning RunArtifact
reaches `run.completed` before TypeScript starts the sovereign change transaction.
The records are attributable, but no single authoritative run contains the prior
read evidence, exact review decision, verification, and terminal transaction state.

The generic runtime also asks policy to decide from the current capability call
alone. A governed edit needs the ordered successful reads that preceded the call.
Reconstructing that evidence in a CLI wrapper would create a second runtime and
make terminal truth depend on the integration layer.

## Decision

1. The canonical run contract advances to RunArtifact schema version 3 and the
   Rust bridge advances to `forge.kernel.bridge.v5`. Older peers fail closed.
2. Rust constructs a versioned `CapabilityContext` before every approval. It
   contains the run/task/snapshot/context-plan identity and the ordered prior
   capability observations. The current call is not part of the prior set.
3. Rust derives a compact `CapabilityContextBasis` containing the ordered prior
   call IDs and a SHA-256 digest of the canonical prior-observation encoding with
   lexicographically sorted JSON object keys.
   `approval.decided` records this basis, binding the decision to the evidence
   that was actually available without duplicating full evidence in the event.
4. The identical context is supplied to approval policy and, after an allow
   decision, capability invocation. TypeScript may present UI and run adapters;
   it may not replace or amend the Rust-authored context.
5. `CapabilityResult` may carry one optional, versioned `CapabilityEvidence`
   envelope: `{ schemaVersion, kind, data }`. Rust validates its kind and byte
   bound before retaining it. Human/model text remains in `content`; machines do
   not have to recover authoritative transaction data by parsing prose.
6. Increment 4B-3 first lands this contract with Rust/TypeScript differential
   conformance. The following composition step replaces the post-terminal CLI
   handoff with a governed `workspace.change.execute` capability inside the open
   Rust run.
7. The governed capability reuses ChangeSet v2 preparation, digest-bound consent,
   candidate verification, and promotion/discard/retain authority. It does not
   add another mutation engine or a TypeScript aggregate artifact.
8. MCP remains exactly seven read-only tools. Mutation is initially available
   only in the policy-enabled standalone CLI.

## Bounds

- capability context schema: exactly 1;
- context basis schema: exactly 1;
- prior observations: no more than the run turn limit, always in completion
  order, and at most 4 MiB when canonically serialized;
- prior call IDs: non-empty and unique within the run;
- observation digest: lowercase SHA-256;
- capability evidence schema: exactly 1;
- evidence kind: 1 through 100 ASCII lowercase identifier characters
  (`a-z`, `0-9`, `.`, `_`, `-`);
- serialized evidence envelope: at most 4 MiB, below the 8 MiB host-frame bound.

## Lifecycle target

For a successful edit, one Rust-authored RunArtifact must show this order:

1. evidence read(s);
2. governed change capability request and context-bound policy decision;
3. exact ChangeSet review and developer consent;
4. isolated candidate execution and configured verification;
5. accept, discard, or retain result in structured capability evidence;
6. model continuation, outcome assessment, and only then `run.completed`.

Decline, verification failure, cancellation, timeout, and stale-workspace races
must produce explicit structured results without falsely reporting a promoted
workspace.

## Honest boundary

This closes the split active-run record and preserves a retained transaction ID
for later control. It does not yet make every interrupted inference turn
crash-resumable. Append-oriented persistence, idempotent replay, and process-crash
resume remain CLI ship lane 6, Recovery state.

## Rejected alternatives

- **TypeScript aggregate over two terminal artifacts.** This hides the seam but
  leaves two runtime authorities.
- **Let policy reread the workspace independently.** That loses the exact evidence
  selected during the run and creates time-of-check/time-of-use ambiguity.
- **Put transaction JSON only in `content`.** Prose parsing is not an inspectable
  machine contract.
- **Teach the Rust core developer-specific edit semantics.** The core owns
  lifecycle and policy evidence; the integration capability composes existing
  Rust ChangeSet machinery.
- **Expose MCP mutation now.** Host approval and UX semantics have not passed a
  separate MCP mutation gate.

## Acceptance gates

- Rust unit tests prove context ordering, digest binding, exclusion of the current
  call, and fail-closed evidence bounds.
- TypeScript conformance produces byte-equivalent events/artifacts.
- Bridge tests prove v4/v2 peers are rejected and v5/v3 context survives the host
  round trip unchanged.
- The interactive low-model path performs one governed edit call with no
  post-`run.completed` transaction handoff.
- Decline, verifier failure, accept, discard/retain, cancellation, and stale-base
  paths remain non-destructive unless Rust reports `promoted`.
- Windows, macOS, and Ubuntu run the real Rust kernel plus TypeScript adapter.
- A fresh VS Code test still discovers exactly the seven read-only Forge tools.
