# SGU-003: Rust kernel and TypeScript adapter evaluation

- **Status:** passed; hybrid target accepted, production adoption remains staged
- **Started:** 2026-07-22
- **Base:** `feature/SGU-002-v1-reconstruction-slice-2` at `4900ee0`
- **Spike branch:** `spike/SGU-003-rust-kernel-hybrid-evaluation`
- **Blocks:** Slice 2B and every production mutation capability

## Decision question

Should ForgeEngine move its authoritative runtime machinery from Node.js/TypeScript
to Rust while retaining TypeScript as a replaceable integration layer for MCP,
provider SDKs, TypeScript semantic evidence, and future IDE-specific surfaces?

The spike must answer this with executable parity, host behavior, platform results,
and measured cost. Language preference is not evidence.

## Hypothesis

One Rust authority can improve native distribution, long-lived runtime behavior,
process supervision, durable-state foundations, and future workspace indexing
without sacrificing Forge's existing host interoperability. TypeScript can remain
high-velocity at integration boundaries if it cannot create a second run, event,
approval, policy, session, or transaction model.

## Ownership boundary under evaluation

| Rust owns | TypeScript owns |
| --- | --- |
| run state machine and terminal status | MCP and IDE result presentation |
| event sequence and authoritative artifact | TypeScript compiler/language intelligence |
| context selection record and budgets | vendor SDK translation and streaming adapters |
| capability request/result correlation | workspace capability implementations during the spike |
| approval outcome recording and policy hooks | configuration decoding at host boundaries |
| cancellation state and failure taxonomy | host cancellation/progress translation |
| later event store, transaction, and process supervisor | future VS Code extension UI |

Adapters may produce bounded evidence. They may not become orchestration peers.

## Preserved architectural invariants

1. One kernel serves CLI, MCP apprentice, embedded, and future standalone modes.
2. `RunArtifact` semantics and logical event order remain host-neutral.
3. Capability evidence stays deterministic, bounded, attributable, and inspectable.
4. The existing TypeScript implementation remains an executable reference until
   the Rust implementation passes differential conformance.
5. The seven-tool VS Code surface cannot expand during this spike.
6. No production write, shell, provider, or migration capability is introduced.
7. A native language does not constitute an operating-system sandbox.

## Required spike deliverables

1. A Rust workspace with a reusable kernel crate and a narrow executable protocol.
2. Rust contract and golden-trace tests for success, denial, capability failure,
   budget exhaustion, turn exhaustion, and cancellation.
3. A TypeScript adapter client that executes existing capabilities while Rust
   remains the sole artifact/event authority.
4. Differential tests comparing canonical Rust and TypeScript artifacts.
5. An MCP conformance test proving the TypeScript host adapter can use the Rust
   kernel without changing its public seven-tool result contract.
6. Windows, macOS, and Linux CI for Rust tests, TypeScript tests, and hybrid tests.
7. Startup, protocol overhead, artifact size, and repeated-call measurements.
8. A controlled VS Code test using only the accepted Forge tools.
9. A decision ADR and checkpoint that records gains, regressions, residual risks,
   and the explicit go/no-go result.

## Go gate

Recommend the hybrid pivot only if all of the following are true:

- canonical artifacts and event sequences match the accepted TypeScript contract;
- the TypeScript adapter cannot write authoritative run state;
- MCP and VS Code behavior do not regress or increase tool-call count;
- cancellation and adapter failure remain explicit and terminally consistent;
- Windows, macOS, and Linux pass from clean checkouts;
- the standalone Rust kernel can ship as a self-contained native binary, and the
  production plan removes the Node sidecar from baseline sovereign operations
  instead of claiming that the spike's two-artifact MCP package is simpler;
- measured protocol overhead is acceptable for interactive tool calls;
- TypeScript semantic evidence remains available without embedding a second kernel;
- the resulting component boundary is easier to explain than the TypeScript-only
  architecture it would replace.

## No-go or redesign triggers

- duplicated planners, policies, sessions, or event vocabularies;
- host-visible artifact drift without an intentional schema revision;
- a required Node sidecar for every Forge operation rather than language-specific
  integrations only;
- provider or language adapters gaining mutation authority;
- unreliable process lifecycle or cancellation across supported platforms;
- materially worse developer iteration without compensating runtime evidence;
- a release process that cannot produce signed, reproducible target binaries.

## Non-goals

- completing Slice 2B;
- replacing every TypeScript repository adapter;
- embedding a local model runtime;
- implementing the durable event store or graph projection;
- claiming a security sandbox;
- preserving TypeScript implementation details that are not part of the accepted
  behavioral contract.

## Working rule

Until the gate closes, the TypeScript branch remains authoritative for shipped
behavior and the Rust branch remains disposable. A successful spike authorizes a
planned reconstruction; it is not itself a production migration.

## Closure result

**Go.** Commit `a3e220c9e7091a15ed4da19feebcc876e9487374` passed the
hosted Windows, macOS, and Ubuntu hybrid matrix plus the existing Windows/macOS
TypeScript conformance matrix. The exact pushed branch then passed a fresh
controlled VS Code test with exactly one Forge Workspace Summary call, no fallback
or retry, run `run:f21a5d72-9c9d-43e8-9cbe-6c123a2a44f9`, snapshot
`workspace:9417adda28f7c4a9`, 172 legitimate files, correct truncation, and the
six ordered events.

SGU-003 therefore accepts the permanent hybrid target. It does not accept the
one-process-per-run spike transport as the production lifecycle or make the Rust
path the default shipped runtime. SGU-004 must separate host/user approval facts
from Rust's final policy decision before production mutation work relies on the
hybrid kernel. The TypeScript control remains the differential oracle during that
bounded adoption.
