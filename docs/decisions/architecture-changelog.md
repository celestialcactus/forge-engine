# Architecture Changelog

## 2026-07-30 — Unix owner-death watchdog accepted

- Accepted [ADR-0012](ADRs/ADR-0012-unix-owner-death-watchdog.md) at implementation
  `c872a81`. The packaged Rust watchdog uses owner-pipe EOF, a bounded startup
  acknowledgement, and one dedicated process group; missing/invalid helper and
  verifier startup fail closed without collapsing startup failure into verifier
  failure.
- Hybrid run `30551820932` passed on Windows/macOS/Ubuntu and Node run
  `30551821183` passed on Windows/macOS. Hosted macOS/Ubuntu owner-`SIGKILL`
  fixtures left no survivor marker; Windows retained its Job Object path.
- The controlled VS Code regression exposed exactly seven Forge tools and completed
  one workspace-summary call in seven seconds with no retry or mutation. Core
  completion is now conservatively 86%; candidate cleanup and the sovereign
  transaction CLI remain Slice 2E-3b. See
  [Checkpoint 36](checkpoints/2026-07-30-36-unix-owner-death-hosted-and-vscode-gate.md).

## 2026-07-30 — Unix owner-death watchdog started

- Opened Slice 2E-3a to close the abrupt Unix/macOS verifier-owner-death gap before
  exposing the sovereign transaction CLI. [ADR-0012](ADRs/ADR-0012-unix-owner-death-watchdog.md)
  selects a small first-party Rust watchdog: Forge owns the only liveness-pipe
  writer, the watchdog inherits the reader and verifier process group, and owner
  EOF terminates the ordinary inherited hierarchy.
- Missing or invalid helper packaging fails before verifier execution. This is
  lifecycle reliability, not a sandbox; deliberate process-group escape and
  permission containment remain separate Slice 2F concerns. See the
  [Slice 2E-3a task](../tasks/SLICE-002E3A-unix-owner-death-watchdog.md) and
  [Checkpoint 35](checkpoints/2026-07-30-35-unix-owner-death-watchdog-start.md).
## 2026-07-30 — Durable ChangeSet v2 coordinator accepted

- Accepted [ADR-0011](ADRs/ADR-0011-durable-changeset-v2-coordinator.md) at
  implementation `8c29037`. The Rust-owned manifest, exact before-images, and
  synchronized transition journal passed promotion/rollback fault injection,
  process-restart reconciliation, corruption, cancellation, and divergent-edit
  fixtures.
- Hosted cross-platform run `30511168395` passed on Windows/macOS; hybrid kernel
  run `30511168400` passed on Windows/macOS/Ubuntu.
- The controlled VS Code 1.130 regression used only the seven checked Forge tools,
  made one workspace-summary call, and completed without retries, built-in tools,
  artifact externalization, or a stall. See
  [Checkpoint 34](checkpoints/2026-07-30-34-durable-coordinator-hosted-and-vscode-gate.md).
- Updated the authoritative build plan to 82% core completion. Abrupt macOS owner
  death, complete candidate cleanup, and the sovereign transaction CLI remain the
  Slice 2E critical path; public MCP mutation and restricted execution remain
  Slice 2F.

## 2026-07-29 — Durable ChangeSet v2 coordinator started

- Opened Slice 2E-2 from protected `develop@5a02194`.
- Proposed [ADR-0011](ADRs/ADR-0011-durable-changeset-v2-coordinator.md):
  reuse the Rust-owned ChangeSet v2 contract with a bounded filesystem manifest,
  exact before-images, append-oriented transitions, fresh per-path conflict checks,
  and restart reconciliation.
- Recorded [Checkpoint 33](checkpoints/2026-07-29-33-durable-coordinator-start.md).
- Kept the guarantee explicit: process-crash recovery is in scope; power-loss
  durability, macOS abrupt verifier-owner cleanup, and restricted execution remain
  separate named gates.
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
- Accepted Slice 2C Increment 2C-0 after a Rust-owned opaque candidate lease,
  approved base-revision binding, restart-safe lookup/discard, cleanup-failure
  retry, and replacement-text exclusion passed the complete local gate. The first
  hosted run exposed an Ubuntu advisory-lock release defect; explicit RAII unlock
  corrected it. Exact commit `a985119` passed Windows/macOS TypeScript conformance
  and Windows/macOS/Ubuntu hybrid conformance. See Checkpoint 20.
- Prioritized the honest limitation backlog for the one-month prototype. The
  private transaction bridge is P0; environment minimization, promotion/discard,
  and a thin experimental candidate CLI are P1. Authenticated host handshake and
  high-level MCP mutation are P2; Forge-owned sandboxing, privilege separation,
  and speculative long-lived-kernel work are P3. Generic shell/write tools remain
  architectural non-goals. See Checkpoint 21.
- Implemented the bounded, trusted-only `forge.kernel.transaction.v1` protocol
  and embedded TypeScript transaction adapter without moving policy or terminal
  status out of Rust. Exact implementation `fa9898f` proves verified-candidate
  retention, original-workspace preservation, authority rejection, redacted
  malformed input, and in-flight cancellation with recovery across hosted
  Windows, macOS, and Ubuntu gates. See Checkpoint 22.
- Opened Slice 2D from the accepted Slice 2C checkpoint. Increment 2D-0 clears and
  reconstructs verifier environments from a bounded baseline plus explicit trusted
  policy, records names without values, and proves secret-like variables are absent
  through the real private bridge. Exact implementation `1339f53` passed hosted
  Windows, macOS, and Ubuntu conformance. Candidate promotion remains the next
  Rust-owned gate. See Checkpoint 23.
- Completed the local Slice 2D candidate-loop gate. Rust now owns fresh-subject
  inspection, promotion, exact rollback/restart recovery, and fresh-approved
  discard through `forge.kernel.candidate.v1`; TypeScript is a bounded transport
  and thin `forge candidate` CLI. Windows line-ending tests rejected direct Git
  apply as the byte-authority mechanism, so Git now proves applicability while
  exact verified bytes land through platform atomic replacement with durable
  recovery backups. Two-file partial failure, tamper/extra/missing path, replay,
  divergence, CLI-consent, and seven-tool MCP conformance pass the complete local
  gate. Exact implementation `8693684` passed hosted Windows/macOS/Ubuntu
  conformance. See Checkpoint 24.
## 2026-07-27

- Re-groomed the post-Slice 2D build path around core-runtime reliability. Windows
  and macOS are Tier-1 product/acceptance platforms; Ubuntu remains a compatibility
  gate. Opened Slice 2E for ChangeSet v2, content-addressed staging, transaction
  coordination/recovery, concurrency checks, cancellation, and a complete local
  workflow. See ADR-0009 and Checkpoint 25.
- Assigned previously vague security/integration limits to Slice 2F: authenticated
  host-managed negotiation, policy/audit exchange, a minimum real restricted
  execution backend on Tier-1 platforms, and high-level MCP/VS Code mutation.
  Generic shell and unrestricted write tools remain non-goals.
- Accepted Slice 2E-0 at exact implementation `fd3d9eb`. The Rust-owned ChangeSet
  v2 and bounded content-addressed store use five tagged operation variants to cover
  create, replace, delete, move/rename, mode intent, and binary/text content.
  Adversarial path, identity, bounds, corruption, and concurrent no-overwrite tests
  passed hosted Windows/macOS Tier-1 and Ubuntu compatibility gates. See ADR-0009
  and Checkpoint 26.
- Established `rebuild/master` as the stable reconstruction line and
  `rebuild/develop` as its integration line, both at accepted Slice 2D commit
  `3b2b62f`. Accepted feature checkpoints flow into develop; named stable milestones
  promote develop through a separate PR. The historical default `master` remains
  unchanged. The hybrid workflow now covers feature, fix, and rebuild pushes so
  post-merge integration heads retain the Rust/kernel gate. See Checkpoint 27 and
  the rebuild branch strategy.
- Promoted literal `develop` to the canonical, readily pullable reconstruction
  integration branch from validated commit `8d295b1`. PR #4 merged the transition
  as `b462f335`; that exact `develop` push passed cross-platform conformance on
  Windows/macOS (run `30298569364`) and hybrid kernel conformance on
  Windows/macOS/Ubuntu (run `30298569650`). `rebuild/develop` is frozen at
  `8d295b1` for transition history, while `rebuild/master` remains the stable
  promotion line and historical `master` remains unchanged. See Checkpoint 28.

## 2026-07-28

- Made `develop` the GitHub default and enforced the documented branch model.
  `develop` and `rebuild/master` now require PRs, strict Windows/macOS/Ubuntu
  status checks, and resolved conversations even for administrators; force-pushes
  and deletion are blocked. Historical `master` and transitional
  `rebuild/develop` are locked. Only merge commits are enabled, merged head branches
  are deleted automatically, and CI no longer duplicates topic-push and PR runs.
  See Checkpoint 29.
- Accepted Slice 2E-1a at exact implementation `b930d31`. Rust now derives
  repository-backed path identity and applies the full ChangeSet v2 algebra only in
  an external detached worktree with repeated CAS/base checks, exact per-operation
  evidence, bounded diff evidence, and failure cleanup. Windows/macOS Tier-1 and
  Ubuntu compatibility conformance passed. Active promotion and durable v2
  coordination remain unavailable. The audit also elevated deterministic Windows
  process-tree ownership to a P1 Slice 2E gate after one intermittent `taskkill`
  descendant-cleanup failure. See Checkpoint 30.
- Passed the local deterministic verifier process-ownership gate. Windows now
  creates the verifier suspended, assigns it to a Rust-owned kill-on-close Job
  Object before execution, and confirms the hierarchy is empty after teardown.
  Unix/macOS process-group errors and completion are checked. Five stress passes
  covered 35 nested timeout/cancellation/abrupt-owner hierarchies with no survivor;
  the complete hybrid gate passed. This is lifecycle reliability, not a sandbox.
  Hosted acceptance and abrupt macOS owner-death parity remain open. See ADR-0010,
  the process-ownership task, and Checkpoint 31.
- Accepted deterministic verifier process ownership at exact implementation
  `ff4aedf`. Hosted CI exposed Darwin's distinction between dead zombie descendants
  and an absent process group, plus PID-list/detail races. Forge now uses bounded
  SDK-matched macOS process inspection, accepts only disappeared or kernel-reported
  zombie members, and conservatively retries unknown existing members; live or
  unresolved state still fails closed. Protected Windows/macOS/Ubuntu hybrid run
  `30389805673` and Windows/macOS cross-platform run `30389804363` passed. Abrupt
  Unix/macOS supervisor-death handling remains open. See ADR-0010 and Checkpoint 32.
