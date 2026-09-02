# Slice CLI8: Attributable memory and reviewed skill learning loop

**State:** Slices 0–2 accepted through PR #32 and
[Checkpoint 92](../decisions/checkpoints/2026-08-31-92-cli8a-memory-slice-0-2-hosted-gate.md);
Slice 3 accepted through PR #33 implementation candidate `26f011e` and
[Checkpoint 93](../decisions/checkpoints/2026-09-01-93-cli8a-memory-slice-3-hosted-gate.md);
Slice 4 explicitly authorized on 2026-09-02; Slice 5 gated
**Authority:**
[ADR-0034](../decisions/ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md),
[ADR-0038](../decisions/ADRs/ADR-0038-cli8a-memory-identity-admission-and-retention.md),
[ADR-0039](../decisions/ADRs/ADR-0039-cli8a-hybrid-memory-capture-and-recovery.md)
**Product objective:** demonstrate that Forge learns useful developer/workspace
knowledge and generalizable workflows without hiding instructions, compounding bad
assumptions, or bypassing the canonical runtime.

## Four-gate delivery status

**Delivery path:** full

This lane began before the
[four-gate delivery workflow](../development/four-gate-delivery-workflow.md) was
adopted. Package 1 is preserved as completed candidate work. Package 2 and later
were superseded by the approved vertical packet. Prerequisite Slice 0 and
implementation Slices 1–4 are currently authorized.

| Gate | Status | Revision/material | Approval note |
| --- | --- | --- | --- |
| Product | approved | [Combined CLI8A review packet](CLI8A-MEMORY-FOUR-GATE-REVIEW.md), Gate 1 | Outcome and explicit non-claims approved 2026-08-29. |
| Architecture | approved for Slice 0–4 | ADR-0034, ADR-0038, [ADR-0039](../decisions/ADRs/ADR-0039-cli8a-hybrid-memory-capture-and-recovery.md), review packet Gate 2 | Rust authority with TypeScript orchestration, UX, and replaceable retrieval machinery accepted. Slice 4 reuses the frozen ledger, lifecycle, recovery, and atomic rewrite boundary. |
| Program Design | approved for Slice 0–4 | Review packet Gate 3 | The existing forget/restore, purge, history-clear, error, atomicity, retention, and test contracts are approved for Slice 4. |
| Vertical Slices | partially approved | Review packet Gate 4 | Prerequisite Slice 0 and implementation Slices 1–4 authorized; Slice 5 remains gated. Slice 3 was approved on 2026-08-31 and Slice 4 on 2026-09-02. |

Slice 0 and implementation Slices 1–2 are accepted through PR #32. Exact MSVC,
separate VS Code product-lifecycle, focused Rust, Node, hybrid, package, benchmark,
and hosted target validation pass through exact implementation candidate `e9e8cd9`.
Slice 3 autosave is accepted through PR #33 candidate `26f011e` after exact local,
hosted, real PTY, and live VS Code gates. Slice 4 privacy lifecycle is the
authorized active implementation lane. Slice 5 context preview, retrieval, and
skills remain gated.

Current local evidence:

- a clean VS Code worktree at exact implementation `6f37c8c` used Rust 1.97.1,
  Visual Studio Build Tools 2022 17.14.37614.0, MSVC 14.44.35207, and Windows SDK
  10.0.26100.0;
- the four focused MSVC memory test binaries pass 16/16 tests and the source kernel
  builds and probes as `target/debug/forge-kernel.exe` (`source-debug`);
- `npm run check` passes 154/154 tests plus typecheck/build with empty stderr;
- the real source CLI passes remember/restart/find/show/explain, bounded correction,
  history, restore, and erase-previous across 15 separate processes without a full
  internal ID; one active version remains and erased content is absent from all
  Forge memory-state files;
- the focused source CLI hybrid passes 1/1, and the retained hybrid suite passes 59
  scenarios with seven existing explicit separate-kernel skips;
- the lifecycle creates no planner/provider/retrieval/discovery/network activity,
  and `explain`/`status` truthfully report retrieval inactive;
- the authoritative worktree then passes `npm run check:product` under the supported
  MSVC environment (191 Rust tests passed/16 explicit ignored, 154 Node tests, 59/66
  hybrid with seven explicit skips, and source product smoke), `npm run rust:audit`
  over 46 locked dependencies, the clean-install/update/uninstall release smoke,
  native-package packing, and the 20-sample benchmark (Rust bridge p95 90.757 ms).
- exact candidate `e9e8cd9` passes hosted Node and hybrid/native/package/benchmark
  gates on Windows x64, macOS ARM64, macOS x64, and Ubuntu x64 in runs
  `33433043538` and `33433043562`; Checkpoint 92 records the platform-name,
  timeout-snapshot, and concurrent-retention-root test-fixture corrections plus the
  external GitHub artifact-upload DNS failure that separated the final attempts.
- Slice 3 implementation `afa6e67`, with final implementation candidate `26f011e`, adds exact developer-ledger standing grants bound to
  the current repository, `ask` default and local `off|ask|auto` controls, narrow
  deterministic direct-preference eligibility, cross-process find/explain, and
  narrow immediate undo with no recovery copy. Local Windows x64 gates pass 195
  Rust tests (16 ignored helpers/external corpora), 162 Node tests, both real memory
  product cases, owned TTY editing plus queued non-TTY regressions, configured
  interactive no-pause/explain/undo, package lifecycle,
  RustSec audit, native packing, the 20-sample benchmark assertion, and a deterministic
  protocol-stream close regression. Cross-platform runs `33449198939` and
  `33449198943` pass all nine declared hosted jobs. A real VS Code integrated-terminal
  pilot on exact `26f011e` confirms Backspace editing, `/help`, and `/exit`.
  Checkpoint 93 accepts this boundary for merge without authorizing Slice 4 or 5.

## Boundary

This slice is deliberately one end-to-end learning loop, not a general memory
platform. It must reuse canonical run events, evidence, capabilities, policy,
ChangeSet transactions, verification, and artifacts. The append-oriented evidence
record remains authoritative; search, graph, vector, and relational structures are
replaceable projections selected from measured query needs, not new sources of truth.

Sandbox provider work proceeds separately. `trusted` remains an honest no-containment
posture and does not prevent this slice from being evaluated.

## 8A: Memory observation contract

- define typed observation subjects: workspace architecture, repository convention,
  domain fact, developer preference, workflow step, and negative/correction;
- require source run/evidence references, scope, confidence, observed time, freshness,
  and supersession/tombstone state;
- distinguish quoted facts, inferred hypotheses, preferences, and workflow patterns;
- expose inspect, correct, delete, and explain operations through the CLI;
- never treat model prose alone as verified workspace fact.

### 8A policy lock

The four previously open choices are settled for the bounded foundation:

- `memory_text_v1` normalizes line endings and outer ASCII whitespace only;
  semantic paraphrases, case changes, punctuation changes, internal whitespace,
  paths, identifiers, and Unicode differences remain distinct;
- durable developer preferences require an explicit remember action or reviewed
  acceptance; incidental conversation, repository text, and model inference cannot
  promote a developer preference;
- ordinary deletion appends a tombstone, while an explicit privacy purge rewrites
  memory content and retains only a non-content receipt; run/artifact retention is
  separate and must not be implied;
- freshness is evidence-driven: hypotheses are run-bounded, verified workspace and
  repository claims are bound to source fingerprints, admitted preferences persist
  until reviewed/removed, and naturally expiring facts use explicit validity time.

Claims and observations have separate deterministic IDs. Scope is one exact tagged
variant (`branch`, `repository`, `workspace`, or `developer`), never a set of
optional wildcard fields. Organization scope remains deferred.

### 8A superseded package sequence

The list below records the pre-four-gate package shape. It is superseded for future
implementation by the end-to-end vertical slices in the
[combined review packet](CLI8A-MEMORY-FOUR-GATE-REVIEW.md) and must not be used as
implementation authority.

1. **Contract and golden fixtures**
   - Rust types for claim/observation identity, statement/subject kinds, exact
     scopes, provenance, relations, admission, and freshness;
   - frozen positive and negative JSON fixtures with deterministic IDs;
   - no change to canonical `RunEvent`, `RunArtifact`, bridge protocol, CLI, MCP,
     planner, or context compiler.
2. **Append/rebuild lifecycle**
   - bounded append ledger and deterministic projection;
   - correction, contradiction, tombstone, restoration, and explicit privacy purge;
   - restart/rebuild and tamper rejection tests.
3. **Explicit product operations**
   - `memory inspect`, `explain`, `correct`, `forget`, and `purge` only after their
     event/artifact and storage authority is reviewed;
   - no automatic retrieval and no planner/context injection.
4. **CLI8A acceptance gate**
   - full Rust/Node/hybrid regression on the exact candidate;
   - checkpoint the accepted observation/replay boundary and retained non-claims.

Current package status:

- [x] policy lock in ADR-0038;
- [x] Package 1 typed contract, validation, separate deterministic identities, and
      frozen positive/negative policy fixture;
- [x] authorized Slice 1 append/rebuild plus explicit remember/find/show/explain;
- [x] authorized Slice 2 correction, bounded recovery, restoration, and
      erase-previous rewrite;
- [x] authorized Slice 3 accepted through PR #33 and Checkpoint 93;
- [ ] authorized Slice 4 forget/restore/purge/history-clear implementation and
      exact-candidate acceptance;
- [ ] unapproved Slice 5 context preview and complete CLI8A acceptance;
- [x] exact-candidate local MSVC and separate VS Code product-lifecycle gate;
- [x] exact-candidate hosted acceptance through PRs #32–33 and Checkpoints 92–93.

The stale-base candidate `b5effea` may be used as a reference for bounded limits,
append/rebuild mechanics, and adversarial tests. It must not be cherry-picked or
replayed verbatim because it collapses claim/observation identity and leaves the
locked policy choices unresolved.

### 8A exit gate

- [x] normalization, preference admission, deletion/purge, freshness, and exact
      scope policies are locked by ADR-0038;
- [x] equivalent observations have deterministic claim and observation identities;
- [x] corrected and superseded observations remain inspectable in explicit recovery;
- [x] exact scope is bound into identity, storage path, bridge validation, and tests;
- [x] authorized correction/recovery survives restart; forget/tombstone is now the
      bounded Slice 4 implementation lane;
- [x] malicious repository text cannot silently become developer-level instruction;
- [x] each implemented projected record rebuilds from the hash-linked NDJSON ledger.

## 8B: Contextual retrieval and evaluation

- compile bounded context from current evidence plus relevant candidate memory;
- record selection, omission, provenance, freshness, and budget reasons;
- use structural parsers/search/symbol evidence before model summarization where they
  answer the query more faithfully;
- compare no-memory, retrieved-memory, and deliberately lossy variants;
- score accepted outcome, evidence recall, corrective turns, end-to-end tokens/cost,
  latency, and unsupported claims.

### 8B exit gate

- [ ] relevant domain/architecture knowledge is retrieved on held-out tasks;
- [ ] stale, irrelevant, conflicting, cross-scope, and poisoned memories are rejected
      or explicitly surfaced;
- [ ] the retrieved condition improves accepted outcome quality or effort over the
      no-memory baseline;
- [ ] token savings that increase corrective turns or total task cost fail the gate;
- [ ] a developer can inspect why each memory was selected or omitted.

## 8C: Pattern-to-skill candidate

- detect repeated capability/workflow structure from multiple attributable runs;
- separate invariant steps from repository-specific parameters and incidental model
  behavior;
- generate a bounded skill candidate with triggers, inputs, steps, required
  capabilities, verification, scope, supporting runs, and known limits;
- require explicit developer edit/accept/reject before promotion;
- version, retire, and roll back promoted skills;
- execute promoted skills only through existing capability and policy contracts.

### 8C exit gate

- [ ] a repeated fixture produces one understandable candidate rather than several
      fragmented pseudo-skills;
- [ ] a single run or unverified failure cannot independently create a promoted skill;
- [ ] promotion, edit, rejection, retirement, selection, and execution are canonical
      events;
- [ ] the promoted skill improves a held-out repetition without reducing accepted
      outcome quality or increasing corrective turns;
- [ ] unsupported triggers or stale dependencies cause omission or review, not silent
      execution.

## Demonstration fixture

Use a small multi-run repository/domain fixture:

1. the developer explains one non-obvious architectural convention;
2. Forge verifies and stores the appropriately scoped observation;
3. later work retrieves it and avoids a plausible but incorrect implementation;
4. three related accepted workflows expose a repeated sequence;
5. Forge proposes a parameterized skill with exact supporting evidence;
6. the developer edits and promotes it;
7. a held-out fourth task uses the skill and is compared with a no-memory/no-skill
   baseline.

The demonstration must report quality, evidence coverage, tool calls, corrective
turns, total input/output tokens, latency, memory selections, and skill provenance.

## Explicitly deferred

- autonomous unreviewed skill activation;
- opaque personality or productivity scoring;
- organization-wide sharing or policy distribution;
- a mandatory graph/vector database;
- background agents, generalized automation, connectors, and Project Sybil workers;
- automatic lossy compression without a task-quality evaluation gate.
