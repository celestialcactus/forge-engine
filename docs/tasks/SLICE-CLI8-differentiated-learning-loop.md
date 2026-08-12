# Slice CLI8: Attributable memory and reviewed skill learning loop

**State:** Planned; begins after the clean-install trusted alpha gate
**Authority:** [ADR-0034](../decisions/ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md)
**Product objective:** demonstrate that Forge learns useful developer/workspace
knowledge and generalizable workflows without hiding instructions, compounding bad
assumptions, or bypassing the canonical runtime.

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

### 8A exit gate

- [ ] equivalent observations have deterministic identities;
- [ ] contradictory and superseding observations remain inspectable;
- [ ] workspace/repository/developer scopes cannot leak into one another;
- [ ] deletion/tombstone and correction survive restart;
- [ ] malicious repository text cannot silently become developer-level instruction;
- [ ] each projected record can be rebuilt from authoritative events/artifacts.

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
