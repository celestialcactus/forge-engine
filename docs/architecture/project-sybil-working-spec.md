# Project Sybil working specification

**Status:** exploratory working-name specification; not ForgeEngine V1 authority
**Date:** 2026-08-03
**Last researched:** 2026-08-13

## Purpose

Project Sybil is a separate future sovereign agent-orchestration platform.
ForgeEngine remains its own sovereign developer CLI and software-evidence harness;
it is a pilot and source of tested lessons, not an early product mode or required
runtime for Sybil.

Sybil may deliberately adopt proven concepts, schemas, protocols, evaluation
methods, or components from Forge. Every transfer requires an explicit Sybil-side
decision about fit, ownership, compatibility, and migration. Neither project is a
mandatory dependency, release gate, repository, or product horizon of the other.

The [Grok Bot pattern review](../audit/2026-08-13-grok-bot-sybil-pattern-review.md)
adds a competitive checkpoint for persistent workers, teach-by-demonstration,
asynchronous routines, cross-surface continuity, and coordinated specialists. It
validates the product direction but does not authorize those features inside Forge
V1, merge the two product roadmaps, or make Grok Bot's unpublished implementation
an architectural authority.

## Project boundary

- **ForgeEngine:** an alternative sovereign, context-aware developer CLI/harness
  focused on evidence-backed software work, local/cloud provider choice, learning
  developer workflows, and symbiotic IDE/host integration.
- **Project Sybil:** an independent sovereign agent-orchestration platform focused
  on persistent workers, work graphs, heterogeneous capabilities, automation,
  cross-surface continuity, and broader user/team workflows.
- **Transfer lane:** Forge pilot evidence can inform Sybil architecture, and either
  project may publish optional interoperable protocols or reusable packages. Shared
  code is adopted deliberately rather than assumed.
- **Independence rule:** each project owns its runtime, roadmap, repository,
  release cadence, threat model, governance, and acceptance gates. Compatibility is
  useful; architectural dependence is not required.

## Proposed operating model

Sybil presents one coherent user-facing mind while distributing work across typed
roles:

- an executive tier owns goals, budgets, and final commitments;
- a planning tier decomposes work and records dependencies;
- specialist tiers contribute domain-bounded analysis;
- an execution tier invokes policy-approved capabilities;
- a critic tier checks evidence, contradictions, and acceptance criteria.

All tiers communicate through typed shared state. Every material assertion carries
provenance, every capability action passes through Sybil-owned evidence and policy
contracts informed by measured Forge lessons, and no worker gains authority merely
because another worker requested an action.

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
- turning Sybil into a Forge mode, plugin, repository subdirectory, or release
  milestone;
- requiring Forge to become a general-purpose orchestration platform;
- blindly cloning Forge contracts where Sybil's domain requires a different design;
- creating multiple competing policy or event runtimes inside Sybil itself;
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

0. **Pilot lesson transfer:** catalogue Forge's measured run, evidence, policy,
   capability, transaction, recovery, and CLI8 learning results. Decide explicitly
   which concepts, protocols, evaluations, or components Sybil adopts, adapts, or
   rejects without making Forge a runtime dependency.
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

1. ship and measure the Forge developer CLI pilot independently;
2. inventory the applicable Forge lessons, including failed approaches and measured
   learning-loop results;
3. establish a separate Sybil repository, product contract, threat model, and
   adoption record;
4. prototype one canonical Sybil task thread and one scoped execution cell using
   Sybil-owned runtime authority;
5. test demonstration-to-routine and durable-trigger recovery before multi-worker
   orchestration;
6. compare single-worker, planned-worker, and MOE routing on fixed evaluations;
7. test unified-state recovery, contradiction handling, credential brokering, and
   cost controls;
8. decide which optional Forge/Sybil interoperability protocols merit independent
   conformance suites.

## Start condition

Sybil owns an independent start decision and roadmap. Before implementation, it must
have a separate repository/product boundary and an explicit record of which
available Forge pilot lessons it adopts, adapts, or rejects. Forge does not need to
finish every planned feature before Sybil research begins, and Sybil may not delay
the installable Forge alpha. This document does not authorize Forge V1 scope
expansion or imply that either project ships inside the other's runtime.
