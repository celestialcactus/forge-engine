# ADR-0013: Sovereign ChangeSet v2 CLI boundary

- **Status:** accepted
- **Date:** 2026-07-30
- **Owners:** ForgeEngine maintainers
- **Checkpoint:** 2026-07-30-37
- **Supersedes:** none
- **Superseded by:** none

## Context

The durable ChangeSet v2 coordinator is the accepted mutation and recovery
authority, but it is not reachable from the CLI. The existing CLI exposes older
text-only transaction and candidate contracts. Simply chaining those contracts in
TypeScript would preserve duplicate transaction semantics and make the integration
layer responsible for sequencing critical state.

## Decision

Forge will add one bounded `forge.kernel.changeset.v2` protocol backed directly by
a Rust service that composes ChangeSet v2 staging, candidate application,
policy-named verification, durable registration, inspection, promotion, discard,
cleanup, and reconciliation.

The CLI will expose this as `forge change propose|inspect|accept|discard`. TypeScript
may select explicit input files and render evidence, but Rust derives repository
facts and owns all success, conflict, recovery, and terminal decisions.

Proposal content and verification policy are separate inputs. A proposal can
describe bounded file intent but cannot choose an executable. Verification checks
are named from operator-controlled configuration. The first accepted posture is
trusted local execution and is reported honestly; restricted execution remains
Slice 2F.

## Consequences

- The developer sees one current transaction flow rather than two cooperating
  partial lifecycles.
- Verification evidence and candidate cleanup become durable transaction concerns.
- The protocol can later be transported by MCP or another host without moving
  mutation authority out of Rust.
- The older protocols remain internal compatibility paths until their tests and
  consumers can be deliberately retired.
- JSON proposal and policy files are a prototype surface, not the eventual
  interactive authoring UX.

## Revisit conditions

- A provider-neutral proposal contract needs streaming blobs larger than the
  accepted bounded protocol.
- Restricted execution requires a different verification configuration boundary.
- Recovery evidence shows the filesystem coordinator cannot guarantee terminal
  candidate cleanup on a Tier-1 platform.

## References

- `docs/tasks/SLICE-002E3B-sovereign-transaction-cli.md`
- ADR-0011
- ADR-0012