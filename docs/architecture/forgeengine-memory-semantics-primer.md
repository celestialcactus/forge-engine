# ForgeEngine memory semantics primer

**Status:** proposed contract for CLI8A review; not runtime-active
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

## Four decisions still requiring confirmation

1. **Normalization:** which textual variations represent one claim without merging
   genuinely different architecture statements.
2. **Preference promotion:** whether a developer statement becomes durable
   immediately or requires explicit “remember this”/review.
3. **Deletion:** when a tombstone is enough and when privacy requires physical purge
   plus a non-content audit receipt.
4. **Expiry defaults:** different kinds likely need different freshness rules; we
   need fixture evidence before choosing durations.

Recommendation: accept the identity, append-only lifecycle, and no-widening rules
now; decide the four policy choices with CLI8A/8B fixtures before merging durable
memory or activating retrieval.
