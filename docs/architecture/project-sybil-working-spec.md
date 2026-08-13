# Project Sybil working specification

**Status:** exploratory working-name specification; not ForgeEngine V1 authority
**Date:** 2026-08-03
**Last researched:** 2026-08-13

## Purpose

Project Sybil is a possible future generalized sovereign worker platform built on
stable Forge contracts. Forge V1 remains the developer software-evidence CLI and
harness. Sybil must not begin by forking Forge's runtime, policy, evidence, or
capability semantics.

The [Grok Bot pattern review](../audit/2026-08-13-grok-bot-sybil-pattern-review.md)
adds a competitive checkpoint for persistent workers, teach-by-demonstration,
asynchronous routines, cross-surface continuity, and coordinated specialists. It
validates the product direction but does not authorize those features inside Forge
V1 or make Grok Bot's unpublished implementation an architectural authority.

## Proposed operating model

Sybil presents one coherent user-facing mind while distributing work across typed
roles:

- an executive tier owns goals, budgets, and final commitments;
- a planning tier decomposes work and records dependencies;
- specialist tiers contribute domain-bounded analysis;
- an execution tier invokes policy-approved capabilities;
- a critic tier checks evidence, contradictions, and acceptance criteria.

All tiers communicate through typed shared state. Every material assertion carries
provenance, every capability action reuses Forge evidence and policy contracts, and
no worker gains authority merely because another worker requested an action.

The durable user-facing unit is a canonical task thread rather than a provider chat.
A thread records goals, work items, decisions, worker leases, evidence, artifacts,
verification, recovery state, and surface projections. A local CLI, desktop client,
phone, messaging integration, or embedded host may continue the same thread without
creating a second source of truth.

Workers execute through scoped execution cells. A cell may be local, user-hosted,
enterprise-hosted, or cloud-hosted and declares filesystem, network, credential,
capability, time, and compute boundaries. Persistence is a policy choice. The
default is not one ambient computer, filesystem, browser session, and credential
set shared by every worker.

## Proposed layers

1. **Mind layer:** unified goals, commitments, task threads, user model, and
   response synthesis.
2. **Work-graph layer:** typed work items, dependencies, ownership, delegation,
   cancellation, budgets, and leases.
3. **Execution-cell layer:** portable local or remote environments with explicit
   filesystem, network, credential, capability, time, and compute boundaries.
4. **Inference fabric:** sovereign local models plus policy-selected cloud
   escalation through one normalized provider contract.
5. **Capability layer:** Forge-compatible evidence, mutation, messaging, browser,
   computer-use fallback, and domain tools. Native APIs and MCP are preferred when
   they are more deterministic than UI operation.
6. **Learning-state layer:** attributable episodic state, semantic facts and
   hypotheses, correctable preferences, reviewed procedural routines, and bounded
   worker scratch state.
7. **Trigger and recovery layer:** durable schedules and event triggers,
   idempotency, pause/resume/cancel, expiry, approvals, and restart-safe claims.
8. **Evaluation layer:** accepted-outcome quality, provenance recall, corrective
   turns, latency, and cost.
9. **Surface layer:** CLI first, then desktop, mobile, messaging, automation, and
   other general-user interfaces as projections of canonical task threads.

Mixture-of-experts routing is a measured experiment, not an assumed architecture.
It is accepted only if representative evaluations outperform a simpler router on
quality-to-cost and recovery behavior.

Teach-by-demonstration follows the same rule. Observed steps produce a redacted,
parameterized routine candidate with preconditions, required capabilities,
verification, provenance, and known limits. Only evaluation and explicit review can
promote it. Demonstration never grants authority or silently edits a user profile.

Proactivity is also explicit machinery rather than a personality trait. Every
scheduled or inferred follow-up has a visible trigger, owner, budget, expiry,
approval posture, idempotency key, and interruption policy.

## Non-goals

- replacing Forge V1's developer focus;
- creating a second policy or event runtime;
- simulating personalities instead of providing useful typed specialization;
- hidden autonomous authority, unreviewed self-modification, or unbounded memory;
- one mutable worker computer or credential pool as the mandatory collaboration
  model;
- cloud persistence as a prerequisite for useful long-running work;
- raw transcript accumulation presented as a memory system;
- starting implementation before Forge's core contracts and standalone CLI are
  stable.

## Open questions

- Which state belongs to the unified mind versus a scoped worker lease?
- Which state belongs to a project execution cell, and when may it persist after a
  task or user session ends?
- How are conflicting specialist claims represented and resolved?
- Which tasks benefit from parallel workers after accounting for context and
  orchestration cost?
- What evaluation fixtures prove that specialist routing beats one capable model?
- How do local and cloud workers share redacted evidence without splitting audit
  truth?
- What credential-broker contract lets a UI-capable worker operate a signed-in tool
  without exposing reusable secrets to other workers or model context?
- Which workflows justify browser/computer operation after considering brittleness,
  evidence quality, latency, and maintenance against an API or MCP adapter?
- What false-trigger and interruption-cost budgets make proactive follow-up useful
  rather than noisy or unsafe?
- Which general-user capabilities require a stronger safety and consent model than
  developer workspaces?

## Proposed research slices

0. **Forge foundation reuse:** consume stable run, evidence, policy, capability,
   transaction, recovery, and CLI8 learning contracts without adding a second
   runtime.
1. **Single persistent worker:** continue one canonical task thread across restart
   and two surfaces through one scoped execution cell.
2. **Demonstration-to-routine:** turn one bounded observed workflow into a reviewed
   routine and prove a held-out improvement over the unassisted baseline.
3. **Durable triggers:** schedule, pause, resume, cancel, and safely recover a
   routine without duplicating completed non-idempotent work.
4. **Human-tool fallback:** compare deterministic API/MCP execution with a bounded,
   evidence-producing browser/computer path on the same accepted outcome.
5. **Typed multi-worker coordination:** compare a single worker with executive,
   specialist, execution, and critic roles on fixed quality, latency, recovery, and
   cost gates.
6. **Team and surface expansion:** add scoped sharing, credential brokering,
   organizational policy, audit export, and desktop/mobile/messaging projections.

Each slice must report accepted outcome, evidence recall, unsupported claims,
corrective turns, human interventions, calls, compute location, latency, cost,
recovery correctness, and authority violations. Learning and proactive slices also
report false triggers, stale-memory use, correction uptake, and interruption cost.

## Research sequence

1. stabilize Forge run, evidence, capability, policy, and provider contracts;
2. ship and measure the Forge developer CLI;
3. complete Forge's attributable memory, measured retrieval, and reviewed-skill
   vertical slice;
4. prototype one canonical task thread and one scoped execution cell without adding
   new authority;
5. test demonstration-to-routine and durable-trigger recovery before multi-worker
   orchestration;
6. compare single-worker, planned-worker, and MOE routing on fixed evaluations;
7. test unified-state recovery, contradiction handling, credential brokering, and
   cost controls;
8. decide whether Sybil merits a separate product repository and roadmap.

## Start condition

Sybil implementation begins only after Forge contracts are stable, the Forge CLI has
real usage evidence, and the first CLI8 attributable-learning fixture has proved
value. Until then this document preserves intent and research questions; it does not
authorize Forge V1 scope expansion. Documentation and disposable research may
continue, but no Sybil feature may introduce a parallel runtime or delay the
installable Forge alpha.
