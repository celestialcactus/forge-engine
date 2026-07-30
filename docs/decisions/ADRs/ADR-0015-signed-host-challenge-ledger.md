# ADR-0015: signed single-use host challenge ledger

- **Status:** accepted for Slice 2F-2a implementation
- **Date:** 2026-07-30
- **Owners:** ForgeEngine project
- **Refines:** ADR-0014 isolation provider capability authority
- **Supersedes:** none

## Context

ADR-0014 requires authenticated host authority before a provider may advertise
`host_managed`. Authentication must bind the host claim to the exact Forge action
and survive process restarts; otherwise a valid proof can be replayed for a
separate capability, policy, or transaction.

Cross-platform peer-credential APIs do not provide one portable identity model for
VS Code, CLI, embedded, MCP, and enterprise hosts. A shared HMAC secret would let
Forge-side code forge host statements. A signed challenge lets Forge retain only a
public key while the enclosing host controls the private key.

## Decision

Forge will implement a versioned Ed25519 challenge/response transcript with:

- an OS-generated 256-bit nonce and bounded expiry;
- provider ID, capability digest, policy digest, and required-control binding;
- a host key ID, boundary ID, inherited-process assertion, and attested controls;
- explicit domain separation and fixed-order length-prefixed fields;
- strict Ed25519 verification with no legacy-compatibility mode; and
- a filesystem ledger that durably records issued and consumed challenges.

Consumption uses a create-new record as the cross-process arbitration point. Forge
writes and synchronizes that record before returning verified evidence. An existing
record is replay. A corrupt record is a fail-closed repair condition, not permission
to retry the authority decision.

The first implementation exposes verified authority evidence but does not itself
launch a host-managed verifier. Slice 2F-2b must compose that evidence into an
executing provider and kernel/host protocol without reimplementing verification in
TypeScript.

## Rejected alternatives

- **Caller-supplied authenticated boolean:** repeats the Slice 2F-1 flaw.
- **In-memory nonce cache:** replay succeeds after restart and races across Forge
  processes.
- **Timestamp-only signatures:** a valid proof remains reusable during its window.
- **Shared HMAC secret:** Forge would possess signing authority intended to belong
  to the host.
- **TLS identity alone:** transport identity does not bind a particular capability,
  policy digest, boundary statement, or one-time consumption.
- **Canonical JSON signatures:** independent serializers can disagree. Hosts sign
  Forge's documented binary transcript instead.

## Consequences

### Positive

- Forge cannot manufacture host signatures from its configured public-key trust
  records.
- A proof is bound to one short-lived challenge and exact action/policy facts.
- Replay rejection survives restart and concurrent processes.
- TypeScript may transport bytes but cannot redefine the authenticated facts.

### Negative

- Host integrations need key provisioning and transcript-signing support.
- Key rotation/revocation and organization policy distribution remain separate
  operational work.
- Filesystem durability is process-crash defensive, not a power-loss guarantee.
- This authentication protocol does not constrain filesystem, network, process, or
  credential access; it only authenticates a host's boundary statement.

## Entry gate for 2F-2b

Proceed only after altered/stale/replayed/cross-capability proofs fail across hosted
Windows/macOS/Ubuntu tests and the consumed evidence can reconstruct the verified
provider, key, challenge, capability, policy, controls, and timestamps.