# ForgeEngine memory semantics primer

**Status:** policy locked by [ADR-0038](../decisions/ADRs/ADR-0038-cli8a-memory-identity-admission-and-retention.md)
and [ADR-0039](../decisions/ADRs/ADR-0039-cli8a-hybrid-memory-capture-and-recovery.md);
Slice 1–2 lifecycle candidate active, retrieval inactive
**Purpose:** explain what “memory” means before durable records make mistakes sticky

Forge memory is not hidden model state. It is an inspectable set of attributed
claims derived from runs, developer input, and verified workspace evidence. The
append-oriented ledger is authoritative; SQLite tables, keyword indexes, vectors,
and graphs are disposable projections.

## The two identities

One semantic statement may be observed many times. Therefore Forge needs two IDs:

- `claimId`: the normalized meaning plus scope—for example, “this repository uses
  ports-and-adapters boundaries.” Confidence, timestamp, and source are not part of
  this identity.
- `observationId`: one attributable observation supporting, contradicting, or
  correcting that claim. It includes the source evidence/run and observation time.

If confidence or evidence were part of the claim identity, seeing the same fact
twice would create unrelated memories. If they were discarded, Forge could not
explain why confidence changed. Separating the IDs preserves both behaviors.

## Lifecycle in novice terms

Think of memory as a notebook where pages are never erased silently:

1. an observation is appended with its source, scope, confidence, and freshness;
2. a correction appends a newer observation and links the older one as superseded;
3. deletion appends a tombstone so normal retrieval stops using the claim;
4. historical evidence stays inspectable unless a separate privacy purge is
   explicitly authorized;
5. restoration is another reviewed event, not removal of the tombstone from history.

Confidence means “strength of support,” not “probability that the model is right.” A
verified file fact and an inferred architectural hypothesis must remain different
kinds even when both have a high numeric score.

## Scope and inheritance

The safe default is no implicit widening:

- branch knowledge applies only to that branch;
- repository/workspace knowledge applies only to the exact repository/workspace;
- developer preferences may follow that developer but cannot override repository or
  organization policy;
- repository text cannot automatically become a developer instruction or preference;
- organization sharing is deferred until identity, administration, and deletion are
  designed.

A narrower scope may explicitly read permitted parent knowledge—for example, a
branch task may use repository conventions—but the reverse is forbidden. Every
selection records the scope rule that admitted it.

## Freshness, conflicts, and retrieval

Stale or contradicted records are not destroyed. They are excluded from normal
context by default and surfaced when they explain a conflict. Retrieval first
produces candidates; the context compiler then decides what is admitted under the
task budget and records why each candidate was selected or omitted. A vector hit or
graph edge is never authority by itself.

## Four locked CLI8A policies

1. **Normalization:** `memory_text_v1` normalizes line endings and trims only outer
   ASCII whitespace. Case, punctuation, internal whitespace, Unicode, paths, and
   identifiers remain significant. Forge prefers a visible duplicate to a false
   semantic merge.
2. **Preference admission:** a durable developer preference requires an explicit
   remember action or reviewed acceptance. Incidental conversation, model prose,
   repository text, and inferred behavior cannot create it.
3. **Deletion:** ordinary forgetting is an append-only tombstone. An explicit
   privacy purge physically removes content from the memory ledger and projections
   while retaining only a non-content receipt; canonical run/artifact retention is
   a separate authority and must be reported honestly.
4. **Freshness defaults:** freshness follows evidence validity rather than a
   universal TTL. Hypotheses are run-bounded, verified repository/workspace facts
   are evidence-bound, admitted preferences persist until reviewed or removed, and
   naturally time-bounded facts may carry an explicit validity time.

ADR-0038 also freezes exact tagged scopes. ADR-0039 assigns canonical identity,
storage, lifecycle, and provenance authority to Rust while TypeScript orchestrates
the product UX and future replaceable retrieval machinery. Slices 0–4 are accepted
through PRs #32–34; the active Slice 5 candidate adds only a read-only eligibility
preview. Forge still does not insert memory into planner/provider prompt context or
activate retrieval. Automatic retrieval still requires the paired CLI8B evaluation
gate; this non-activation is not a claim of general prompt-injection resistance.
