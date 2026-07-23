# SGU-004: Rust policy authority

- **Status:** accepted; all closure gates passed
- **Opened:** 2026-07-22
- **Closed:** 2026-07-22
- **Predecessor:** SGU-003 passed at `a3e220c9e7091a15ed4da19feebcc876e9487374`
- **Unblocks:** Slice 2B production mutation through the hybrid kernel

## Decision question

Can TypeScript integrations collect user-consent outcomes and host-policy facts
while Rust alone resolves and records Forge's final `ApprovalDecision`, without
changing the public seven-tool MCP contract or creating a second policy engine?

## Why this is next

SGU-003 proved the language and authority boundary, but its differential bridge
temporarily accepts a fully formed TypeScript `ApprovalDecision`. That is useful
test scaffolding, not the target architecture. Leaving it in place would let an
adapter decide whether authoritative work may proceed and would split Forge policy
semantics across languages before mutation is introduced.

## Ownership boundary

| TypeScript may provide | Rust must own |
| --- | --- |
| user consent or decline from a host UI | final allow, deny, or ask resolution |
| host policy facts and provenance | precedence and default-deny behavior |
| integration capability metadata | policy evaluation and reason codes |
| cancellation and timeout signals | authoritative approval event and artifact |

Facts must be descriptive, attributable inputs. They cannot encode a pre-resolved
Forge decision under a different field name.

## Required deliverables

1. Replace the bridge's complete TypeScript approval answer with a versioned,
   validated approval-facts message.
2. Add a deterministic Rust policy resolver that produces the only final
   `ApprovalDecision` and records its reason and source facts.
3. Define deny precedence, explicit-user-decline behavior, unresolved `ask`
   behavior, missing-fact handling, malformed input, cancellation, and timeout.
4. Keep `RunArtifact` and logical event order stable unless a deliberate schema
   revision is separately recorded.
5. Retain the TypeScript runtime as the differential oracle while moving decision
   authority, not provider or IDE integration, into Rust.
6. Add golden/differential fixtures for allow, host deny, user decline, unresolved
   ask, missing or malformed facts, cancellation, and adapter failure.
7. Prove the official MCP surface remains exactly seven tools and repeat the
   controlled one-call VS Code scenario without extra calls or retries.
8. Run the same commit on Windows, macOS, and Linux hosted CI.

## Acceptance gate

SGU-004 passes only if:

- no TypeScript API can submit a final Forge approval decision;
- Rust deterministically resolves every accepted facts combination;
- denial and cancellation cannot be weakened by an adapter;
- artifacts and event order remain compatible or carry an intentional version;
- differential, malformed-protocol, MCP, VS Code, and hosted platform tests pass;
- the default shipped TypeScript path remains available until hybrid production
  adoption is separately approved.

## Non-goals

- adding a production write or shell capability;
- expanding the public MCP tool surface;
- porting workspace, Git, diagnostics, provider, or IDE adapters to Rust;
- implementing organization-wide policy distribution or DLP;
- selecting the long-lived kernel transport;
- designing an adapter for the internal `agents` harness without its real
  contract.

## Rollback rule

If the facts/decision split causes ambiguous policy semantics, artifact drift, or
host regressions, keep the accepted TypeScript runtime as the shipped control,
revert the SGU-004 bridge change, and redesign the private protocol. Do not weaken
the single-authority invariant to preserve the spike implementation.

## Local implementation checkpoint

The implementation now uses private `forge.kernel.bridge.v2`. TypeScript exposes
an `ApprovalFactsProvider`, not an `ApprovalPolicy`, to the Rust runtime. Facts are
schema-versioned, attributable, and correlated to the exact call and capability.
Rust validates and resolves them, then records both the final outcome and the
structured facts in the authoritative approval event.

Decision rules are explicit:

1. host deny wins;
2. otherwise explicit user decline denies;
3. host allow permits;
4. host ask plus granted consent permits;
5. host ask without granted consent remains ask;
6. malformed, unsupported, empty-provenance, or mismatched-call facts fail closed
   before capability execution.

`npm run check:hybrid` passes locally with 13 Rust tests, 37 TypeScript tests, and
22 hybrid/MCP tests. The official MCP client still discovers exactly seven tools.
The exact candidate also passed hosted Windows/macOS/Linux hybrid conformance,
the Windows/macOS TypeScript matrix, and the controlled one-call VS Code scenario.
