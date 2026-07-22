# Research validation: what ForgeEngine V1 may safely adopt

**Status:** accepted as planning input
**Date:** 2026-07-10
**Scope:** validates the second research pass. This is not a claim that ForgeEngine
has implemented any referenced capability.

## Decision

ForgeEngine will adopt a small set of *native* architectural principles from the
research corpus. It will not embed another harness, proxy every model call, make a
graph database foundational, or promise automatic learning before evidence exists.

The reference projects are evidence of useful patterns, not architectural parents.
Every imported idea must map to a Forge-owned contract, have an evaluation method,
and be removable without destabilising the runtime.

## Evidence classification

| Finding | Confidence | Forge decision | Why it survives validation |
| --- | --- | --- | --- |
| A host-neutral event protocol is the integration seam. | High | Core V1 contract. | Codex separates app/runtime protocols; MCP formalises request lifecycle; all host modes need the same cancellation and result semantics. |
| Cancellation is a first-class race-prone lifecycle, not an exception. | High | Core V1 contract and tests. | MCP cancellation is asynchronous and may arrive after completion; the core must tolerate both outcomes. |
| Deterministic repository intelligence should precede model reasoning. | High | Core V1 capability. | Aider's tree-sitter map and modern coding harnesses rely on search, symbols, diagnostics, and version control as evidence sources. Models should explain and choose, not impersonate parsers. |
| Context reduction needs provenance, atomicity, and a safe failure mode. | High | Core V1 context contract; transforms start conservative. | Headroom's lifecycle and tool-call/result atomicity show the necessary invariants. A transform failure must preserve the original context. |
| Context quality must be measured as outcome cost, not token reduction. | High | Core V1 metrics and evaluation rule. | A token-saving transform can cause extra turns or failed edits. Its relevant score is accepted-outcome cost and evidence retained. |
| Skills should be progressively disclosed and explicitly promoted. | High | V1 manual skills; automated promotion is an experiment. | Hermes separates discovery from loading and uses bounded memory. This avoids putting every instruction into every prompt. |
| Durable trajectory records enable replay and regression evaluation. | High | Core V1 artifact model. | SWE-agent's trajectories demonstrate that reproducibility and evaluation need the same durable evidence trail. |
| Workspace identity/snapshots matter for trustworthy reuse. | High | V1 workspace snapshot, later worktree execution. | Memory, skill candidates, and replay must be tied to a repository state rather than an ambiguous path. |
| Capability discovery must be bounded. | High | V1 capability registry and curated exposure. | Large, always-visible tool menus dilute decision context; Claude Code and MCP ecosystems both make selective exposure practical. |
| Architect/planner and editor/executor roles improve quality. | Medium | Optional experiment after the basic loop works. | Aider offers a useful split, but it is not proven superior for Forge's local/cloud and host-neutral modes. |
| A code graph improves code retrieval. | Medium | In-memory/projection experiment; no graph DB in V1. | Graph relations can help navigation, but a relational/embedded projection plus file/symbol indexes meets the first product need with far less operational cost. |
| Learned skill extraction will improve developer workflows. | Medium-low | Candidate compiler only; user approval required. | Hermes makes the pattern credible, but effectiveness is workspace- and user-specific. Candidate quality must be evaluated against false and stale advice. |
| A Headroom-compatible sidecar/proxy is the best optimization route. | Low-medium | Adapter experiment only. | The project demonstrates useful transform ideas, but provider/protocol edge cases make a universal proxy a poor V1 dependency. The project has reported real compatibility issues around Codex traffic. |
| Routing local versus cloud by predicted quality/cost is valuable. | Low-medium | Post-baseline experiment. | The product need is real, but reliable routing requires Forge-owned traces, task fixtures, and explicit user policy first. |

## What the research changes

1. **Events and artifacts precede integrations.** A CLI, MCP server, Copilot/Codex
   adapter, and future desktop client must observe the same run, tool, context,
   approval, cancellation, and artifact model.
2. **The context compiler replaces a compression pipeline.** It is a planner that
   chooses evidence, representation, ordering, and optional transforms under a
   budget. Lossy compression is one optional transform, never the definition of
   the system.
3. **Repository intelligence is a deterministic evidence layer.** Start with file
   trees, ignore rules, ripgrep, syntax-aware symbols where available, diagnostics,
   git state, and test results. Add embeddings or a graph projection only when a
   benchmark demonstrates a gap.
4. **Learning is compilation, not unattended mutation.** V1 stores bounded
   observations and lets a user review/promote a proposed skill. It does not
   silently rewrite instructions or alter policy.
5. **State is event-first with query projections.** The initial durable store can
   be SQLite plus append-only run artifacts. A graph database is neither required
   nor justified for V1.

## Explicit non-adoptions

- No generic RAG subsystem as the default route to repository understanding.
- No graph database as the system of record or early infrastructure dependency.
- No always-on interception/proxy of provider traffic.
- No unreviewed auto-generated skills, memory, or configuration changes.
- No autonomous multi-agent swarm as a prerequisite for a useful single-developer
  loop.
- No claim that a command allow-list is a security sandbox.

## Required proof before expansion

| Candidate | Minimum proof required |
| --- | --- |
| Any lossy context transform | Better or equal accepted-task rate and evidence recall at a lower total cost across a fixed Forge fixture set. |
| Graph projection / graph store | A benchmark where symbol/file indexes miss important cross-references and the graph measurably improves retrieval or task completion. |
| Auto-skill promotion | Reviewable candidates with provenance, expiry, and a measured reduction in repeated corrections without harmful suggestions. |
| Provider routing | Traces showing a repeatable quality/cost boundary plus user-controlled escalation policy. |
| External compression proxy | Compatibility suite passes for streaming, tool calls, cancellation, auth, and both local and cloud providers. |

## Source trail

- [Model Context Protocol: cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)
- [Model Context Protocol: tasks extension](https://modelcontextprotocol.io/seps/2663-tasks-extension)
- [Claude Code CLI and MCP integration](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Headroom source and stated architecture](https://github.com/headroomlabs-ai/headroom)
- [Aider repository map implementation](https://github.com/Aider-AI/aider/blob/main/aider/repomap.py)
- [SWE-agent repository](https://github.com/SWE-agent/SWE-agent)
- [OpenAI Codex repository](https://github.com/openai/codex)
- [Hermes Agent repository](https://github.com/NousResearch/hermes-agent)

## Interpretation note

Public repositories and documentation substantiate implementation patterns, not
marketing claims of superiority. The confidence values above therefore describe
confidence in the *architectural deduction*, not a claim that a reference product
is correct in every environment.
