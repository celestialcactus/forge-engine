# ADR-0014: isolation provider capability authority

- **Status:** accepted for Slice 2F-1 implementation
- **Date:** 2026-07-30
- **Owners:** ForgeEngine project
- **Supersedes:** baseline `host_managed` execution in ADR-0008
- **Refines:** ADR-0008 and ADR-0010

## Context

ADR-0008 deliberately labeled host-managed evidence as an unverified assertion
pending a real host handshake. Leaving that private conformance path executable
while Forge exposes a public sovereign CLI would make the boundary too easy to
misread or accidentally publish.

The same provider trait is intended to support future Windows/macOS restricted
backends, but it does not currently expose the profiles and controls a provider is
prepared to defend.

## Decision

`IsolationProvider` must expose a validated capability descriptor before it may
execute:

- a stable provider ID;
- the supported isolation profiles;
- whether host-managed claims are authenticated by the provider; and
- the restricted controls the provider can enforce.

Forge validates provider support before launch. Returned evidence is accepted only
when its provider, profile, enforcement provenance, boundary, and controls are
consistent with the request, policy, and descriptor.

The baseline provider advertises `trusted` only. `host_managed` becomes unavailable
until an authenticated host provider exists. `restricted` remains unavailable
until a platform backend passes its adversarial gate.

## Rejected alternatives

- **Keep allowlisted raw host assertions:** an allowlist authenticates neither the
  caller nor the boundary claim.
- **Let adapters label evidence:** this moves security truth into TypeScript or a
  host integration and creates competing policy authority.
- **Implement a nominal sandbox immediately:** Windows and macOS require different
  mechanisms and escape tests; selecting one before the provider contract is
  stable would couple platform machinery to an ambiguous evidence model.

## Consequences

- Existing private host-managed success fixtures become fail-closed fixtures.
- The trusted prototype keeps working with no new user ceremony.
- Future host and restricted backends have a small, testable Rust contract.
- This change improves truthfulness but does not itself provide containment,
  cryptographic host identity, freshness, replay resistance, or privilege
  reduction.

## Acceptance

- descriptor validation rejects duplicates, empty identities, incoherent profile
  claims, unauthenticated host support, and restricted controls without restricted
  support;
- preflight rejects unsupported profiles before verifier launch;
- evidence validation rejects provider spoofing and missing/unadvertised controls;
- all accepted trusted-mode behavior remains green across supported platforms.
