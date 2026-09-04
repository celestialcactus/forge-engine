# ADR-0039: Use hybrid memory machinery with standing capture grants and bounded recovery

**Date:** 2026-08-29
**Status:** Accepted through Slice 4 merge PR #34 (`9bba75e`) and amended by the
approved bounded Slice 5 eligibility-preview contract on 2026-09-02; Slice 5 is an
active, unaccepted implementation candidate
**Scope:** CLI8A capture, lifecycle, recovery, and future retrieval boundary
**Amends:** ADR-0038

## Context

ADR-0038 accepted Rust-owned memory identity, provenance, exact scope, explicit
preference admission, append-oriented correction and forgetting, privacy purge,
and evidence-driven freshness. Product review after the Package 1 contract exposed
three refinements that must be decided before lifecycle implementation:

1. requiring a blocking confirmation for every useful preference would make memory
   feel like another approval checkpoint;
2. indefinitely retaining every superseded content version would create avoidable
   local storage growth even though inactive records do not consume prompt context;
3. advanced retrieval and learning machinery needs a fast, replaceable integration
   layer without becoming a second memory or policy authority.

Hermes Agent demonstrates useful product mechanisms: bounded always-on memory,
frozen session snapshots, on-demand history search, progressive skill disclosure,
atomic memory edits, and replaceable memory providers. Forge needs those benefits
without allowing model-authored strings, a provider, or a search index to become
canonical truth. See the upstream
[Hermes memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md),
[provider](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory-providers.md),
and [skill](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md)
documentation.

## Proposed decision

### 1. Preserve a hybrid authority boundary

Rust owns:

- canonical memory contracts and deterministic identities;
- scope, provenance, freshness, admission, and lifecycle validation;
- durable memory events, rebuild, correction, forgetting, recovery, compaction,
  and purge;
- final context admission and the evidence explaining selection or omission;
- future skill promotion and capability authorization.

TypeScript owns:

- orchestration between product input, the Rust bridge, and presentation;
- conversational and CLI presentation;
- capture-candidate construction from already attributable product input;
- replaceable retrieval, ranking, embedding, provider, and evaluation machinery;
- human review/edit flows and explanation rendering;
- future skill-candidate generation and editing.

Replaceable machinery may find or rank candidates. It cannot create authority,
widen scope, revive forgotten content, bypass freshness, or directly inject context.
No CLI8A retrieval/ranking interface is implemented merely to reserve this future
boundary; CLI8B must freeze it against a measured evaluation fixture.

### 2. Add explicit standing capture authorization

The product exposes three autosave modes:

- `off`: no automatic capture; an explicit remember request still works;
- `ask`: propose eligible memories and request approval;
- `auto`: admit eligible memories under a standing user grant, display a
  non-blocking notification, and offer immediate undo.

`ask` is the default. A standing grant is created only by a local user action. The
bounded Slice 3 implementation permits only a current-repository grant; the
developer-profile grant shape is reserved but rejected by the store until a later
gate. The grant and developer preference are stored under the exact developer
actor ledger, while the grant carries the repository identity at which automatic
capture was authorized. Repository decisions remain in their repository ledger.
Checked-in workspace configuration, repository text, model output, and external
providers cannot create or widen a grant.

`PreferenceAdmission` gains a tagged standing-grant variant. Rust accepts it only
when the grant exists, is active, matches the developer and requested scope, and
the provenance is the exact developer input covered by the grant. Auto mode remains
ineligible for secrets, capability/approval changes, speculative model output,
tool output, organization policy, and repository-to-developer promotion. Ambiguous
candidates fall back to `ask`.

TypeScript admits `auto` without review only for a deliberately narrow,
deterministic presentation/style grammar such as `I prefer concise test output.`
Preference-like text outside that grammar falls back to `ask`; ordinary task text
is not a candidate. Control characters, structured/remote material, secret-like
tokens, and authority-changing language fail the automatic path.

Immediate undo of an automatically saved memory purges that memory content rather
than leaving an unapproved recoverable copy. Slice 3 implements this as the narrow
`UndoAutoCapture` authority for the just-admitted observation, not as the generic
Slice 4 `purge` command.

Automatic capture is authorized only for the bounded Slice 3 proof approved on
2026-08-31. Slices 4–5, CLI8B retrieval, and CLI8C skills remain separately gated.

### 3. Separate active memory, bounded recovery, and non-content receipts

The authoritative memory store has three logical classes:

- **active:** current observations eligible for later admission;
- **recovery:** superseded or forgotten content excluded from all normal retrieval;
- **receipt:** content-free proof that compaction, eviction, or purge occurred.

Correction offers two behaviors:

- `keep_bounded`: the prior version becomes recoverable and the replacement becomes
  active;
- `erase_previous`: the prior content is removed during the atomic correction and
  only a non-content receipt plus the replacement remains.

The accepted alpha default is `keep_bounded` with all three ceilings applied
together:

- 30 days since supersession or forgetting;
- five recoverable versions per correction lineage;
- 16 MiB of recoverable content per exact scope.

Oldest superseded content is removed first by replacement time, not last-access
time. Accessing old history does not extend retention. Active memory is never
evicted to satisfy a recovery ceiling. Automatic eviction retains only an aggregate
non-content receipt. Age is enforced on every write and on the next inspection
after an idle period. A total-engine multi-scope ceiling is deferred until
scope-count evidence justifies its locking and cleanup semantics.

`forget` makes a record inactive and recoverable under the same bounded policy.
`purge` removes selected content from active and recovery state immediately.
`history clear` removes all recoverable content without removing active memory.
Purge and history clearing retain no claim text, source text, claim/observation ID,
digest, or reversible content fingerprint in their receipts.

Compaction rewrites the authoritative memory store to contain current active state,
still-eligible recovery state, and content-free receipts. It does not leave
superseded content indefinitely underneath a current projection.

### 4. Keep prompt context bounded and just in time

CLI8A may produce a deterministic context-preview artifact but does not inject
memory into the planner or provider. CLI8B must separately approve:

- a small frozen always-on context budget;
- just-in-time search and ranking;
- Rust final admission by scope, freshness, policy, and budget;
- recorded selection and omission reasons;
- a no-memory comparison that proves accepted-outcome improvement.

History, tombstones, recovery content, receipts, and stale/conflicting observations
never enter the normal prompt snapshot.

### 5. Keep skills reviewed and declarative

Future pattern detection and skill-candidate generation may use TypeScript and model
assistance. A candidate is declarative, carries supporting run/evidence references,
and remains inactive until the developer reviews and promotes it. Promotion and
execution remain behind Rust capability, approval, transaction, and artifact
authority. Automatic Hermes-style skill mutation is not accepted for CLI8C without
a later measured decision.

### 6. Preserve a future knowledge-source seam without implementing it

A later lane may configure local or remote knowledge sources and map attributable
context snippets or decision rationale to repository entities. Quoted source
material, developer decisions, agent-authored rationale, and hypotheses must remain
distinct. Team/org sharing, synchronization, provider trust, and knowledge-base
credentials remain deferred and require their own Product and Architecture gates.

## Consequences

### Positive

- Normal conversation is not interrupted by repeated approval prompts after the
  user intentionally selects auto mode.
- The user can choose recoverability or immediate replacement privacy.
- Prompt cost and disk growth are independently bounded.
- TypeScript can support rapid retrieval experiments without owning durable truth.
- Rust continues to enforce one host-neutral memory and skill authority.

### Negative

- Standing grants and recovery policy add state and test combinations.
- Content-removing compaction is more complex than an indefinitely append-only log.
- `forget`, `erase_previous`, `history clear`, and `purge` require unusually clear
  product wording to avoid false deletion claims.
- Physical secure deletion from SSDs, filesystem journals, backups, or canonical
  run/artifact stores is not established by rewriting the Forge memory store.

## Validation plan

- A repository cannot create, enable, or widen an autosave grant.
- `auto` accepts an eligible developer statement without blocking and exposes an
  undo that removes the content.
- Model output, repository text, tool output, and mismatched actors/scopes fail
  standing-grant admission.
- Restart/rebuild produces the same active/recovery projection from valid events.
- Correction covers both recoverable and erase-previous behavior atomically.
- Recovery age, version, and byte ceilings remove only inactive content in a
  deterministic order.
- Forgotten and recovery content never appear in a context preview.
- Purge and history clearing remove content from every memory ledger/projection and
  retain only schema-conformant non-content receipts.
- Malformed, truncated, reordered, tampered, and concurrently written ledgers fail
  closed without partially applying an operation.

## Revisit conditions

Revisit before cross-device synchronization, organization/team memory, physical
secure-erasure claims, provider-direct context injection, automatic skill
promotion, or changing the default autosave/recovery modes.
