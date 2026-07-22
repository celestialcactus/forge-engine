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
  VS Code test guide. See Checkpoints 07–09.

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
