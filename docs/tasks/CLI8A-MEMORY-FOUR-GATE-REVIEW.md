# CLI8A memory control: four-gate review packet

**Status:** Slices 0–2 accepted through PR #32 and
[Checkpoint 92](../decisions/checkpoints/2026-08-31-92-cli8a-memory-slice-0-2-hosted-gate.md);
Slice 3 implemented at candidate `afa6e67` with local gates passing; hosted/merge
acceptance pending; Slices 4–5 remain unapproved
**Date:** 2026-08-29
**Delivery path:** full
**Active task:** [Slice CLI8](SLICE-CLI8-differentiated-learning-loop.md)
**Architecture:** [ADR-0034](../decisions/ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md),
[ADR-0038](../decisions/ADRs/ADR-0038-cli8a-memory-identity-admission-and-retention.md),
[ADR-0039](../decisions/ADRs/ADR-0039-cli8a-hybrid-memory-capture-and-recovery.md)

This packet presented Product, Architecture, Program Design, and Vertical Slices
together for review. The approval ledger below is now authoritative: Slice 0 and
implementation Slices 1–3 are authorized, while Slices 4–5 remain gated.

## Approval ledger

| Gate | Status | Material | Approval |
| --- | --- | --- | --- |
| Product | approved | Gate 1 below | Approved 2026-08-29, including the outcome and explicit non-claims. |
| Architecture | approved for Slice 0–3 | Gate 2 below plus ADR-0034/0038/0039 | Rust remains authoritative; TypeScript owns orchestration, capture-candidate construction, UX, and replaceable retrieval machinery. |
| Program Design | approved for Slice 0–3 | Gate 3 below | Frozen standing-grant, bridge, eligibility, notification, and undo contracts apply. |
| Vertical Slices | partially approved | Gate 4 below | Contract prerequisite Slice 0 and implementation Slices 1–3 are authorized. Slice 3 was explicitly approved in the main implementation task on 2026-08-31; Slices 4–5 remain gated. |

## Gate 1: Product

### User and problem

The primary user is an individual developer using Forge in a local repository. The
developer repeatedly supplies architectural decisions, repository conventions,
domain knowledge, workflow preferences, and corrections. Existing harnesses either
lose that context or persist it with limited attribution and lifecycle control.

The developer should be the pilot, not the memory engine. They should not edit
storage files, manage internal IDs, understand indexes, or confirm every safe save.

### Approved outcome

CLI8A gives an individual developer an intuitive, user-controlled way to remember,
find, inspect, explain, correct, forget, restore, and purge attributable knowledge.
Forge owns storage and provenance mechanics. The first accepted slice proves the
complete lifecycle across restart without enabling automatic retrieval or prompt
injection.

CLI8 overall ultimately aims to reduce repeated explanations and improve accepted
task outcomes. CLI8A does not claim that benefit yet; CLI8B must prove it against a
no-memory baseline, and CLI8C separately evaluates reviewed skill reuse.

### Primary interaction

Conversation is the normal control surface:

```text
Developer: Remember that API contracts stay Rust-authoritative so every host sees
           the same validation behavior.

Forge: Remembered for this repository.  Undo · Explain
```

Commands are deterministic dashboard controls for discovery, accessibility,
automation, privacy, and recovery. Full internal IDs are never required for normal
use; ambiguous human selectors open a choice or fail without mutation.

Proposed commands:

```text
forge memory
forge memory remember <text>
forge memory find [query]
forge memory show <selection>
forge memory explain <selection>
forge memory correct <selection>
forge memory forget <selection>
forge memory restore <selection>
forge memory purge <selection>
forge memory history [list|clear|restore|purge]
forge memory autosave [off|ask|auto]
forge memory status
```

Every mutating command supports `--json` for automation. Destructive operations
require an interactive confirmation unless exact non-interactive confirmation is
provided. Human output uses source, scope, freshness, and effect language rather
than raw schema vocabulary.

### Capture modes

- `ask` is the default.
- `off` disables automatic capture while preserving explicit remember actions.
- `auto` is a standing local user authorization for eligible direct user input.
- Auto-save is non-blocking and displays `Remembered · Undo · Explain`.
- Undo of an auto-save removes its content rather than retaining it in recovery.
- Repository files/configuration cannot enable developer-wide or repository
  autosave on the user's behalf.
- Secrets, inferred personality, model/tool/repository instructions, capability
  escalation, and ambiguous candidates never auto-save.
- Slice 3 accepts only current-repository grants. They are stored in the exact
  developer ledger and bind automatic capture to the repository; developer-profile
  grants remain unavailable.
- Only the narrow deterministic presentation/style grammar is eligible without a
  pause. Other preference-like direct input falls back to `ask`; normal task input
  is ignored by capture orchestration.

### Correction, recovery, and deletion experience

Correction offers:

1. **Keep temporarily:** make the replacement active and retain the prior content
   in bounded recovery history;
2. **Erase previous:** make the replacement active and remove the prior memory
   content immediately.

The user may persist either choice as their future default. Recovery content is
never normally retrieved and is removed after the first of 30 days, five versions
per lineage, or the 16 MiB exact-scope recovery ceiling. Retention is enforced
eagerly on correction/restore and lazily on the next inspection after idle time.

`forget` stops future use and makes content temporarily recoverable. `purge`
removes selected content from active and recovery memory. `history clear` removes
all recoverable content without deleting current memories. Each command accurately
states that independently retained conversations, runs, artifacts, backups, and
filesystem media are not erased by a memory-store operation.

### Smallest end-to-end demonstration

1. Set autosave to `ask`, explicitly remember one repository decision, and receive
   a concise confirmation.
2. Restart Forge and find/show/explain the same decision with source and scope.
3. Correct it once while retaining recovery history; confirm only the replacement
   is active.
4. Restore, then correct again using erase-previous; confirm old content is absent.
5. Turn autosave to `auto`, state an eligible preference, observe non-blocking save,
   then undo and confirm the content is gone.
6. Forget and restore a record, then purge it and confirm only a non-content receipt
   remains.
7. Prove no forgotten, recovery, stale, cross-scope, or purged content appears in
   the deterministic context preview.

### Product success

- A new user completes the demonstration without editing storage or copying a full
  internal identifier.
- `ask` introduces a checkpoint only for a proposed save; `auto` does not block.
- Every active memory can answer what, source, scope, freshness, and why.
- Correction and deletion results match the words shown before confirmation.
- Active prompt/context cost is independent from recovery-history size.
- Storage is bounded without evicting current active memory.

### Non-goals and non-claims

- no automatic planner/provider injection or claimed quality improvement in CLI8A;
- no semantic claim identity, embedding-authoritative deduplication, or hidden
  personality inference;
- no team/org shared memory or cross-device synchronization;
- no custom knowledge-base implementation, credentials, or provider trust model;
- no automatic skill promotion or mutation;
- no claim that memory purge erases canonical runs/artifacts, backups, filesystem
  journals, or physical media;
- no public MCP memory-mutation surface in this packet.

### Deferred product direction

A later gate may add user-configured knowledge sources that preserve quoted source,
developer decision, agent rationale, and hypothesis as separate attributable
records, including mappings to repository paths, commits, symbols, and ADRs. Team
sharing remains a valuable future product candidate but is not latent CLI8A scope.

## Gate 2: Architecture

### Decision summary

| Decision | Proposed resolution |
| --- | --- |
| Runtime authority | Rust owns canonical identity, provenance, scope, lifecycle, durable store, recovery, purge, final context admission, and future skill promotion. |
| Fast-changing machinery | TypeScript owns UX, candidate construction, and later replaceable retrieval/ranking/embedding/provider/evaluation machinery. |
| Built-in memory influence | Borrow bounded context, frozen snapshots, on-demand history, atomic edits, progressive skill disclosure, and provider seams from Hermes; do not import provider authority or autonomous skill promotion. |
| Preference capture | `off`, `ask`, `auto`; `ask` default; `auto` requires a Rust-validated standing user grant bound to actor and scope. |
| Identity | Preserve separate deterministic claim and observation IDs under conservative `memory_text_v1`. |
| Scope | Preserve exact branch/repository/workspace/developer tagged scopes with no implicit widening. |
| Provenance/freshness | Preserve typed source evidence and evidence-driven freshness; model prose is never a verified fact. |
| Correction | New observation supersedes/corrects the old; the prior content is either bounded recovery or erased by explicit choice. |
| Forget | Inactive tombstone plus bounded recoverability; never normal retrieval. |
| Purge | Rewrite memory content away and rebuild projections; retain only a non-content receipt. |
| Storage growth | Compact authoritative memory so superseded content exists only while eligible for bounded recovery. |
| Context | CLI8A preview only; CLI8B freezes and evaluates bounded always-on plus just-in-time retrieval. |
| Skills | Declarative candidate, attributable evidence, developer review/promotion, Rust capability authority; CLI8C only. |
| Knowledge sources | Preserve a future adapter seam; defer implementation and trust/synchronization policy. |

### System flow

```text
Developer input / verified Forge evidence
                  │
                  ▼
TypeScript candidate construction and friendly scope proposal
                  │ exact attributable candidate
                  ▼
Rust admission: identity · actor/grant · scope · provenance · freshness
                  │ durable append before acknowledgement
                  ▼
Rust memory store ──────► rebuildable active/recovery projection
                  │
                  ├──────► TypeScript CLI explanation
                  │
                  └──────► deterministic context preview (CLI8A only)

CLI8B later:
TypeScript/provider retrieval and ranking
                  │ candidate IDs + scores/reasons
                  ▼
Rust final admission and bounded context artifact
```

### State boundary

Memory state lives beneath the compiled `engine.root`, never inside the governed
repository by default:

```text
<engineRoot>/memory/v1/
  grants/                   # user-created standing capture grants
  scopes/<scopeDigest>/
    ledger.ndjson           # authoritative hash-linked frames
    projection.json         # disposable, head-bound active/recovery view
    lock                    # exclusive writer/compactor lock
```

Untrusted scope identifiers never become path components; canonical scope material
is hashed to select the directory. User/workspace content cannot choose
`engine.root`. Every open revalidates containment and rejects links, unexpected
entries, sequence gaps, hash/identity mismatches, invalid UTF-8, oversized frames,
and partial terminal frames.

Append syncs the frame before acknowledging success. Projection writes are atomic
and may be discarded/rebuilt. Purge and compaction hold the writer lock, write and
sync a complete replacement ledger, atomically replace it, and rebuild the
projection. Forge promises logical removal from the memory store, not physical
secure erasure from storage media.

### Least-confident architecture decisions

1. The accepted 30-day/five-version/16-MiB exact-scope recovery defaults are
   conservative alpha safety budgets, not evidence-backed capacity promises. The
   acceptance fixture must measure them and the checkpoint must record any
   adjustment. A future multi-scope total-engine budget remains an explicit design
   question rather than an unenforced claim.
2. A single lock per scope gives the cleanest first correctness boundary. Multi-
   process throughput is deliberately secondary; bounded lock contention and stale
   owner recovery still require tests.
3. CLI8A uses a JSON projection to avoid selecting SQLite before query evidence.
   CLI8B may replace it with SQLite/FTS/vector/graph projections without migrating
   authoritative events.
4. Automatic semantic classification remains fallible. `auto` is therefore limited
   to exact user-input provenance, visible notification, immediate content-removing
   undo, and no developer-scope inference from repository/model/tool text.

### Required ADR action

This gate accepted ADR-0039 as an amendment to ADR-0038. ADR-0038
remains authoritative for identity, scope, provenance, and freshness; its rejected
“immediate preference persistence” alternative is narrowed by an explicitly
user-created standing grant rather than silently reversed.

## Gate 3: Program Design

### Proposed file-tree diff

```text
crates/forge-core/src/
  memory.rs                         # existing public facade and Package 1 contracts
  memory/lifecycle.rs               # events, operations, state transitions
  memory/store.rs                   # bounded durable append/open/rewrite/locking
  memory/projection.rs              # deterministic active/recovery rebuild
  memory/retention.rs               # ceilings, compaction, non-content receipts
  memory/grants.rs                  # off/ask/auto standing authorization

crates/forge-core/tests/
  memory_contract.rs                # existing Package 1 tests
  memory_lifecycle.rs               # transition and projection matrix
  memory_store.rs                   # restart/tamper/crash/concurrency corpus
  memory_retention.rs               # age/version/byte/clear/purge corpus

crates/forge-core/tests/fixtures/cli8/
  memory-policy-v1.json             # existing frozen Package 1 fixture
  memory-lifecycle-v1.ndjson        # positive append/rebuild golden
  memory-adversarial-v1.json        # invalid/tamper/boundary cases
  memory-control-v1.json            # bridge request/result goldens

crates/forge-kernel/src/
  memory_bridge.rs                  # one bounded request/result dispatcher
  protocol.rs                       # forge.kernel.memory.v1 discriminator/limit
  main.rs                           # dispatch only; integration-owner file

src/memory/
  contracts.ts                      # decoded public bridge/result shapes
  runtime.ts                        # exact Rust child-process adapter
  commands.ts                       # conversational/CLI operation mapping
  presentation.ts                   # human/JSON rendering and selectors

src/cli.ts                          # command registration only; integration owner

tests/
  memory-commands.test.ts           # kernel-free UX over fake runtime
  memory-cli.test.ts                # source-built Rust-backed CLI lifecycle
  hybrid/memory-product.hybrid.ts   # restart, tamper, parity, no-secret corpus
```

No retrieval/ranker, embedding, database-provider, skill runtime, MCP mutation, or
planner/context-injection file is added in CLI8A.

### Rust contracts

The existing `MemoryObservation` contract remains the content authority. Proposed
additions are shape-level; method bodies remain implementation work:

Slice 0 also closes one contradiction found during contract review: the approved
tracer remembers a developer-stated repository decision, while the Package 1
contract allowed developer statements only as developer-scoped preferences. Add
`reviewed_decision` as a distinct statement kind. It requires exact developer
provenance plus explicit remember or reviewed acceptance, applies only to branch,
repository, or workspace scope, persists until reviewed, and cannot be authored by
repository text, model output, or an automatic standing grant.

```rust
pub enum MemoryCaptureMode { Off, Ask, Auto }

pub enum PreferenceAdmission {
    ExplicitRemember,
    ReviewedAcceptance,
    StandingGrant { grant_id: MemoryGrantId },
}

pub struct MemoryStandingGrant {
    pub grant_id: MemoryGrantId,
    pub actor_id: String,
    pub scope: MemoryGrantScope,
    pub mode: MemoryCaptureMode,
    pub created_at_millis: i64,
    pub revoked_at_millis: Option<i64>,
}

pub enum MemoryCorrectionDisposition { KeepBounded, ErasePrevious }

pub enum MemoryOperation {
    Remember { observation: MemoryObservation },
    Correct {
        target: MemoryObservationId,
        replacement: MemoryObservation,
        disposition: MemoryCorrectionDisposition,
    },
    Forget { target: MemoryObservationId, reason: MemoryReasonCode },
    Restore { target: MemoryObservationId },
    AutoCapture {
        observation: MemoryObservation,
        grant_id: MemoryGrantId,
        grant_scope: MemoryGrantScope,
    },
    UndoAutoCapture {
        target: MemoryObservationId,
        grant_id: MemoryGrantId,
        actor_id: String,
    },
    Purge { selector: MemoryPurgeSelector, reason: MemoryReasonCode },
    ClearRecovery { scope: Option<MemoryScopeKind> },
    SetCaptureMode { grant: MemoryStandingGrant },
    RevokeGrant { grant_id: MemoryGrantId },
}

pub struct MemoryLedgerFrame {
    pub schema_version: u8,
    pub sequence: u64,
    pub previous_frame_sha256: Option<String>,
    pub frame_sha256: String,
    pub event: MemoryEvent,
}

pub enum MemoryEvent {
    ObservationAdmitted { observation: MemoryObservation },
    ObservationForgotten { target: MemoryObservationId, reason: MemoryReasonCode },
    ObservationRestored { target: MemoryObservationId },
    GrantChanged { grant: MemoryStandingGrant },
    ObservationAutoCaptured {
        observation: MemoryObservation,
        grant_id: MemoryGrantId,
        grant_scope: MemoryGrantScope,
    },
    AutoCaptureUndone {
        target: MemoryObservationId,
        grant_id: MemoryGrantId,
        actor_id: String,
    },
    NonContentReceipt { receipt: MemoryNonContentReceipt },
}

pub struct MemoryProjection {
    pub schema_version: u8,
    pub ledger_head_sha256: String,
    pub active: Vec<ProjectedMemory>,
    pub recovery: Vec<RecoveryMemory>,
    pub receipts: Vec<MemoryNonContentReceipt>,
    pub grants: Vec<MemoryStandingGrant>,
}

pub struct MemoryStoreLimits {
    pub maximum_frame_bytes: u64,       // 64 KiB
    pub compaction_trigger_bytes: u64,  // 48 MiB per scope
    pub maximum_ledger_bytes: u64,      // 64 MiB hard ceiling per scope
    pub maximum_active_records: u32,    // 4,096 per scope
    pub recovery_retention_millis: u64, // 30 days
    pub recovery_versions_per_lineage: u8, // 5
    pub maximum_recovery_bytes: u64,    // 16 MiB per exact scope
}

impl MemoryStore {
    pub fn open(root: &Path, scope: MemoryScope, limits: MemoryStoreLimits) -> Result<Self, MemoryStoreError>;
    pub fn apply(&mut self, operation: MemoryOperation) -> Result<MemoryOperationResult, MemoryStoreError>;
    pub fn inspect(&self, include_recovery: bool) -> MemoryInspection;
    pub fn rebuild(&mut self) -> Result<MemoryProjection, MemoryStoreError>;
    pub fn compact(&mut self, as_of_millis: i64) -> Result<MemoryCompactionResult, MemoryStoreError>;
}
```

These values are alpha safety budgets, not capacity promises. The 48-MiB trigger
provides rewrite headroom before the 64-MiB hard ceiling. A checkpoint may lower or
raise them from measured fixture evidence without reopening the authority model;
silent truncation or eviction of active memory is never permitted.

The exact JSON fixture freezes tagged enum spelling, error codes, bounds, ordering,
and receipt fields before parallel implementation begins.

### Bridge contract

The kernel adds one bounded NDJSON request/result protocol:

```text
protocolVersion: forge.kernel.memory.v1
maximum request frame: 256 KiB
one request → one result or protocol.error
```

Requests carry an exact operation plus compiled engine root and actor/workspace/
repository identity supplied by the trusted product boundary. Responses return
redacted operation results and human-renderable facts; they never return hidden
recovery content unless the explicit operation is history inspection/restore.

The TypeScript runtime validates protocol version, request ID, frame size, terminal
result count, kernel exit, and secret-safe stderr exactly as existing Rust adapters
do. There is no fallback to a TypeScript memory authority.

### Principal call stacks

Explicit remember:

```text
conversation or `forge memory remember`
→ TypeScript candidate construction and friendly scope proposal
→ Rust bridge Remember
→ validate observation/admission/scope
→ lock scope → append+sync frame → rebuild/update projection
→ return admitted summary
→ TypeScript prints `Remembered · Explain`
```

Auto capture:

```text
exact developer input
→ TypeScript eligible candidate proposal
→ Rust validates active standing grant + actor + exact scope + provenance
→ append before acknowledgement
→ non-blocking notification
→ Undo sends narrow UndoAutoCapture for the just-admitted content
→ Rust atomically rewrites that content away and retains a non-content receipt
```

Correction with recovery:

```text
resolve exact target without ambiguity
→ validate replacement and Supersedes/Corrects relation
→ append replacement
→ projection moves prior version to bounded recovery
→ compact if any ceiling is crossed
→ return old/new human summary
```

Correction with erase-previous or purge:

```text
exclusive lock
→ validate complete original ledger/projection
→ construct replacement ledger with target content removed
→ append replacement and/or non-content receipt
→ sync temporary ledger → atomic replace → sync parent
→ rebuild projection → acknowledge
```

Restart/open:

```text
open exact engine-root memory path
→ reject links/unexpected entries/oversize/partial frames
→ verify frame chain, identities, transitions, and bounds
→ accept projection only if its head matches; otherwise rebuild
```

### Errors and deterministic behavior

Errors use stable codes and actionable, secret-safe messages. Required families:

- `memory_admission_*`: missing/mismatched/revoked grant, ineligible source;
- `memory_scope_*`: mismatch, widening, unavailable repository identity;
- `memory_selector_*`: absent or ambiguous human selection;
- `memory_transition_*`: invalid correction, restore, forget, or duplicate terminal state;
- `memory_store_*`: containment, link, lock, capacity, I/O, partial frame;
- `memory_integrity_*`: sequence, hash, identity, projection-head, or UTF-8 failure;
- `memory_recovery_*`: expired, evicted, missing, or over limit;
- `memory_purge_*`: invalid selector or atomic rewrite failure.

Ordering is canonical by scope kind/material, then subject kind, normalized subject,
claim ID, observation time, and observation ID. Time is always an injected integer
for tests; no identity or rebuild behavior reads the wall clock implicitly.

Cancellation before the durable append returns no success. Cancellation after a
synced append returns an attributable “committed; presentation interrupted” result
on inspection rather than attempting a duplicate append. Purge/compaction never
publishes a partially rewritten ledger.

### Test matrix and commands

The minimum matrix covers:

- positive golden replay and byte-identical rebuild;
- repeated observation/idempotency and deterministic ordering;
- `off`/`ask`/`auto`, grant revoke, actor/scope mismatch, poisoned sources;
- correction keep/erase, forget/restore, purge, history clear;
- recovery age/version/byte ordering and active-memory immunity;
- restart after every lifecycle transition;
- truncated, malformed, reordered, hash-mismatched, identity-mismatched, symlinked,
  oversized, and unexpected files;
- two writers, stale lock recovery, cancellation before/after sync;
- source-built human/JSON command parity and no full-ID requirement;
- no recovery/forgotten/purged content in context preview or normal inspection;
- Windows/macOS/Ubuntu path and atomic-replace behavior;
- no secret bytes in ledger, projection, stdout, stderr, or fixtures.

Exact validation packet:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test -p forge-core --test memory_contract --locked
cargo test -p forge-core --test memory_lifecycle --locked
cargo test -p forge-core --test memory_store --locked
cargo test -p forge-core --test memory_retention --locked
npm run typecheck
npm test
npm run test:hybrid
npm run check:product
npm run repo:authority
git diff --check
```

The hosted gate must cover Windows x64, macOS ARM64/x64, and Ubuntu x64 on the exact
candidate. CLI8A acceptance records counts, OS/arch, exact kernel, state root,
storage ceilings, compaction results, and retained non-claims.

### Local candidate evidence

Implementation `6f37c8c` passed the independent Windows/VS Code local gate on
2026-08-31. The clean exact-commit worktree used Rust 1.97.1, Visual Studio Build
Tools 2022 17.14.37614.0, MSVC 14.44.35207, and Windows SDK 10.0.26100.0. The
four focused memory binaries passed 16/16 tests, `npm run check` passed 154/154,
the source kernel built and probed as `source-debug`, and the focused real-CLI
hybrid passed 1/1.

The product run used 15 separate CLI processes to prove remember across restart,
find/show/explain without a full internal ID, bounded correction/history, restore,
and final `--erase-previous`. It retained one active version, removed erased prior
content from all Forge memory-state files, emitted empty stderr, performed no
planner/provider/retrieval/discovery/network work, and reported retrieval inactive.
Temporary validation state was removed. Slice 3 was later authorized on 2026-08-31
and is now implemented at local-gated candidate `afa6e67`; Slices 4–5 remain open.

The authoritative worktree follow-up also passed `npm run check:product` under the
supported MSVC environment (191 Rust tests passed with 16 explicit ignored helper/
external-corpus cases, 154 Node tests, 59/66 hybrid with seven explicit skips, and
source product smoke). RustSec scanned 46 locked dependencies without findings; the
clean-install/update/uninstall package lifecycle, native-package archive, and
20-sample benchmark passed with a 90.757-ms Rust bridge p95.

Exact candidate `e9e8cd9` then passed the declared Windows x64, macOS ARM64,
macOS x64, and Ubuntu x64 hosted matrix in cross-platform run `33433043538` and
hybrid run `33433043562`. The
hosted gate found and corrected a platform-native kernel-name fixture, an existing
10-ms snapshot race, and a concurrent temporary-root collision before acceptance.
An external GitHub artifact-upload DNS failure separated two diagnostic attempts.
Checkpoint 92 records the full evidence and retained non-claims.

### Ownership and parallel safety

Before the tracer slice, one integration owner freezes:

- ADR-0039 and this packet;
- Rust/JSON tagged contracts and error codes;
- memory protocol fixture;
- module ownership and limits.

After that freeze:

| Workstream | Exclusive files | May run with |
| --- | --- | --- |
| Rust store/projection | `memory/store.rs`, `memory/projection.rs`, store tests | TypeScript UX; grants after shared types freeze |
| Rust grants/capture | `memory/grants.rs`, grant tests | Store/projection; TypeScript UX |
| Rust recovery/privacy | `memory/retention.rs`, recovery tests | TypeScript UX; begins after store rewrite interface freezes |
| TypeScript UX/runtime | `src/memory/*`, Node unit tests | All Rust workstreams after protocol fixture freeze |
| Integration | `memory.rs`, kernel `main.rs`/`protocol.rs`, `src/cli.ts`, hybrid fixture, shared docs | Serial integration owner only |

No parallel owner edits the facade, kernel dispatcher, CLI dispatcher, shared
fixtures, ADR, or gate ledger. A shared-contract change pauses dependents and
reopens Program Design rather than being merged opportunistically.

## Gate 4: Vertical slices

The former “build storage, then add commands” sequence is replaced by touchable
end-to-end increments.

### Slice 0: Contract amendment and fixture freeze

**Proof:** Proposed ADR-0039, typed shapes, errors, limits, JSON/NDJSON goldens, and
exclusive ownership agree before lifecycle code.

**Includes:** `StandingGrant`, correction disposition, recovery policy, ledger
frame, non-content receipt, protocol request/result fixtures.

**Excludes:** durable operations, CLI behavior, retrieval, skills.

**Gate:** contract tests deserialize every positive/negative fixture; no runtime
activation. This slice is sequential and blocks all later implementation.

### Slice 1: Explicit remember → restart → show/explain tracer

**User proof:** The developer remembers one repository decision, restarts Forge,
and sees what it is, where it applies, where it came from, and why it is current.

**Traverses:** TypeScript CLI → Rust bridge → durable ledger → restart/rebuild →
projection → human/JSON presentation.

**Gate:** no storage editing or full ID; append-before-success; tamper and partial
frame fail closed; no planner/provider/MCP activation.

This is the first implementation packet and is intentionally serial at its final
integration seam.

### Slice 2: Correct → bounded recovery → restore or erase previous

**User proof:** Correct a tracer memory, choose keep or erase, inspect recovery,
restore once, and prove only one version is active.

**Gate:** 30-day/five-version/16-MiB ceilings are deterministic; active memory is
never evicted; erase-previous leaves no prior content in the memory store; restart
preserves the result.

May develop in parallel with Slice 3 after Slice 1 freezes the bridge/store seam;
the integration owner merges them serially.

### Slice 3: Autosave off/ask/auto with non-blocking undo

**User proof:** Enable repo-scoped auto mode, state an eligible preference, continue
without an approval pause, observe the save, and undo it. Disable autosave without
editing configuration.

**Gate:** only local user action creates the standing grant; unsafe/ambiguous
sources fall back to ask or fail; repository/model/tool text cannot self-authorize;
undo removes content; CLI and conversational behavior use the same Rust grant.

**Implemented candidate:** `afa6e67`. The local Windows x64 product gate passes
195 Rust tests with 16 explicit helper/external-corpus ignores, 159 Node tests,
the real configured interactive no-pause/explain/undo fixture, the two-case memory
product fixture, RustSec audit, clean-install ask/auto/off lifecycle, native packing,
and the 20-sample benchmark assertion. Hosted target and merge acceptance remain
open; this evidence does not authorize Slice 4 or 5.

May develop in parallel with Slice 2 after the shared contract freeze.

### Slice 4: Forget, restore, purge, and history clear

**User proof:** Forget and restore a memory, purge it, and separately clear recovery
history while retaining active memories.

**Gate:** forgotten/recovery content is never normally returned; purge/clear atomic
rewrite survives restart and failure injection; receipts contain no content,
identifiers, or reversible fingerprints; output names independent run/artifact
retention.

Depends on Slice 2 recovery and compaction behavior.

### Slice 5: Bounded context preview and CLI8A acceptance

**User proof:** Preview the exact memory context that would be eligible for a task
and see inclusion/omission reasons without sending it to a model.

**Gate:** bounded deterministic output contains active, fresh, exact-scope records
only; recovery, forgotten, stale, conflicting, cross-scope, hypothesis, and purged
content are absent or explicitly reported as omitted; no provider/network work.

Run the complete local and hosted matrix, update the checkpoint/build plan/current
index, and retain the no-retrieval/no-skill claims. CLI8B begins only after this
exact candidate is accepted.

### Parallelization graph

```text
Slice 0 contract freeze
          │
          ▼
Slice 1 end-to-end tracer
          │
          ├──────────────┐
          ▼              ▼
Slice 2 recovery     Slice 3 autosave
          │              │
          └──────┬───────┘
                 ▼
        Slice 4 privacy lifecycle
                 │
                 ▼
        Slice 5 preview + hosted gate
```

The authorized packet is **Slice 0 through Slice 3**. Slice 0 is the required
contract freeze, Slice 1 proves the tracer seam, Slice 2 proves recovery, and Slice
3 proves standing-grant autosave plus undo. Slices 4–5 remain unapproved.

## Decisions requested from the reviewer

Approval of this packet means all of the following:

1. approve the Gate 1 user/outcome/non-claim boundary;
2. accept ADR-0039 and the Rust-authority/TypeScript-orchestration split;
3. accept `ask` default plus locally granted `off`/`auto` behavior;
4. accept correction with bounded recovery or erase-previous choice;
5. provisionally accept the recovery/store safety budgets, subject only to measured
   adjustment recorded at the checkpoint;
6. approve the Gate 3 contracts, module ownership, error/test plan, and no-retrieval
   boundary;
7. approve the six-slice graph (one contract slice plus five product slices);
8. authorize implementation of prerequisite Slice 0 and implementation Slices 1–2
   initially; later slice authorization remains explicit.

The reviewer approved decisions 1–8 on 2026-08-29 for Slice 0–2 and explicitly
approved Slice 3 on 2026-08-31 after restatement of its Product, Architecture,
Program Design, and Vertical Slice boundary. Slices 4–5 and CLI8B/C remain gated.
