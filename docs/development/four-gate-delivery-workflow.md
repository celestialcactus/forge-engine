# Four-gate delivery workflow

**Status:** active delivery policy
**Applies from:** 2026-08-28
**Purpose:** decide consequential product and program boundaries before implementation,
then divide the work into independently verifiable vertical slices.

Forge uses four proportional approval gates for consequential work:

1. Product;
2. Architecture;
3. Program Design;
4. Vertical Slices.

This workflow adapts the four-phase planning model described by Dexter Horthy in
[Why Software Factories Fail](https://www.linkedin.com/pulse/why-software-factories-fail-dexter-horthy-ttxae/).
It connects Forge's existing build plan, ADR, task, and checkpoint system; it does
not replace those authorities or require four new documents for every change.

## When the full workflow is required

Use all four gates before implementation when a change has any of these traits:

- adds a product feature or a bounded build-plan slice;
- changes a public CLI, API, protocol, schema, persistence format, or host contract;
- changes identity, migration, transaction, recovery, concurrency, security,
  approval, secret, sandbox, or execution-authority behavior;
- crosses packages or runtime boundaries, or is expected to require multiple PRs;
- can be divided among two or more implementation owners;
- contains an early choice whose reversal would invalidate substantial downstream
  work.

These triggers override apparent code size. A small schema or authority change can
require the full workflow even when its patch is short.

## Proportional paths

| Path | Typical work | Required planning |
| --- | --- | --- |
| Fast | Typo, mechanical refactor, narrow test addition, or local bug fix with no changed contract or authority boundary | State the outcome and acceptance test in the task or PR. The four approvals are not required. |
| Compact | Bounded multi-file change with one owner and low reversal cost | Product and Architecture may share one short review. Record Program Design and one or more vertical acceptance steps in the task. |
| Full | Any trigger listed above | Obtain four explicit approvals in order before implementation. |
| Spike | Time-boxed uncertainty reduction that cannot honestly be designed yet | Approve the question, budget, disposable output, and stop condition. A spike cannot become accepted product code without returning through the applicable gates. |

When classification is uncertain, use the next more rigorous path. Record the
chosen path and rationale in the active task. Do not use line count as the sole
classifier.

## Gate 1: Product

### Question

What user problem are we solving, for whom, and what observable outcome would make
the change worthwhile?

### Required decision material

- target user and current pain;
- desired journey, including the CLI/host experience where applicable;
- observable success measures and acceptance examples;
- explicit non-goals and product non-claims;
- mockup, transcript, or interaction sketch when the experience is user-facing;
- the smallest end-to-end demonstration that would prove value.

Implementation mechanisms do not belong in this gate unless they are themselves a
product constraint.

### Exit

The reviewer explicitly approves the problem, outcome, experience boundary, and
non-goals. The task records `Product: approved`, the date, approver, and decision
source.

## Gate 2: Architecture

### Question

What system boundaries and durable contracts can deliver the approved product
outcome without violating accepted Forge invariants?

### Required decision material

- fit with the validated build plan and accepted ADRs;
- end-to-end system flow and ownership boundaries;
- data, protocol, state, identity, and authority contracts;
- failure behavior, recovery, compatibility, and migration strategy;
- security, privacy, provenance, and platform implications;
- alternatives, least-confident decisions, and replacement conditions;
- retained non-claims;
- new or superseding ADRs for durable architectural choices.

### Exit

The reviewer explicitly approves the boundaries and alternatives. Required ADRs
are accepted or an explicitly bounded spike is approved. The task records
`Architecture: approved` with links.

## Gate 3: Program Design

### Question

How will the approved architecture be expressed in code closely enough that
implementation owners do not have to invent shared contracts independently?

### Required decision material

- proposed file-tree diff and module ownership;
- types, interfaces, function signatures, and schemas without implementation
  bodies;
- principal call stacks and state transitions;
- error taxonomy, limits, cancellation, and deterministic behavior;
- fixtures, goldens, test seams, and acceptance commands;
- shared-boundary files and exclusive implementation files;
- integration owner and compatibility/rebase expectations;
- unresolved decisions, with an owner and a stop condition for each.

Program Design must be specific enough to expose contract disagreements before
parallel work starts. It must not grow into pseudocode for every function.

### Exit

The reviewer explicitly approves the code-level contracts, shared boundaries, and
test plan. The task records `Program Design: approved`. Parallel implementation is
not authorized while owners could still choose incompatible types or signatures.

## Gate 4: Vertical Slices

### Question

What is the smallest sequence of touchable, testable end-to-end increments, and
which of them can safely run in parallel?

### Required decision material

For every slice or package, record:

- user- or operator-visible capability proved;
- inputs, outputs, dependencies, and explicit exclusions;
- owned files and shared files;
- deterministic acceptance evidence;
- PR/merge boundary and integration order;
- rollback or re-steer point.

The first increment should be a tracer bullet through the riskiest real seam, not
one complete horizontal layer. Prefer review-sized increments. A reviewer may
approve a packet of several already-bounded slices so implementation can continue
without pausing after every small commit.

### Parallelization rule

Parallel work begins only after shared contracts are frozen at Gate 3. If a shared
boundary must change, pause dependent packages, reopen the relevant gate, and
record the decision. Each parallel package must have:

- one owner;
- exclusive or deliberately coordinated file ownership;
- frozen input/output contracts;
- an independently runnable test;
- an explicit dependency and merge order;
- one named integration owner.

### Exit

The reviewer explicitly approves the slice graph and authorized packet. The task
records `Vertical Slices: approved`; implementation may then begin within that
packet.

## Approval and change protocol

- `draft` and `ready for review` are not approvals.
- Approval must be explicit in the task, PR, or linked conversation and must name
  the approved revision or decision material.
- The author summarizes decisions, doubts, and trade-offs at each gate instead of
  asking the reviewer to rediscover them in the documents.
- Approval authorizes only the next gate, except when the reviewer explicitly
  approves multiple completed gates or a bounded slice packet.
- New evidence may reopen an earlier gate. Stop affected implementation and record
  the changed assumption; do not silently drift the contract.
- After each accepted vertical slice, create or update the implementation
  checkpoint with exact validation evidence and the next proposed decision.
- A branch, candidate, or passing local test is not accepted product state until
  the repository's normal merge and hosted gates pass.

## Relationship to Forge documents

| Document | Role in this workflow |
| --- | --- |
| Validated build plan | Durable product direction, invariants, and slice ordering |
| Active task file | Four-gate status, bounded scope, Program Design, and slice graph |
| ADR | Durable architectural decision from Gate 2 |
| Fixture/schema/test | Executable contract from Gates 3–4 |
| Checkpoint | Exact implementation and validation evidence after a slice |
| Architecture changelog | Chronological index of material accepted decisions |

Use the [four-gate task template](../tasks/FOUR-GATE-TASK-TEMPLATE.md) for a new
full-path lane. An established task may add the same sections in place rather than
duplicating its authority.
