# ADR-0006: adopt a Rust kernel with TypeScript adapters

- **Status:** conditionally accepted architecture direction; production cutover not accepted
- **Date:** 2026-07-22
- **Revisits:** ADR-0001 runtime-language choice
- **Blocks:** Slice 2B until SGU-003 closure gates pass

## Context

ADR-0001 selected strict TypeScript on Node.js 22 and required measured packaging,
performance, or isolation evidence before changing the runtime. Slice 1 and Slice
2A now provide a stable behavioral oracle. The longer product direction requires a
native standalone CLI, durable sessions, workspace indexing, process supervision,
and recoverable change transactions.

The question is not whether Rust is fashionable. It is whether one Rust authority
can own Forge's durable and stateful machinery while TypeScript remains a
high-velocity, replaceable integration layer without creating two competing
runtimes.

## Decision

Accept the following ownership split as Forge's target architecture:

- Rust is the sole authority for runtime state, event sequence, context records,
  capability correlation, final policy resolution and approval recording, terminal
  artifacts, and future transactions, process supervision, indexing, and durable
  state.
- TypeScript remains responsible for MCP/IDE presentation, TypeScript semantic
  intelligence, workflow definitions, tool implementations, and fast-moving
  vendor integrations behind a versioned protocol.
- TypeScript adapters may answer planner and capability requests and may supply
  user-consent results or host-policy facts. Rust produces the final Forge policy
  outcome, and no adapter answer becomes run state until Rust accepts and records
  it.
- The accepted TypeScript kernel remains the shipped reference and differential
  oracle until a later explicit production-cutover ADR.
- The standalone sovereign CLI must eventually perform baseline workspace, process,
  persistence, and recovery operations without a mandatory Node sidecar.

This accepts the ownership boundary. It does not accept the spike's
one-child-process-per-run transport as the final production topology.

## Executable evidence

The SGU-003 spike uses Rust 1.97.1, the `forge.kernel.bridge.v1` NDJSON protocol,
and the existing Node.js 22 TypeScript host.

- Eight differential scenarios deep-match the accepted TypeScript artifacts and
  streamed event sequences: success, denial, capability failure, budget
  exhaustion, turn exhaustion, unknown capability, planner failure, and pre-start
  cancellation.
- In-flight cancellation terminates without hanging. Missing and malformed kernels
  fail promptly as supervisor-level bridge errors.
- The official MCP client retains exactly seven tools, the six-event
  single-capability trace, and compact summary/read results below 5 KB.
- A controlled VS Code Agent retest retained exactly seven selected Forge tools,
  made one summary call, returned complete provenance, and did not retry.
- A self-contained Windows `x86_64-pc-windows-gnullvm` release kernel is 880,128
  bytes and runs without LLVM-MinGW on `PATH`.
- Over 50 Windows samples, a fresh Rust process per run measured 15.124 ms p50 and
  20.245 ms p95. The in-process TypeScript control measured 0.041 ms p50 and
  0.168 ms p95. The bridge passes the 500 ms spike ceiling, but the delta supports
  a supervised long-lived kernel for production.
- The accepted TypeScript suite still passes 37 tests; the Rust suite passes eight
  tests; the hybrid suite passes 15 tests locally.

Hosted Windows/macOS/Linux remains mandatory SGU-003 closure evidence.

## Constraints adopted

- No second run, session, event, policy, approval, or transaction model may exist
  in a TypeScript adapter.
- TypeScript may define workflows and implement integration-specific tools; Rust
  owns their authoritative execution state, scheduling, budgets, cancellation,
  policy, and evidence.
- Rust owns baseline sovereign operation; TypeScript is loaded where compiler,
  host, or vendor integration value justifies it.
- The bridge remains private and versioned. Malformed kernel output is never
  repaired by the host.
- Native code does not itself provide an operating-system sandbox.
- Long-lived lifecycle, backpressure, crash recovery, version negotiation, signed
  binaries, and update delivery require bounded follow-on decisions.
- Generated or shared schemas should eventually replace hand-maintained duplicate
  contract types once the behavioral boundary is stable.

## Consequences

- Slice 2B remains paused until SGU-003 closes.
- The accepted Slice 2A branch remains unchanged and is still the shipped control.
- No production mutation capability is introduced by this evaluation.
- MCP distribution is temporarily more complex because the spike requires Node
  plus a native binary. The small native binary does not justify claiming that the
  current MCP package is simpler than Node alone.
- A successful closure authorizes a staged reconstruction, not a flag-day rewrite.
- The target is permanently hybrid, not an eventual all-Rust rewrite. Rust ports
  require an authority, sovereign-baseline, performance, recovery, or isolation
  justification; integration velocity alone favors TypeScript.
- The near-term enterprise adoption path is apprentice-first through MCP and, only
  where necessary, optional adapters for existing central harnesses.
- Public prototype promotion is gated on an explicit open-source license decision,
  complete root license text, and consistent package/Cargo metadata.
- A failed closure leaves the disposable spike branch isolated from Slice 2A.

## Closure and rollback

The authoritative criteria live in
`docs/tasks/SGU-003-rust-kernel-hybrid-evaluation.md`. SGU-003 closes only after
the same commit passes hosted Windows/macOS/Linux and the controlled VS Code test.
If either exposes artifact drift, lifecycle failure, or a tool-call regression,
the spike is rejected or redesigned and Slice 2A remains authoritative.

After closure, production migration must proceed through bounded slices. The
TypeScript control stays available for differential comparison until an explicit
cutover ADR removes it.
