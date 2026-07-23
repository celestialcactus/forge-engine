# Checkpoint 2026-07-10-03: Capability radar

- **Status:** passed
- **Date:** 2026-07-10
- **Scope:** identify paradigm-shaping harness capabilities before further implementation

## Objective

Classify capabilities by architectural impact so research results narrow ForgeEngine V1 rather than producing a feature catalogue.

## Research performed

- Aider source: repository map, tree-sitter tags, PageRank selection, edit formats, lint/repair, architect/editor split.
- SWE-agent source: trajectory format, replay, run comparison, repository/environment identity, tool bundles, history processing.
- Existing Hermes, Headroom, Codex, Claude Code, and VS Code source/documentation audit.
- Continue documentation/source review for explicit embedding/reranking roles and codebase retrieval tradeoffs.

## Decisions proposed

| Decision | Status | Rationale |
|---|---|---|
| Forge is a software-evidence runtime | proposed | Deterministic evidence and outcome evaluation unify local efficiency, context planning, validated change, and learning |
| Context plan is a first-class artifact | proposed | Makes selection, transformation, retrieval, and provider behavior inspectable |
| Task/change transaction is a core primitive | proposed | Unifies planning, patching, validation, evidence, review, worktrees, and rollback |
| Trajectories are replayable evidence, not just logs | proposed | Enables evaluation and learning without opaque self-modification |
| Repository intelligence precedes generic RAG | proposed | Deterministic facts, exact retrieval, and language services offer higher-confidence early value |
| Worktree-aware identity is core; worktree backend may follow | proposed | Protects future parallelism without requiring it for early V1 |

## Known limitations

- This is a research classification, not acceptance of a framework or a claim that every capability belongs in V1.
- Local model behavior, provider interoperability, and Windows execution constraints require later empirical contract suites.
- The new capability radar must be reviewed with the project owner before Phase 0 specification work begins.

## Next checkpoint

Create the Phase 0 specification package: runtime events, artifacts/context items, task/change transaction, workspace snapshots, trajectories, repository intelligence contracts, and evaluation fixtures.
