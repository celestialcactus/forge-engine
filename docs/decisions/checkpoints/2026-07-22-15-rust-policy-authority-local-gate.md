# Checkpoint 2026-07-22-15: Rust policy authority local gate

- **Status:** local gate passed; hosted CI and VS Code pending
- **Date:** 2026-07-22
- **Related ADRs:** ADR-0006
- **Task:** SGU-004
- **Branch:** `feature/SGU-004-rust-policy-authority`

## Objective

Remove the remaining policy-authority leak from the SGU-003 bridge without adding
mutation, expanding the seven-tool MCP surface, or porting TypeScript integration
work into Rust.

## Implemented boundary

```text
host UI / organization policy / integration metadata
                         |
          TypeScript ApprovalFactsProvider
       facts + source + exact call correlation
                         |
            forge.kernel.bridge.v2
                         |
        Rust validation and policy resolver
  deny precedence -> consent resolution -> decision
                         |
      approval.decided + structured facts
```

TypeScript can report host posture and user-consent state. Its hybrid runtime API
cannot submit a final Forge approval outcome. Rust validates `schemaVersion`,
`callId`, `capabilityId`, source, and reason fields before resolving the outcome.

## Policy semantics

| Host posture | User consent | Rust result |
| --- | --- | --- |
| deny | any | deny using host-policy reason |
| allow | declined | deny using user-consent reason |
| allow | other | allow using host-policy reason |
| ask | granted | allow using user-consent reason |
| ask | declined | deny using user-consent reason |
| ask | not required or unavailable | ask using host-policy reason |

Malformed, unsupported, empty-provenance, or mismatched-call facts produce terminal
failure evidence before a capability can execute.

## Artifact compatibility

Logical event order and `RunArtifact.schemaVersion` remain unchanged. The
`approval.decided` event gains optional structured `facts`. This is a deliberate,
backward-compatible evidence extension: older artifacts without facts remain valid,
and MCP host projection continues to expose only event sequence/type. New hybrid
and V1 service runs retain the facts that produced their final decision.

## Validation performed

| Gate | Result | Evidence |
| --- | --- | --- |
| Rust formatting and Clippy `-D warnings` | Passed | Full `npm run check:hybrid` |
| Rust policy/runtime tests | Passed | 13 tests total, including five policy matrix tests |
| TypeScript control suite | Passed | 37/37 tests plus typecheck and production build |
| Hybrid differential/MCP suite | Passed | 22/22 tests |
| Exact-call correlation | Passed | mismatched `callId` fails before capability execution |
| Malformed and missing facts | Passed | terminal failed artifact, zero capability results |
| Provider failure and cancellation | Passed | explicit failed/cancelled terminal evidence; no hang |
| Official MCP surface | Passed locally | exactly seven tools; compact projection unchanged |
| Hosted Windows/macOS/Linux | Pending | requires candidate commit and push |
| Controlled VS Code one-call test | Pending | requires rebuilt server on the exact candidate commit |

## Non-goals preserved

- no production apply, shell, or other mutation capability;
- no eighth MCP tool;
- no provider, IDE, workspace, Git, or diagnostics port to Rust;
- no long-lived kernel topology decision;
- no organization-specific harness adapter without the real contract.

## Next gate

Review the complete diff, commit one candidate, run hosted Windows/macOS/Linux on
that exact SHA, then rebuild/restart the VS Code MCP server and repeat the one-call
workspace-summary test. SGU-004 and the Slice 2B gate remain open until both pass.