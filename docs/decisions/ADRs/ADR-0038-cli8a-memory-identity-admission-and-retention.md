# ADR-0038: Lock CLI8A memory identity, admission, and retention

**Date:** 2026-08-20
**Status:** Accepted for CLI8A contract implementation
**Scope:** Attributable observation and replay foundation only

## Context

Forge must not turn model prose or repository text into hidden durable
instructions. The accepted run, evidence, policy, transaction, and artifact paths
already provide the authority from which learning records may be derived, but they
do not define memory identity, admission, correction, deletion, or freshness.

The stale-base CLI8A candidate `b5effea` is useful implementation evidence, not
accepted state. It has one content-derived observation identity, a permissive
optional-field scope, caller-selected expiry, and no privacy-purge operation. A
verbatim replay would contradict the two-identity and no-widening rules in the
memory semantics primer.

This decision freezes the four policies that must be settled before any durable
memory implementation or retrieval integration begins.

## Decision

### 1. Use conservative, versioned claim normalization

Forge assigns two distinct identities:

- `claimId` identifies one normalized statement, statement kind, subject kind,
  subject, and exact authority scope;
- `observationId` identifies one attributable observation of that claim, including
  its provenance, relation, confidence, freshness basis, and observed time.

Normalization version `memory_text_v1` performs only transformations whose meaning
is not reasonably ambiguous:

1. convert CRLF and bare CR line endings to LF;
2. remove leading and trailing ASCII whitespace from the complete value;
3. reject empty, oversized, control-character-bearing, or NUL-bearing values.

Case, punctuation, internal whitespace, Unicode code points, paths, identifiers,
and ordering remain significant. Forge does not use a model, embedding, locale,
stemming, or semantic paraphrase to merge claims. A later reviewed alias event may
declare two claim IDs equivalent; that mechanism is not part of CLI8A.

This deliberately favors visible duplicates over an invisible false merge.

### 2. Require explicit admission for durable developer preferences

A developer statement is attributable evidence, but it is not automatically a
durable preference. A `developer_preference` claim is recordable only when its
provenance carries one of two explicit admission facts:

- the developer used an explicit remember action; or
- the developer reviewed and accepted a proposed preference.

Incidental conversation, model summaries, repository text, and inferred behavior
cannot create developer-scoped preferences. Repository or workspace claims derived
from a developer statement remain hypotheses until separate workspace evidence
verifies them. Model prose alone is never a verified fact.

### 3. Separate ordinary forgetting from privacy purge

`forget` is an append-only, scope-bound tombstone. It excludes the target from
normal future selection while preserving the historical observation and the reason
for its exclusion. Correction is also append-only: a new attributable observation
links the exact older observation it corrects or supersedes.

`purge` is a separate explicit and irreversible privacy operation. It rewrites the
memory ledger without the target content, rebuilds every disposable projection,
and appends a non-content receipt containing only the operation ID, actor, time,
scope class, reason code, and removed-record count. The receipt contains no claim
text, source text, claim/observation digest, or reversible content fingerprint.

Purging memory does not silently claim to purge canonical run or artifact stores.
Those stores retain their own retention authority and must be named separately in
the command result.

### 4. Use evidence-driven freshness, not arbitrary default TTLs

CLI8A defines no universal wall-clock expiry:

- verified workspace, repository, branch, and workflow claims remain current only
  while their bound evidence fingerprint remains current;
- inferred hypotheses are run-bounded and are ineligible for normal retrieval;
- explicitly admitted developer preferences remain current until corrected,
  forgotten, purged, or explicitly given a review/expiry time;
- a naturally time-bounded fact may carry an explicit `validUntil`, after which it
  is stale but remains inspectable;
- corrections inherit no independent authority merely from correcting another
  record; their own provenance and freshness remain visible.

Changing a Git branch, workspace snapshot, source digest, or explicit validity time
changes freshness, not claim identity. Stale and conflicting observations remain
inspectable and are excluded from normal retrieval by default in the later CLI8B
lane.

### 5. Make authority scope explicit and non-widening

Every claim has exactly one tagged scope: `branch`, `repository`, `workspace`, or
`developer`. Organization scope remains deferred. Required identifiers are part of
the scope variant rather than optional wildcard fields.

CLI8A inspection is exact-scope by default. A later context compiler may explicitly
admit named parent scopes and must record the rule used. No event or projection may
promote branch knowledge to repository/workspace scope, repository text to
developer scope, or workspace knowledge to developer scope implicitly.

### 6. Keep CLI8A runtime-inactive

The first implementation increment adds Rust-owned types, validation, deterministic
identities, append/rebuild behavior, correction/tombstone/purge semantics, and
golden fixtures. It does not modify `RunEvent`, `RunArtifact`, the provider loop,
the context compiler, CLI/MCP behavior, or planner input. Retrieval and automatic
skill use remain closed until CLI8B evaluation passes.

## Rejected alternatives

- **Semantic or embedding identity:** too easy to merge distinct instructions and
  makes identity depend on a model or index implementation.
- **Immediate preference persistence:** turns ordinary conversation into hidden
  durable instruction.
- **Tombstone-only privacy claims:** does not satisfy an explicit request to remove
  content bytes from the memory store.
- **One TTL for every record:** treats source changes, developer preferences, and
  short-lived facts as if they had the same validity model.
- **Verbatim replay of `b5effea`:** preserves its structural gaps and stale ADR
  numbering even though its bounded tests and limits remain useful references.

## Consequences

- CLI8A may proceed as an isolated additive Rust module with no runtime activation.
- The contract must freeze separate claim and observation IDs, exact tagged scopes,
  explicit preference admission, evidence freshness, and non-content purge receipts.
- Golden fixtures must cover normalization boundaries, repeated evidence,
  contradictions, correction, tombstone, privacy purge, scope isolation, poisoned
  repository text, restart/rebuild, and tamper rejection.
- CLI8B must establish paired no-memory/retrieval distributions and thresholds
  before normal retrieval can be enabled.

## Revisit triggers

Revisit this ADR before adding semantic claim aliases, organization scope, automatic
retrieval, cross-device memory synchronization, or a retention operation that also
mutates canonical run/artifact stores.
