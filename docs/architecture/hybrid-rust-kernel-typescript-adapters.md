# Hybrid runtime candidate: Rust kernel and TypeScript adapters

**Status:** accepted target boundary; hosted and VS Code gates passed; production adoption staged
**Date:** 2026-07-22

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
            forge.kernel.bridge.v1 over NDJSON
                         |
                 Rust kernel authority
     validate -> authorize -> schedule -> invoke -> record
                         |
                   RunArtifact v1
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

## Bridge protocol v1

Every message is one UTF-8 JSON object followed by LF. Every message carries
`protocolVersion: "forge.kernel.bridge.v1"` and a caller-selected `requestId`.

### Host to kernel

- `run.start`: the immutable run request, registered capability IDs, and an
  optional pre-start cancellation reason.
- `planner.turn`: a complete output or one capability call in response to the
  kernel's matching planner request.
- `approval.decision`: the spike adapter's approval response for the exact call
  requested by Rust. In the target boundary this message carries user consent and
  host-policy facts; Rust resolves the final Forge policy outcome.
- `capability.result`: bounded adapter evidence correlated to the requested call.
- `run.cancel`: explicit cancellation reason while the kernel awaits an adapter.
- `runtime.error`: a planner, policy, or integration callback failure that Rust
  converts into terminal run evidence.

### Kernel to host

- `run.event`: the next authoritative logical event.
- `planner.next`: the immutable task, context plan, prior capability results, and
  one-based turn number.
- `approval.decide`: the exact capability call requiring a policy decision.
- `capability.invoke`: the approved call and immutable workspace snapshot.
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
- terminal status and failure taxonomy;
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

The current executable spike delegates a complete `ApprovalDecision` to the
TypeScript callback so it can remain differentially compatible with the accepted
TypeScript oracle. That is temporary spike behavior, not permission for a second
production policy engine. Before production cutover, the bridge must separate
external approval facts from the final decision produced by Rust.

TypeScript must not synthesize missing Rust events or repair a malformed artifact.
The host either accepts one schema-valid terminal artifact or records a bridge
failure outside the run.

TypeScript is intentionally the high-velocity product surface. A feature should
remain there when it is host-, compiler-, provider-, or tool-ecosystem-specific.
It moves into Rust only when necessary for authoritative state, baseline sovereign
operation, measured performance, recovery, or process isolation. The architecture
does not pursue a future all-Rust rewrite.

## Compatibility strategy

The accepted TypeScript kernel is the differential oracle for schema version 1.
Canonical fixture artifacts must deep-match structurally, including ordered event
and evidence arrays. The NDJSON bridge is deterministic, but JSON object member
order is not an architectural contract.

The MCP adapter remains TypeScript during SGU-003. Enabling the Rust kernel must
not alter tool names, inputs, compact evidence, complete workspace-relative paths,
run IDs, snapshot IDs, or the six-event single-capability sequence.

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
- stable public schemas beyond bridge v1;
- signed, reproducible multi-target packaging and update delivery;
- mapping the target organization harness after its actual contract is inspected;
- separating host/user approval facts from Rust's final policy result.

SGU-003 may recommend the hybrid direction without pretending these production
questions are already solved.
