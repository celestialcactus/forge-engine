# Checkpoint 2026-07-22-15: Rust policy authority accepted

- **Status:** accepted; all closure gates passed
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
| Hosted Windows/macOS/Linux | Passed | hybrid run `29941196756`; all three jobs passed |
| Hosted TypeScript matrix | Passed | run `29941196741`; Windows and macOS passed |
| Controlled VS Code one-call test | Passed | exactly one Forge call; run `run:3a1a9078-ae0d-4391-886a-4edbf75f884f` |

## Non-goals preserved

- no production apply, shell, or other mutation capability;
- no eighth MCP tool;
- no provider, IDE, workspace, Git, or diagnostics port to Rust;
- no long-lived kernel topology decision;
- no organization-specific harness adapter without the real contract.

## Hosted benchmark regression caught during closure

The first hosted hybrid run passed every correctness and conformance stage but
failed the final latency benchmark on all three operating systems. Its fixture
still constructed the bridge with the removed TypeScript `approvalPolicy` input,
so no `ApprovalFactsProvider` was available at runtime. The benchmark now supplies
attributable facts explicitly, and `tsconfig.scripts.json` places benchmark scripts
under the normal TypeScript gate so this constructor path cannot drift silently.

The repaired 20-sample Windows release benchmark measured 15.454 ms p95 against
the 500 ms spike ceiling. Hosted hybrid run `29941196756` then passed on Windows,
macOS, and Ubuntu.

## VS Code acceptance evidence

On candidate `11b45d278dd32691aeed6274d8e33e7016858532`, a fresh Copilot Agent chat
was restricted to Forge tools and asked for exactly one workspace-summary call with
`maxFiles: 20`. It made exactly that call with no retry, terminal, built-in search,
or non-Forge tool. Forge returned snapshot `workspace:d320e09d94cca9ba`, 177 files,
explicit truncation, and the canonical six-event order.

## Next gate

SGU-004 is closed and Slice 2B may resume on a separate feature branch. Rust is
the policy and run-state authority; TypeScript remains the integration layer.
Production mutation still requires its own apply, verification, recovery, and
cross-platform acceptance gates.
