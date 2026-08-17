# ADR-0016: CLI8 bounded learning observations

- **Status:** accepted for CLI8A foundation only
- **Date:** 2026-08-17
- **Scope:** Rust-owned typed observations and a rebuildable local projection

## Context

Forge has an authoritative Rust run/event/artifact path but no general learning
observation contract. Adding retrieval to the runtime now would conflate a new
memory lifecycle with the accepted run protocol and could make untrusted repository
text operational. CLI8A needs a narrow, testable foundation for later evaluation.

## Decision

Add `forge_core::memory` as an isolated append-oriented ledger with deterministic
identity and an in-memory derived projection. An observation records its kind,
claim subject, provenance, scope, confidence, observed time, freshness, and links
for supersession or correction. Deletion is represented by a scope-bound tombstone.
Projection rebuild starts from the ledger records, so restart behavior is explicit
and deterministic. Contradictory active claims remain visible and are grouped for
evaluation instead of being silently overwritten.

Repository text is an untrusted provenance variant and is filtered from default
retrieval. The explicit opt-in query is an evidence inspection facility, not an
instruction or execution path.

## Alternatives not selected

- Changing `RunEvent` or `RunArtifact`: unnecessary for this additive foundation and
  would require a contested core-contract checkpoint.
- SQLite/event-store: premature; current storage decisions reserve durable projection
  work for a later lifecycle checkpoint.
- Graph/vector infrastructure: not required to prove identity, scope, correction,
  deletion, or evaluation semantics.
- Automatic retrieval or skill promotion: out of CLI8A scope and unsafe before the
  evaluation fixture has a passing gate.

## Consequences

The Rust type definitions are ready for explicit callers and fixtures, but no
runtime behavior changes. The evaluation fixture pairs no-memory and retrieved-memory
cases and defines metrics for grounding, contradictions, scope leaks, stale evidence,
poisoned-text instruction adoption, correction, and latency.

## Revisit trigger

Before connecting observations to a run or planner, add a checkpoint that specifies
the retrieval event/artifact representation, persistence authority, trust policy,
and migration/backward-compatibility behavior.
