# ADR-0026: Cancellation-safe approval callbacks

- **Status:** Accepted for CLI ship lane increment 5A
- **Date:** 2026-08-04
- **Scope:** Interactive approval UI, cancellation, governed change lifecycle

## Context

Forge already has three distinct control layers:

1. Rust resolves host policy and user-consent facts to `allow`, `ask`, or `deny`.
2. The Rust/TypeScript bridge requests approval facts from the host before invoking
   a capability.
3. The governed change adapter asks the developer to approve the exact candidate
   operation and later to promote, discard, or retain the verified transaction.

Timeout and SIGINT cancellation already stop provider calls, bridge waits, verifier
process trees, and Rust transaction work. The two human approval waits were the
remaining gap: `InteractiveChangeIo.question` had no cancellation contract. A run
could reach its deadline while the CLI was waiting for input, yet the prompt
promise could remain pending until another line arrived. That is a core control
failure even when the underlying transaction remains safe.

## Decision

1. Every interactive question adapter accepts the current run `AbortSignal`.
2. The governed change executor also races the question against cancellation. This
   keeps host adapters safe even if a third-party question implementation ignores
   the optional signal.
3. Cancellation before candidate execution returns `cancelled` after preparation
   and before `workspace.change.propose`; no candidate or source mutation is
   requested.
4. The verified transaction ID is printed before the promotion prompt. Cancellation
   at that prompt returns `cancelled`, performs no accept/discard call, and retains
   the durable candidate for explicit later inspection.
5. Cancellation after accept or discard begins remains Rust-owned. The existing
   ChangeSet coordinator must promote, roll back, recover, or report repair state;
   TypeScript cannot manufacture a terminal transaction result.
6. EOF or a negative answer is not cancellation. It remains an explicit decline at
   the first prompt and retain-for-later at the second.
7. MCP remains exactly seven read-only tools. This change does not expose approval
   prompts or mutation through MCP.

## Bounds and invariants

- one run signal covers provider, policy, capability, question, verifier, and
  transaction adapter work;
- the first signal wins; later timeout/SIGINT notifications cannot rewrite the
  recorded cancellation source;
- question listeners are detached on answer, EOF, close, or cancellation;
- no approval fact is created from an aborted prompt;
- source workspace bytes do not change unless Rust later reports `promoted`;
- a verified candidate interrupted before promotion remains identifiable by its
  durable transaction ID.

## Rejected alternatives

- **Treat timeout as a default No answer.** This confuses cancellation with developer
  intent and loses the reason.
- **Close the entire readline interface on every cancelled run.** Interactive Forge
  should cancel the current task and remain usable for the next prompt.
- **Rely only on the UI adapter to honor AbortSignal.** Embedded hosts can be buggy;
  the governed executor must guarantee that its own promise settles.
- **Auto-discard on cancellation.** A verified candidate can be expensive to
  reproduce. Retention is safer and already supported by the durable coordinator.
- **Auto-accept after successful verification.** Verification is not developer
  consent to mutate the source workspace.

## Acceptance gates

- cancellation while waiting for the first decision settles promptly and calls
  only preparation;
- cancellation while waiting for promotion performs no accept/discard call and
  returns the retained transaction ID;
- ordinary decline, accept, discard, verification failure, and terminal-state
  validation remain unchanged;
- full TypeScript validation passes;
- hosted Windows/macOS and real hybrid Windows/macOS/Ubuntu gates remain green;
- a live CLI timeout at each approval prompt proves no early source mutation;
- the controlled VS Code read-only seven-tool tether remains unchanged.

## Deferred work

This is increment 5A, not the whole approval/control lane. Rust-owned independent
capability-call and inference/token budgets are 5B. User-selectable policy modes
and embedded-host approval callback conformance are 5C. Crash-resume and durable
outer RunArtifact recovery remain ship lane 6.
