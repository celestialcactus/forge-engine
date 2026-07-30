# ADR-0008: Rust-owned execution isolation profiles

- **Status:** accepted for the baseline provider contract; restricted backend deferred
- **Date:** 2026-07-23
- **Owners:** ForgeEngine project
- **Checkpoint:** 2026-07-23-18
- **Supersedes:** none
- **Refined by:** ADR-0010 deterministic verifier process ownership and ADR-0014
  isolation provider capability authority
- **Superseded by:** none

## Context

The accepted Slice 2B adapter creates a detached candidate worktree and supervises
one policy-named verification process. The worktree preserves and recovers
repository state, but it does not restrict filesystem access, network access,
credentials, resource use, or subprocess behavior. Calling that boundary a
sandbox would be false.

Forge must support local developer execution, externally contained enterprise
execution, and later Forge-enforced containment without building three transaction
state machines. The isolation choice must remain subordinate to Rust policy and
must produce evidence that distinguishes an actual Forge control from a host claim.

## Decision drivers

- no false sandbox claims;
- one Rust-owned process launch, cancellation, timeout, and descendant lifecycle;
- rapid TypeScript host integration without transferring final policy authority;
- per-invocation policy rather than a global guardrail bypass;
- an interchangeable backend seam for Windows, macOS, and Linux;
- inspectable evidence for what was requested, supplied, and enforced;
- fail-closed behavior when the requested profile is unavailable.

## Decision

Forge defines three execution-isolation profiles:

| Profile | Meaning | Current support |
| --- | --- | --- |
| `trusted` | Run with the Forge process's operating-system permissions. Approval, capability policy, bounds, cancellation, worktree recovery, and evidence still apply. | Implemented by the baseline provider. It explicitly records no OS containment. |
| `host_managed` | An authenticated enclosing host proves that Forge and inherited child processes are already inside an identified boundary. | Contracted but unavailable through the baseline provider. ADR-0014 retired raw allowlisted assertions; requests fail closed until an authenticated host provider passes its gate. |
| `restricted` | Forge itself must apply and supervise an OS isolation backend. | Contracted but deliberately unsupported by the baseline provider; requests fail closed before the verifier starts. |

The host or TypeScript integration layer may request a profile and may supply host
facts. A policy-owned verification check declares the required profile and the
allowlisted host provider identities. Rust compares request to policy before
launch. The exact capability call binds the profile and, for host-managed
execution, the provider and boundary identities.

`trusted` is narrowly an execution-isolation profile. It is not a God Mode and does
not disable approval, path rules, capability policy, verification bounds, or
artifact recording.

## Provider boundary

`IsolationProvider::execute` owns the complete child-process operation: policy and
request validation, launch, output bounds, timeout, cancellation, descendant
cleanup, and isolation evidence. The worktree adapter no longer launches a
verifier directly. A later restricted provider must implement this interface and
cannot obtain a `forge_enforced` result by decorating an already-started process.

The baseline provider keeps the existing cross-platform process-group/tree
behavior. It supports `trusted` only; it rejects `host_managed` and `restricted`
before a verifier starts.

ADR-0014 requires every provider to advertise a Rust-validated descriptor covering
its supported profiles, host-attestation authority, and enforceable restricted
controls. A future host-managed provider must obtain freshness-bound evidence from
an authenticated host handshake or deployment identity, never from model text or
a raw caller assertion.

## Evidence contract

Every transaction artifact preserves the requested profile and host facts even when
execution fails closed. Every completed verification additionally records:

- requested and effective profile;
- enforcement provenance: `none`, `host_attested`, or `forge_enforced`;
- provider and optional boundary identity;
- whether Forge itself enforced containment;
- host-attested control categories;
- explicit limitations.

The transaction authority rejects inconsistent isolation evidence and recovers the
candidate rather than retaining it. A restricted result is consistent only when it
states `forge_enforced` and a future provider actually supplies that result.

## Consequences

### Positive

- Worktree recovery and OS containment are no longer conflated.
- Restricted backends can be added without moving transaction authority or process
  supervision back into TypeScript.
- Enterprise hosts can supply their own containment while Forge preserves evidence
  provenance.
- Local developers retain a deliberate low-friction path without disabling other
  controls.

### Negative

- The baseline still inherits the Forge process environment and permissions.
- Host-managed execution remains unavailable until the future host handshake is
  authenticated and replay-resistant.
- Windows, macOS, and Linux require different restricted-provider implementations
  and adversarial platform suites.
- This contract does not itself sandbox MCP servers, provider SDKs, or other future
  process capabilities; those must route through the same boundary before making
  containment claims.

## Restricted backend requirements

A restricted provider must prove, per supported platform:

- canonical read/write filesystem policy, including symlink and junction behavior;
- environment and credential minimization;
- process-tree ownership and teardown;
- network default and egress policy;
- CPU, memory, process-count, and time limits;
- explicit unsupported-control evidence;
- denial and escape-oriented integration tests.

Likely mechanisms are namespaces/seccomp/cgroups on Linux, restricted tokens and
Job Objects with an evaluated AppContainer/container boundary on Windows, and an
evaluated Seatbelt/container mechanism on macOS. Mechanism choice remains a later
spike; this ADR does not pre-accept one.

## Validation

The local gate covers:

- trusted execution succeeds and records `enforcement: none` plus limitations;
- raw host-managed execution fails closed before verifier launch;
- invalid provider descriptors and provider/profile mismatches fail closed;
- host-managed evidence is accepted only from a provider descriptor that declares
  authenticated host-attestation authority;
- restricted execution fails closed and recovers the candidate;
- approval cannot be reused for a different isolation profile;
- malformed isolation evidence prevents candidate retention;
- existing timeout, cancellation, descendant termination, worktree recovery, and
  original-workspace invariants remain green.

Hosted Windows, macOS, and Linux conformance remains required before the
implementation checkpoint is accepted.

## References

- docs/architecture/slice-2-change-transaction.md
- docs/decisions/ADRs/ADR-0007-rust-authoritative-candidate-transactions.md
- docs/tasks/SGU-005-execution-isolation-contract.md