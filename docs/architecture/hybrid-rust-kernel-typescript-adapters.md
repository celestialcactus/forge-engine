# Hybrid runtime candidate: Rust kernel and TypeScript adapters

**Status:** accepted hybrid boundary; protocol v5 and the governed edit lifecycle are exact-head validated on Windows, macOS, Ubuntu, live Qwen, and controlled VS Code. Protocol v6 / RunArtifact v4 execution budgets are accepted after hosted Windows/macOS/Ubuntu, live Qwen, conservative credentialed OpenAI, and controlled VS Code gates.
**Date:** 2026-07-22
**Updated:** 2026-08-05

## Architectural claim

Forge can use Rust for its authoritative stateful machinery and TypeScript for
fast-moving integrations without becoming a multi-runtime application. The claim
is true only when adapters are subordinate capabilities behind one versioned wire
contract and Rust is the sole producer of authoritative run artifacts.

## Component boundary

```text
VS Code / MCP / future provider SDK / TypeScript compiler
                         |
                TypeScript host adapter
       tools, workflow definitions, presentation,
           provider/compiler/host integration
                         |
            forge.kernel.bridge.v6 over NDJSON
                         |
                 Rust kernel authority
     validate -> authorize -> schedule -> invoke -> record
                         |
                   RunArtifact v4
```

The bridge is a local child-process protocol for the spike. It is not a public
network service and does not introduce a second persistence boundary.

## Why a process protocol

- It keeps the Rust kernel usable by the standalone CLI, MCP, tests, and future
  hosts without a Node ABI dependency.
- It avoids platform-specific native-addon packaging during the architecture test.
- A crashed or malformed adapter can become explicit run evidence instead of
  corrupting kernel memory.
- NDJSON is inspectable and permits byte-level conformance fixtures.
- The same ownership contract can later move to in-process Rust traits, local IPC,
  or another transport without changing run semantics.

FFI/N-API is intentionally deferred. It would optimize a boundary before proving
that the boundary is correct.

## Bridge protocol v6

Every message is one UTF-8 JSON object followed by LF. Every message carries
`protocolVersion: "forge.kernel.bridge.v6"` and a caller-selected `requestId`.
Version 6 adds Rust-owned capability-call and provider-reported token budgets,
exact terminal usage, and fail-closed behavior when an enabled token ceiling
cannot be measured. Version 5 added the Rust-authored capability context/basis
and bounded typed capability evidence. Version 4 added a caller-supplied outcome
contract and Rust-produced assessment, version 3 added normalized inference
evidence, and version 2 replaced adapter-computed approval decisions with
attributable facts. Earlier versions remain historical evidence intentionally
rejected by a v6 peer.

### Host to kernel

- `run.start`: the immutable run request, registered capability IDs, and an
  optional pre-start cancellation reason.
- `planner.turn`: a complete output or one capability call in response to the
  kernel's matching planner request.
- `approval.facts`: versioned host-policy and user-consent facts bound to the exact
  `callId` and `capabilityId` requested by Rust. It cannot carry a final Forge
  decision.
- `capability.result`: bounded adapter evidence correlated to the requested call.
- `run.cancel`: explicit cancellation reason while the kernel awaits an adapter.
- `runtime.error`: a planner, policy, or integration callback failure that Rust
  converts into terminal run evidence.

### Kernel to host

- `run.event`: the next authoritative logical event.
- `planner.next`: the immutable task, context plan, prior capability results, and
  one-based turn number.
- `approval.facts.request`: the exact capability call plus Rust-authored prior
  capability context requiring host and user facts.
- `capability.invoke`: the approved call, immutable workspace snapshot, and the
  same Rust-authored prior capability context.
- `run.result`: the terminal authoritative `RunArtifact`.
- `protocol.error`: malformed or out-of-state bridge input. If a run exists, the
  error must also become terminal run evidence.

The spike supports one active run per process. Concurrency belongs in a later
long-lived kernel service only after request isolation and backpressure are tested.

## State ownership

Rust owns:

- logical sequence numbers;
- context plan construction;
- maximum-turn enforcement;
- final policy evaluation, enforcement, and decision recording;
- workflow execution state, scheduling, budgets, and cancellation;
- capability request/result correlation and ordering;
- the only transition from adapter answers to run state;
- lifecycle status and failure taxonomy;
- outcome-contract validation and the only authoritative outcome assessment;
- final artifact serialization.

TypeScript owns:

- spawning and supervising the spike kernel process;
- translating `AbortSignal` into `run.cancel`;
- planner/provider calls requested by Rust;
- collecting user-consent results and host-policy facts when Rust requests an
  approval input;
- workflow definitions and rapidly changing orchestration integrations;
- workspace, Git, TypeScript, and other integration-specific capabilities;
- MCP schemas and compact host presentation.

The executable SGU-004 boundary accepts only `ApprovalFacts` from TypeScript. Rust
validates schema version, non-empty provenance, and exact call/capability identity;
applies host-deny and user-decline precedence; resolves `ask`; and produces the
only final `ApprovalDecision`. The authoritative `approval.decided` event retains
those structured facts as an optional backward-compatible evidence extension.
The approval-facts meaning is retained. RunArtifact v4 retains the v3 compact
`CapabilityContextBasis` on each approval event and optional bounded typed
capability evidence on results, and adds the applied `ExecutionBudget` and exact
`ExecutionUsage`. v3 and older artifacts are not accepted as current bridge
results. Capability calls are stopped before an over-budget admission; provider
responses are recorded before token-overage termination, so token limits control
continuation rather than pre-empting an in-flight request.

The product approval profile is an integration adapter over this same boundary,
not another policy engine. `developer`, `review`, and `locked` select attributable
host-policy/user-consent facts. A review callback receives the exact call plus the
Rust-authored `CapabilityContext`; a missing callback produces unavailable consent
and remains `ask`/no-invoke. Rust still validates, resolves, emits the decision,
and controls invocation. MCP cannot print interactive questions over its stdio
transport, so review without a future host handshake remains deliberately
fail-closed. Governed ChangeSet candidate and promotion decisions bind different
subjects and remain separate.

`RunStatus.completed` records that the planner produced a valid terminal turn. It
does not certify that the developer objective was achieved. When a caller supplies
a valid `OutcomeContract`, Rust evaluates its deterministic requirements and emits
`outcome.assessed` immediately before `run.completed`. Without a contract the
artifact says `not_evaluated`; a failed requirement says `unmet`. `verified` means
only that the recorded contract requirements passed, not that every model sentence
is true.

TypeScript must not synthesize missing Rust events or repair a malformed artifact.
The host either accepts one schema-valid terminal artifact or records a bridge
failure outside the run.

TypeScript is intentionally the high-velocity product surface. A feature should
remain there when it is host-, compiler-, provider-, or tool-ecosystem-specific.
It moves into Rust only when necessary for authoritative state, baseline sovereign
operation, measured performance, recovery, or process isolation. The architecture
does not pursue a future all-Rust rewrite.

## Compatibility strategy

The TypeScript conformance runtime is the differential oracle for RunArtifact
schema version 4; it is not a selectable product runtime.
Canonical fixture artifacts must deep-match structurally, including ordered event
and evidence arrays. The NDJSON bridge is deterministic, but JSON object member
order is not an architectural contract.

The MCP adapter remains TypeScript during SGU-003. Enabling the Rust kernel must
not alter tool names, inputs, compact evidence, complete workspace-relative paths,
run IDs, snapshot IDs, or the seven-event single-capability sequence.

## Failure and cancellation rules

- EOF before a terminal artifact is a bridge failure, never success.
- A TypeScript callback failure is returned as `runtime.error`; Rust emits the
  terminal `runtime_error` run evidence.
- Invalid kernel output or an early child exit is a supervisor-level bridge
  failure because the authority can no longer produce a trustworthy artifact.
- Adapter capability failure is a failed `CapabilityResult`; it does not corrupt
  the run or bridge.
- Cancellation wins while the kernel awaits a planner turn or capability result
  and emits one `run.cancelled` event.
- Cancellation after `run.result` cannot change the completed artifact.
- A host process kill is outside the artifact because the authority can no longer
  emit; the TypeScript supervisor must report that transport failure separately.

## Executable evaluation result

The local Windows spike established the boundary, not a production cutover:

- eight success/failure/cancellation scenarios produced deep-equal Rust and
  TypeScript artifacts and identical streamed event sequences;
- the official MCP client discovered the same seven tools and retained compact
  summary/read results below 5 KB;
- a controlled VS Code Agent run with exactly seven selected Forge tools completed
  with one summary call, all requested provenance, and no retry or recovery loop;
- in-flight cancellation terminated without a hang, while missing and malformed
  kernels failed promptly;
- the statically linked `x86_64-pc-windows-gnullvm` release binary is 880,128
  bytes and runs without an LLVM-MinGW runtime directory on `PATH`;
- over 50 Windows samples, a fresh Rust process per run measured 15.124 ms p50
  and 20.245 ms p95, versus 0.041 ms and 0.168 ms for the in-process TypeScript
  control. This is acceptable for the spike's 500 ms ceiling but argues for a
  supervised long-lived kernel before high-frequency production workloads.

The result is an architecture go. Commit
`a3e220c9e7091a15ed4da19feebcc876e9487374` passed clean hosted Windows,
macOS, and Ubuntu hybrid conformance, and the exact pushed branch passed the
controlled one-call VS Code apprentice test. It proves that Rust can be the sole
run authority behind TypeScript integrations. It does not prove that today's
Node-plus-native MCP package is simpler to distribute than Node alone or accept
the spike transport as the production lifecycle.

Protocol v4 and RunArtifact v2 were subsequently accepted at `be2069a`. Actions
run `30922337824` passed the Rust/TypeScript product boundary on Windows, macOS,
and Ubuntu; run `30922333249` passed the Node surface on Windows and macOS. The
exact hosted Windows kernel passed 39/39 local hybrid tests and product smoke. A
fresh trusted VS Code chat used one Forge call and reported `outcome.status` as
`verified` after the MCP adapter renamed mechanical lifecycle to `runStatus`.

## Sovereign CLI constraint

The final architecture must not require a Node sidecar for every Forge operation.
The Rust standalone path must eventually own baseline workspace indexing, process
supervision, event persistence, and transaction recovery. TypeScript is loaded
only for integrations where it creates clear value, such as TypeScript compiler
semantics, IDE presentation, or vendor SDKs. If the production design cannot meet
that constraint, the bridge must be redesigned rather than normalized as permanent
two-runtime overhead.

## Apprentice-first interoperability

Enterprise adoption is expected to begin primarily by exposing Forge as an MCP
apprentice to an IDE or central agent harness. Forge may also consume tools from
that harness. Both directions terminate at the same Rust capability and evidence
contracts; a host adapter cannot create a separate run, approval, or workflow
state model.

MCP is the first public compatibility surface. A proprietary harness adapter is
optional and justified only by a measured contract gap. Delegated calls carry
origin, delegation ID, depth, budget, cancellation, and idempotency so recursive
master/apprentice relationships cannot silently loop or expand authority.

See `forgeengine-v1-demo-and-interop-plan.md` for delivery gates and comparative
harness metrics.

## Production questions deliberately left open

- long-lived kernel lifecycle and multi-run concurrency;
- crash recovery and durable append-before-notify event storage;
- binary discovery, updates, signing, and compatibility negotiation;
- provider streaming and partial-result semantics;
- process-tree containment and sandbox backends;
- whether the MCP adapter should eventually move into Rust;
- stable public schemas beyond the private bridge-v2 and RunArtifact-v1 boundary;
- signed, reproducible multi-target packaging and update delivery;
- mapping the target organization harness after its actual contract is inspected.

SGU-003 accepted the hybrid direction, and SGU-004 locally corrected the policy
boundary. Neither result pretends these remaining production questions are solved.
