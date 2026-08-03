# Project Sybil working specification

**Status:** exploratory working-name specification; not ForgeEngine V1 authority
**Date:** 2026-08-03

## Purpose

Project Sybil is a possible future generalized sovereign worker platform built on
stable Forge contracts. Forge V1 remains the developer software-evidence CLI and
harness. Sybil must not begin by forking Forge's runtime, policy, evidence, or
capability semantics.

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

## Proposed layers

1. **Mind layer:** unified goals, commitments, user model, and response synthesis.
2. **Worker layer:** bounded roles, delegation, cancellation, budgets, and leases.
3. **Inference fabric:** sovereign local models plus policy-selected cloud
   escalation through one normalized provider contract.
4. **Capability layer:** Forge-compatible evidence, mutation, messaging, browser,
   and domain tools.
5. **Evaluation layer:** accepted-outcome quality, provenance recall, corrective
   turns, latency, and cost.
6. **Surface layer:** CLI first, then desktop, messaging, automation, and other
   general-user interfaces.

Mixture-of-experts routing is a measured experiment, not an assumed architecture.
It is accepted only if representative evaluations outperform a simpler router on
quality-to-cost and recovery behavior.

## Non-goals

- replacing Forge V1's developer focus;
- creating a second policy or event runtime;
- simulating personalities instead of providing useful typed specialization;
- hidden autonomous authority, unreviewed self-modification, or unbounded memory;
- starting implementation before Forge's core contracts and standalone CLI are
  stable.

## Open questions

- Which state belongs to the unified mind versus a scoped worker lease?
- How are conflicting specialist claims represented and resolved?
- Which tasks benefit from parallel workers after accounting for context and
  orchestration cost?
- What evaluation fixtures prove that specialist routing beats one capable model?
- How do local and cloud workers share redacted evidence without splitting audit
  truth?
- Which general-user capabilities require a stronger safety and consent model than
  developer workspaces?

## Research sequence

1. stabilize Forge run, evidence, capability, policy, and provider contracts;
2. ship and measure the Forge developer CLI;
3. prototype typed delegation using Forge artifacts without adding new authority;
4. compare single-agent, planned-worker, and MOE routing on fixed evaluations;
5. test unified-state recovery, contradiction handling, and cost controls;
6. decide whether Sybil merits a separate product repository and roadmap.

## Start condition

Sybil begins only after Forge contracts are stable and the Forge CLI has real usage
evidence. Until then this document preserves intent and research questions; it does
not authorize Forge V1 scope expansion.
