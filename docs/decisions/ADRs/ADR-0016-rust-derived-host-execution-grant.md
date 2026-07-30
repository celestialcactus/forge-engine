# ADR-0016: Rust-derived single-use host execution grant

- **Status:** accepted for Slice 2F-2b implementation
- **Date:** 2026-07-30
- **Owners:** ForgeEngine project
- **Implementation:** pending
- **Checkpoint:** 2026-07-30-43
- **Refines:** ADR-0014 and ADR-0015
- **Supersedes:** caller-supplied `HostIsolationAttestation` requests

## Context

A valid signature is not sufficient if a caller chooses the digests being signed.
Forge must prove that the capability and policy bindings describe the exact
transaction and verifier it will execute. It must also prevent a signed statement
from becoming a reusable bearer token.

Authenticating only after candidate application would cause unnecessary mutation
and recovery work for a request that never had authority to execute. Authenticating
inside TypeScript would create a second policy authority and weaken the hybrid
boundary.

## Decision

Rust will derive two domain-separated identities:

- the capability identity covers the validated transaction, exact capability call,
  manifest content identity, and verification selection; and
- the policy identity covers the exact selected verification check, bounded process
  and environment configuration, isolation policy, provider, and required controls.

After approval and disposable-boundary preparation, but before candidate
application, the Rust verification runner asks an authenticated host provider to
issue and consume a bound challenge. Success produces an opaque, non-cloneable
execution grant. Only the provider that issued the grant can consume it, exactly
once, for the same derived identities.

The provider revalidates the consumed ledger record before process launch. The
transaction artifact receives a serializable evidence projection, not the opaque
grant. TypeScript carries bounded protocol frames and invokes a host-owned signer;
it never receives a constructor for the Rust grant.

## Rejected alternatives

- **Keep caller-supplied boundary assertions:** a caller can invent authority.
- **Let TypeScript hash policy objects:** serializer or semantic drift creates a
  second policy engine.
- **Authenticate after applying the candidate:** safe recovery is possible, but
  avoidable mutation precedes authority.
- **Treat consumed ledger evidence as a reusable token:** one proof could launch
  multiple verifiers.
- **Place the host private key in Rust configuration:** Forge could impersonate the
  host it is supposed to verify.
- **Claim host attestation is a sandbox:** authentication does not prove control
  effectiveness.

## Consequences

### Positive

- The signed facts and executed facts share one Rust authority path.
- Invalid host authority fails before candidate application or verifier launch.
- Durable audit evidence and runtime isolation evidence share the same challenge.
- TypeScript remains a rapid integration layer without becoming policy authority.

### Negative

- The private transaction protocol becomes a multi-frame exchange.
- Hosts need a signing callback and public-key trust configuration.
- A successfully consumed grant can be burned by a later crash or failed candidate
  operation; it is never silently reusable.
- Actual containment still depends on the enclosing host until Slice 2F-3.

## Exit gate

Accept only after adversarial Rust tests, TypeScript/Rust hybrid tests, hosted
Windows/macOS/Ubuntu gates, and the controlled VS Code read-only regression prove
the bounded lifecycle and preserve existing trusted behavior.