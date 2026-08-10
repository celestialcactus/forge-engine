# ADR-0030: Durable interaction transcript and safe continuation

- **Status:** Accepted; local and controlled VS Code gates passed, hosted acceptance pending
- **Date:** 2026-08-05
- **Scope:** CLI ship-lane increment 6B, Rust bridge, provider and capability restart safety

## Context

The 6A ledger proves which canonical Rust events became durable and whether a
terminal artifact exists. It deliberately cannot continue an open run because the
bridge exchanges that produced those events are still memory-only:

- planner request and provider turn;
- approval-facts request and response;
- capability invocation intent and result;
- provider message/tool-call correlation required by the next inference turn.

Restarting the task from its prompt would duplicate cloud inference and could
repeat a mutation, process, Git operation, human prompt, or external action. A
second recovery coordinator would also violate Forge's one-runtime rule.

## Decision

1. Advance the run bridge protocol for 6B. Every registered capability is declared
   with an explicit replay-safety descriptor. Missing or unknown safety is treated
   as `non_idempotent`, never inferred from a capability name.
2. Keep `request.json`, `events.jsonl`, and `artifact.json` as the 6A run authority.
   Add a bounded, versioned continuation manifest and append-only interaction log
   in the same hashed run directory. SQLite and graph views remain projections.
3. Rust records and synchronizes an interaction intent before sending a planner,
   approval, or capability request to TypeScript. It records and synchronizes the
   validated response before returning that response to the canonical runtime.
4. Planner completions include a bounded, typed integration checkpoint. The Rust
   ledger treats its state as opaque evidence while binding its schema, planner ID,
   payload digest, and interaction identity. The TypeScript planner owns validation
   and restoration of provider-specific message/tool-call state.
5. Restart classification is deterministic:
   - a recorded completion is consumed without another host/provider/capability call;
   - an unresolved planner request is ambiguous and never retried automatically;
   - an unresolved approval request is ambiguous and never re-prompts automatically;
   - an unresolved capability request may be retried only when its descriptor is
     explicitly `read_only_retryable` and the resume request deliberately permits it;
   - an unresolved `non_idempotent` capability is blocked;
   - a missing planner checkpoint blocks continuation that would require another
     provider turn.
6. Resume uses the same `Slice0Runtime`, not a recovery runtime. Rust starts it from
   the original request, supplies recorded interaction completions in order, and
   verifies every reproduced event against the durable 6A prefix. Matching prefix
   events are not appended again. The first new event is appended through the same
   append-before-notify ledger path.
7. A cross-platform OS file lock serializes live execution/resume for one run. The
   lock is released by the operating system on process death; a persistent lock
   filename is not treated as proof that an owner remains alive.
8. ChangeSet mutation journals remain the authority for prepared, retained,
   promoted, discarded, or recovered workspace state. After the separate Rust
   ChangeSet service returns a validated registered transaction, TypeScript may
   forward its content-addressed ChangeSet and transaction identities as a typed
   recovery checkpoint for the active outer capability. The outer Rust ledger
   validates the call binding, persists and synchronizes the checkpoint, and
   acknowledges it before the workflow may ask for promotion, retention, or
   discard. The transcript links the journals but never reimplements their state
   machine or makes the outer non-idempotent capability replayable.
9. Deliver in two bounded increments:
   - **6B-1:** descriptors, durable intent/completion transcript, provider checkpoint,
     inspection validation, and safe-frontier classification; no automatic resume;
   - **6B-2:** same-runtime deterministic replay, live frontier continuation, CLI
     resume surface, OS locking, and restart/crash acceptance fixtures.

## Why deterministic replay instead of state deserialization

The runtime already produces deterministic events from its request and host
responses. Replaying recorded responses through that runtime and comparing the
resulting events to the durable prefix reuses the behavior we test in normal runs.
Serializing private `RunState` would create a second evolving contract and require
migration logic for every internal field. A child continuation run would preserve
safety but fragment one developer task across competing run identities.

## Storage and bounds

6B-1 adds:

- `continuation.json`: run identity, canonical capability descriptors, transcript
  schema, and manifest digest;
- `interactions.jsonl`: ordered intent/checkpoint/completion frames with sequence,
  interaction ID, kind, attempt, replay safety, typed payload, and payload digest.
  A schema-2 checkpoint is allowed only once on the currently pending
  non-idempotent capability and contains bounded digest-shaped ChangeSet and
  transaction identities.

All files, frames, counts, strings, and opaque planner state are bounded before
allocation or presentation. A partial, reordered, mismatched, oversized, or
one-sided interaction record makes continuation `repair_required`; evidence is not
deleted automatically.

## Consequences

- Forge can distinguish "safe recorded response", "safe new frontier",
  "deliberately retryable read", and "ambiguous/unsafe" without model judgment.
- Provider implementations must expose a restorable checkpoint to continue after
  a completed tool turn. Ollama and OpenAI use the same normalized message/tool
  state contract even though their transports differ.
- Evidence-only workspace capabilities may opt into `read_only_retryable`.
  Governed change remains `non_idempotent` at the outer capability boundary even
  though its internal ChangeSet transaction has idempotent recovery operations.
- Classification remains independently inspectable; only the validated 6B-2 path
  may be marketed as resume.

## Implementation checkpoint

The exact-head local implementation is complete through bridge v10. It retains the
bridge-v9 continuation contract and adds the durably acknowledged typed ChangeSet
recovery checkpoint. The broader implementation adds bounded
`continuation.json` and `interactions.jsonl` records, OS-owned per-run locking,
planner checkpoint restoration, deterministic completed-response replay, exact
event-prefix comparison, terminal temporary-artifact recovery, CLI inspect/resume,
and one-total deliberate retry for an unresolved `read_only_retryable` capability.
The full local hybrid gate, packaged CLI smoke, and controlled one-call VS Code
retest pass; see
[Checkpoint 76](../checkpoints/2026-08-05-76-safe-run-continuation-local-gate.md).

The follow-up hardening closes the process-crash window during initial record
creation: locks use a non-authoritative namespace, all four initial ledger files are
synchronized in private staging, open handles are closed before a Windows-compatible
directory rename, and only the complete renamed directory is authoritative. An
abandoned staging directory is invisible to run inspection and cannot block a clean
retry. See
[Checkpoint 77](../checkpoints/2026-08-05-77-atomic-run-initialization-local-gate.md).

The bridge-v10 follow-up closes the outer-to-ChangeSet discoverability gap. The
interactive workflow waits for the outer Rust ledger's durable acknowledgement
after ChangeSet registration and before the second human decision. Inspection
projects that checkpoint for an interrupted non-idempotent call, while resume still
blocks and never invokes it. Wrong-call, invalid-identity, duplicate, and
misclassified checkpoints fail closed. See
[Checkpoint 78](../checkpoints/2026-08-06-78-changeset-recovery-checkpoint-local-gate.md).

Remaining acceptance work is hosted Windows/macOS/Ubuntu. ADR-0031 adds bounded
reporting for registered but never-finalized ChangeSet transactions and lock-safe
cleanup for unpublished coordinator staging without inventing a second recovery
coordinator or age-deleting prepared work. Unresolved provider and approval requests
remain intentionally non-retryable, same-version continuation is required, and
cross-device/distributed and general power-loss recovery are out of scope.

## Non-goals

- retrying an unresolved cloud inference request;
- automatically repeating a human approval prompt;
- declaring a mutation safe because its name sounds idempotent;
- cross-device continuation or distributed locks;
- cryptographic protection from a privileged actor rewriting every record;
- replacing ChangeSet journals, provider billing records, or enterprise audit export.

## Acceptance gates

- intent-before-send and completion-before-use are proven with live child-process
  inspection;
- provider checkpoints round-trip exact assistant tool-call IDs, names, arguments,
  tool results, provider, and model;
- inspection rejects transcript truncation, reordering, digest tampering, response
  mismatches, descriptor mismatch, and bounds violations;
- unresolved planner/approval/non-idempotent capability work is blocked;
- a retryable evidence capability is merely classified in 6B-1 and is executed at
  most once in 6B-2;
- 6B-2 restart fixtures prove zero duplicate cloud inference, prompts, mutation,
  promotion, Git operation, or external process;
- a governed-change fixture proves the checkpoint is durably acknowledged after
  registration and before the promotion/retain/discard prompt;
- wrong-call and malformed checkpoints are rejected, while crash inspection exposes
  the exact registered transaction and resume invokes the outer capability zero times;
- Node Windows/macOS, hybrid Windows/macOS/Ubuntu, and controlled VS Code gates pass.
