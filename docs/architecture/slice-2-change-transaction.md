# Slice 2: developer change transaction

**Status:** Slice 2A–2D accepted; Slice 2E change fidelity and coordination in progress
**Date:** 2026-07-22

## User-visible outcome

Forge can turn exact, digest-backed file evidence into a deterministic and reviewable
change proposal without editing the workspace. This is the first phase of the
developer change loop, not a mutation feature.

The complete Slice 2 outcome remains: propose, approve, isolate, apply, verify, and
either accept or recover a small change with every phase represented as evidence.

## Transaction pipeline

| Phase | Current state | Required evidence |
| --- | --- | --- |
| Read base | implemented | canonical path, bounded content, SHA-256 digest, snapshot ID |
| Propose | implemented | deterministic proposal ID, before/after digests, bounded unified diff |
| Approve | implemented in Rust for the private transaction and candidate lifecycle | explicit decision tied to transaction, proposal, snapshot, verification, and exact capability call |
| Isolate | private Rust clean-revision worktree adapter accepted | clean HEAD, matching snapshot/digests, tracked-file reproducibility, detached boundary |
| Apply | existing-file text replacement accepted; ChangeSet v2 operation coverage in progress | exact manifest/blob identity, before/after digests, operation inventory, bounded application diff |
| Verify | private process adapter and isolation-provider contract accepted; graceful terminal cancellation pending | fixed executable/arguments, bounded output, timeout/cancellation, process-tree termination, requested/effective isolation provenance |
| Accept or recover | exact-byte text promotion/discard and process-crash reconciliation accepted; full-operation WAL coordination pending | post-verification digests/path set, final diff, journal state, explicit promotion/discard/recovery outcome |

## Slice 2B transaction authority

Increment 2B-1 adds the Rust-owned candidate transaction contract. An internal
application manifest binds exact replacement text to the Slice 2A proposal ID and
snapshot. Rust validates the capability subject, content digests, policy result,
adapter evidence, phase order, cancellation, and recovery outcome.

A successful contract run ends at verified_candidate inside an isolated boundary.
It does not promote changes into the active workspace. Increment 2B-2 now supplies
the accepted private Rust clean-revision worktree and policy-named process adapter.
Neither increment expands the seven-tool MCP surface.

See ADR-0007 and Checkpoints 16-17.

## Execution isolation contract

SGU-005 moves process launch and lifecycle beneath a Rust `IsolationProvider`.
Policy selects `trusted`, `host_managed`, or `restricted`; the approved capability
call binds that selection, and verification evidence records who enforced what.

The baseline provider supports honest developer-permission execution and
allowlisted host-attested boundaries. It rejects `restricted` rather than silently
falling back. A real Forge-enforced backend remains a separate platform milestone.
The contract and baseline provider passed hosted Windows, macOS, and Linux
conformance. See ADR-0008 and Checkpoint 18. A real Forge-enforced restricted
backend remains deferred.

## Slice 2C private host bridge

The next increment connects a trusted embedded TypeScript host to the accepted
Rust candidate transaction without moving policy or terminal-state authority into
TypeScript. It uses a separate bounded `forge.kernel.transaction.v1` protocol so
the accepted run protocol v2 remains stable.

Candidate lifecycle is part of the bridge contract. A per-transaction child cannot
return a retained worktree and then forget its location at process exit. Rust will
issue an opaque candidate ID backed by a minimal atomic lifecycle record outside
the governed workspace. The record supports restart-safe lookup and discard; it
does not contain replacement content and is not the general event store. This
2C-0 lifecycle contract passed hosted Windows, macOS, and Ubuntu conformance at
`a985119`. The private transaction protocol and embedded TypeScript adapter now
pass hosted Windows, macOS, and Ubuntu conformance at `fa9898f`.

This first bridge increment is private and `trusted`-only. `host_managed` fails
closed until an authenticated handshake exists, and `restricted` fails closed
until Forge has an OS isolation backend. No CLI transaction command, MCP mutation
tool, promotion flow, or public write capability is introduced. See the Slice 2C
task and Checkpoints 19 and 22.

## Slice 2D accepted candidate completion loop

Rust owns restart-safe candidate inspection, fresh approval, exact-byte promotion,
rollback/reconciliation, and discard. The thin TypeScript CLI transports facts and
renders the Rust artifact. The accepted bounded set is existing regular UTF-8 text
files. It is process-crash recoverable, not a power-loss transaction. See
Checkpoint 24.

## Slice 2E change fidelity and coordination

Slice 2E closes the functional gaps before higher-level intelligence work resumes:

1. **ChangeSet v2 and CAS staging.** A Rust-owned, deterministic operation algebra
   represents create, replace, delete, move/rename, executable-mode intent, and
   bounded binary content. Manifests reference SHA-256 blobs stored outside the
   governed workspace. Symlinks fail closed until an explicit policy exists.
2. **Platform semantics.** Windows and macOS are Tier 1. Canonicalization and
   collision checks must reflect the actual workspace filesystem, not a global
   lowercase shortcut. Windows-specific gates include locks, long paths, atomic
   replacement, and descendant cleanup. macOS gates include case-sensitive and
   case-insensitive behavior where available, atomic rename/durability, process
   groups, and executable bits. Ubuntu remains a compatibility gate.
3. **Transaction coordinator.** A minimal write-ahead state machine records intent,
   staged content, application progress, verification, and terminal disposition.
   Startup reconciliation, workspace-generation/per-path checks, and idempotency
   prevent a stale or concurrent edit from being silently overwritten.
4. **Cancellation.** A cancelled TypeScript caller requests termination over the
   private protocol. Rust emits a terminal artifact when it can; after abrupt host
   death, the next startup reconstructs that outcome from durable state.
5. **Complete local workflow.** The sovereign CLI gains one high-level proposal and
   transaction flow over the same Rust authority. It does not gain raw shell or
   arbitrary direct-write powers.

Slice 2F, not an unspecified future rewrite, owns authenticated `host_managed`
negotiation, enterprise policy/audit exchange, a minimum real `restricted` backend,
and high-level MCP/VS Code mutation.
## Slice 2A contract

A proposal:

- contains from one to twenty UTF-8 text replacements;
- limits each source and replacement to 1 MiB;
- requires the exact lowercase SHA-256 digest returned by Forge read evidence;
- resolves every path through the existing snapshot and canonical-root checks;
- rejects duplicate canonical targets;
- rejects the complete proposal when any base digest is stale;
- emits no change for an exact no-op;
- bounds aggregate returned diff evidence from 1,000 to 500,000 bytes;
- keeps proposal identity independent of diff truncation;
- records mutatesWorkspace as false and approvalRequiredBeforeApply as true.

The capability is available through ForgeWorkspaceService for controlled fixtures.
It is not exposed through MCP and does not expand the seven-tool Developer Test
Milestone A surface.

## Harness efficiency carried forward

Connection-scoped workspace snapshots now reuse a completed scan for adjacent
evidence calls. Reuse is invalidated by relevant filesystem events and bounded by a
five-second rescan ceiling. If recursive change observation is unavailable, Forge
falls back to scan-per-call behavior. An invalidation that races an active scan
starts a new generation rather than joining stale work.

This reduces Forge-owned duplicate traversal. It does not prevent a host model from
issuing redundant MCP calls. Read replay guidance and cache hits address that host
behavior separately and must still be measured in host tests.

## Cross-platform boundary experiment

The cross-platform executable spike in `tests/slice2-boundary-spike.test.ts` proves that candidate
worktree edits leave the original workspace unchanged and that a fixed, shell-free
child process can bound output and distinguish timeout from caller cancellation.
The local Windows run also proves the critical limitations: a detached worktree uses committed content,
omits dirty/untracked developer state, and does not carry ignored dependencies such
as `node_modules`.

See `docs/architecture/slice-2-windows-worktree-process-boundary.md` for the
accepted candidate evidence and remaining gates. The identical suite passed on
hosted Windows and macOS. The repository enforces LF for tracked text so Forge
evidence digests do not vary with the checkout platform.

## Current safety boundary

No generic shell, package-installation, arbitrary direct-write, public write, or MCP
mutation API exists. Slice 2D provides only high-level candidate inspect, accept,
and discard CLI commands over private Rust authority. Slice 2E may expand the
high-level transaction CLI; the seven MCP evidence tools remain read-only until the
separate Slice 2F pilot gate.

A Git worktree is a recoverability boundary, not a security sandbox. Verification
now routes through one Rust isolation-provider contract. The baseline `trusted`
profile still runs with the Forge process permissions; `host_managed` records an
allowlisted host assertion without claiming Forge enforcement; `restricted` fails
closed because no Forge OS backend exists yet. Forge detects governed-workspace
drift and refuses retention, but organizational sandbox, DLP, and egress controls
remain separate layers.

## Slice 2 exit gate

Slice 2 is complete only when a disposable fixture task:

1. reads a digest-backed base;
2. creates and approves a proposal;
3. applies it inside the selected recoverable boundary;
4. runs bounded verification;
5. returns the final diff and verification evidence;
6. demonstrates recoverable behavior on conflict, failed verification, cancellation,
   and cleanup failure.
