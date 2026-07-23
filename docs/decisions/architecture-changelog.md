# Architecture Changelog

This is a concise navigation log. Detailed reasoning belongs in ADRs, audits, and
checkpoint records.

## 2026-07-10

- Audited the preliminary implementation and classified it as prototype/reference
  material rather than an architectural authority. See `docs/audit/`.
- Began a ground-up V1 reconstruction focused on a host-neutral runtime, sovereign
  local operation, deliberate cloud escalation, and interchangeable standalone,
  master, apprentice, and embedded roles.
- Archived the prototype intact under `docs/archive/prototype/`.
- Adopted strict TypeScript on Node.js 22 and the golden-run protocol for ordered,
  deterministic run artifacts. See ADR-0001 and Checkpoint 06.
- Selected append-oriented events/artifacts with SQLite as a later local projection;
  graph storage remains an optional derived projection rather than a V1 authority.

## 2026-07-20

- Adopted the official MCP TypeScript SDK at the host boundary. See ADR-0002.
- Added deterministic repository evidence using Forge-owned file adapters, the
  TypeScript compiler API, and fixed read-only Git commands. See ADR-0003.
- Reached Developer Test Milestone A with seven read-only MCP tools and a controlled
  VS Code test guide. See Checkpoints 07-09.

## 2026-07-22

- Completed the Slice 1 release-gate audit and corrected the competing runtime,
  task-discarding CLI path, search canonicalization, UTF-8 validation, cache-call
  identity, package export, and stale documentation findings. See
  `docs/audit/slice-1-closure-audit.md`.
- Accepted observed connection-scoped snapshot reuse with invalidation, a bounded
  rescan ceiling, and scan-per-call fallback. See ADR-0004.
- Accepted and closed Slice 1 with a single runtime, seven bounded evidence
  capabilities, CLI/MCP/embedded host paths, and explicit scale limitations. See
  Checkpoint 10.
- Began Slice 2 with a service-only, digest-bound, deterministic change proposal;
  no production write or eighth MCP tool was added. See ADR-0005.
- Validated the first Windows worktree/process experiment: worktree edits isolate
  the original workspace, dirty state and ignored dependencies do not transfer,
  and bounded direct-child verification can distinguish timeout and cancellation.
  Worktree isolation is recoverability, not a security sandbox. See Checkpoint 11.

- Added a locked Node 22 conformance matrix for Windows and macOS plus a controlled
  VS Code Slice 2A record. The VS Code boundary retained exactly seven read-only
  tools, with one residual host-only relative-path rendering exception.
- The first platform matrix caught CRLF-dependent evidence hashes on Windows while
  macOS passed. Added a repository LF checkout contract and reran the same commit
  lineage successfully on hosted Windows and macOS. Slice 2A is accepted; apply,
  verify, accept/recover, and rollback remain later Slice 2 gates.

- Paused Slice 2B and opened SGU-003 to evaluate a Rust machinery kernel behind
  TypeScript integration adapters. Local differential, cancellation, official MCP,
  static Windows packaging, latency, and controlled VS Code gates pass; hosted
  Windows/macOS/Linux remains the closure gate. See ADR-0006 and Checkpoint 12.
- Conditionally accepted Rust as the target authority for run state, events,
  correlation, terminal artifacts, and future durable/process machinery. Retained
  TypeScript for MCP/IDE/compiler/vendor integrations and prohibited a permanent
  Node sidecar for baseline sovereign CLI operation.
- Clarified that Forge is permanently hybrid rather than on a path to an all-Rust
  rewrite: TypeScript owns rapid tool, workflow-definition, provider, MCP, IDE,
  and compiler integration, while Rust owns final policy and authoritative
  execution state. Recorded the one-month demo plan, apprentice-first enterprise
  adoption, bidirectional central-harness compatibility, comparative efficiency
  metrics, and the open-source license gate in Checkpoint 13.
- Closed SGU-003 as an architecture go after the exact pushed commit passed the
  Windows/macOS/Ubuntu hybrid matrix, the Windows/macOS TypeScript matrix, and a
  one-call controlled VS Code apprentice test. Production adoption remains staged;
  the spike process topology is not the production lifecycle. See Checkpoint 14.
- Opened SGU-004 to replace the spike's TypeScript-computed approval decision with
  attributable host/user facts and a final Rust-owned policy result before Slice
  2B mutation work resumes.
- Closed SGU-004 with private bridge protocol v2: TypeScript supplies attributable,
  exact-call host/user facts; Rust validates them, applies deny and consent
  precedence, produces the only final decision, and records structured facts in
  the approval event. Local gates, hosted Windows/macOS/Linux hybrid conformance,
  the Windows/macOS TypeScript matrix, and an exact-commit one-call VS Code test
  pass. Benchmark scripts now have their own TypeScript gate after hosted closure
  caught a stale constructor fixture. See Checkpoint 15.
- Began Slice 2B with a Rust-owned candidate transaction contract. An internal
  application manifest now binds exact replacement content to the Slice 2A
  proposal, snapshot, approved capability subject, and policy-named verification.
  Rust alone assigns verified, recovered, cancelled, or failed status and rejects
  malformed adapter evidence. Eleven focused tests and the complete hybrid gate
  pass; the production worktree/process adapter and final promotion remain
  pending. See ADR-0007 and Checkpoint 16.
- Accepted Slice 2B Increment 2B-1 after the exact pushed commit passed the
  Windows/macOS/Ubuntu hybrid matrix, the Windows/macOS TypeScript matrix, and a
  controlled one-call VS Code apprentice test. The production clean-revision
  worktree/process adapter remains Increment 2B-2.
- Accepted Slice 2B Increment 2B-2 after clean-revision, adversarial recovery,
  and descendant-process fixtures passed on hosted Windows, macOS, and Ubuntu,
  the TypeScript matrix passed on Windows and macOS, and a reloaded VS Code Agent
  completed a one-call seven-tool apprentice regression. Promotion and sandbox
  isolation remain separate gates. See Checkpoint 17.
- Accepted ADR-0008 and SGU-005: verification processes now route through a
  Rust-owned isolation-provider contract. `trusted` records no OS containment,
  `host_managed` requires an allowlisted inherited-boundary attestation satisfying
  policy-required controls, and `restricted` fails closed until a Forge-enforced
  platform backend exists. The first hosted run exposed a macOS parallel test-
  fixture name collision; a test-only atomic sequence fixed it. The accepted
  commit passed Windows/macOS/Ubuntu hybrid and Windows/macOS TypeScript matrices.
  See Checkpoint 18.
- Opened draft PR #1 from the direct master-descended Slice 2 branch to replace
  the archived prototype with the validated reconstruction. Added the exact
  current sandbox, host-attestation, inherited-environment, and read-only public
  surface limitations to the build plan.
- Opened Slice 2C on a separate branch. The private host transaction bridge begins
  with a Rust-owned opaque candidate lease and restart-safe discard contract,
  followed by a separate bounded transaction protocol and embedded TypeScript
  adapter. Trusted mode only; host-managed handshake, restricted isolation,
  promotion, transaction CLI, and MCP mutation remain deferred. See Checkpoint 19.
