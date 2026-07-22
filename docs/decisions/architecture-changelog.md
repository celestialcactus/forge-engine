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
