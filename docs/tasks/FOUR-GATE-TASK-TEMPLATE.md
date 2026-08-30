# [Lane ID]: [Product outcome]

**Delivery path:** full | compact | fast | spike
**State:** discovery | gate review | implementation | validation | accepted | blocked
**Build-plan authority:**
**Related ADRs:**
**Integration owner:**

## Approval ledger

| Gate | Status | Revision/material | Approver | Date | Decision source |
| --- | --- | --- | --- | --- | --- |
| Product | draft | | | | |
| Architecture | not started | | | | |
| Program Design | not started | | | | |
| Vertical Slices | not started | | | | |

Allowed statuses are `not started`, `draft`, `ready for review`, `approved`, and
`reopened`. Approval must be explicit; implementation is not authorized merely
because a draft exists.

## Gate 1: Product

### User and problem

### Desired journey

### Observable success and acceptance examples

### Smallest end-to-end demonstration

### Non-goals and non-claims

### Open product decisions

## Gate 2: Architecture

### Fit with the accepted system

### End-to-end flow and ownership

### Data, state, identity, and authority contracts

### Failure, recovery, compatibility, and migration

### Security, privacy, provenance, and platform boundary

### Alternatives and least-confident decisions

### ADR changes and retained non-claims

## Gate 3: Program Design

### Proposed file-tree diff

### Types, interfaces, signatures, and schemas

### Principal call stacks and state transitions

### Errors, limits, cancellation, and determinism

### Fixtures, tests, and exact validation commands

### Shared boundaries, exclusive ownership, and integration plan

### Unresolved decisions

## Gate 4: Vertical Slices

| Package | Observable proof | Depends on | Owned files | Shared files | Acceptance evidence | Merge/re-steer point |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | | | | | | |

### Authorized slice packet

State exactly which packages may proceed and which remain gated.

### Parallelization map

State which packages can run concurrently, their frozen contracts, owners, and
integration order. If none can safely run in parallel, say so.

## Checkpoint and acceptance record

- Exact candidate:
- Commands and results:
- Hosted evidence:
- Accepted boundary:
- Retained non-claims:
- Next gate:
