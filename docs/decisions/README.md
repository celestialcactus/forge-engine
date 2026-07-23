# ForgeEngine Decision Record

This directory is the durable architectural memory for ForgeEngine. The archived prototype is not an architectural authority; decisions are authoritative only when recorded here and accepted through the checkpoint process.

## Document types

- `ADRs/`: one architectural decision per file, including alternatives, evidence, consequences, and replacement conditions.
- `checkpoints/`: chronological implementation checkpoints recording current behavior, validation evidence, failures, and the next proposed decision.
- `architecture-changelog.md`: short chronological index of material architectural changes with links to the detailed records.

## Required checkpoints

A checkpoint is required before:

- adopting or replacing a framework, SDK, database, protocol implementation, or external service;
- changing a public contract, persistence format, security boundary, or deployment topology;
- expanding V1 scope;
- introducing an abstraction with only one known implementation.

A checkpoint is also required after each vertical slice and whenever validation contradicts the design.

## Decision lifecycle

ADRs use one of these statuses:

- `proposed`: documented for review; no implementation authority yet;
- `accepted`: approved as the current direction;
- `experimental`: approved for a bounded spike, not as a durable dependency;
- `superseded`: replaced by another ADR;
- `rejected`: considered and deliberately not selected.

An accepted ADR can be replaced. It should not be silently rewritten after implementation; create a superseding ADR so the reasoning remains inspectable.

## Evidence standard

Records must distinguish observed behavior, intent, inference, and recommendation. A command is recorded as passing only when it was run and its result captured in the associated checkpoint.
