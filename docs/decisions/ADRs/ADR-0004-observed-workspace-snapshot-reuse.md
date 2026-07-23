# ADR-0004: observed workspace snapshot reuse with bounded rescans

- **Status:** accepted
- **Date:** 2026-07-21
- **Owners:** ForgeEngine project
- **Checkpoint:** 2026-07-22-10
- **Supersedes:** the Slice 1 scan-per-settled-call implementation
- **Superseded by:** none

## Context

Developer Test Milestone A showed that a multi-tool host task can trigger repeated
complete workspace scans. Concurrent calls were coalesced, but every later call
rescanned the same tree. This is Forge-owned overhead even when extra tool selection
is caused by the host.

A cache based only on time can be stale. Native filesystem notifications can also
be delayed, coalesced, or unavailable. The optimization therefore needs a visible
safe fallback and a bounded stale window rather than an absolute freshness claim.

## Decision drivers

- reduce repeated Forge-owned traversal across adjacent MCP calls;
- preserve canonical scans as the source of workspace truth;
- avoid indefinitely stale caches after missed notifications;
- behave safely on platforms without recursive observation;
- handle invalidation races deterministically;
- expose metrics for tests without polluting deterministic run events.

## Options considered

### Scan every settled call

Always fresh at scan completion and simple, but repeats full traversal for ordinary
multi-tool tasks.

### Time-only reuse

Portable and simple, but every external edit remains invisible until expiry.

### Observer-only reuse

Fast invalidation in normal operation, but missed or unavailable notifications can
leave evidence stale indefinitely.

### Observer plus bounded rescan

Use notifications as the fast path, impose a maximum reuse interval, and disable
settled reuse when observation cannot be established.

## Decision

Use a connection-scoped `WorkspaceSnapshotCache`.

- Relevant filesystem events increment a generation and invalidate settled evidence.
- A settled snapshot is reusable for at most 5,000 milliseconds.
- Unsupported or failed observation uses scan-per-call behavior.
- Concurrent calls in the same generation share one scan.
- A call after invalidation never joins an older in-flight generation.
- Ignored snapshot roots such as `.git`, `.forge`, `dist`, and `node_modules` do not
  invalidate workspace-file evidence.
- Closing an embedded or MCP service closes observation and disables settled reuse.

This is an efficiency and consistency mechanism, not an operating-system isolation
boundary and not a claim of perfect point-in-time snapshots.

## Consequences

### Positive

- Adjacent host calls stop repeating complete workspace traversal.
- Missed events cannot make the cache indefinitely stale.
- Unsupported watcher environments preserve correctness by doing more work.
- Scan, reuse, invalidation, and freshness-mode metrics are directly testable.

### Negative

- Evidence may still reflect a snapshot taken shortly before an unobserved edit,
  bounded by the rescan ceiling.
- Filesystem observation adds lifecycle and race handling.
- Snapshot identity still does not hash all workspace content.

### Risks and mitigations

- Missed event: bounded periodic rescan.
- Watcher failure: switch to scan-per-call and invalidate the prior generation.
- Edit during scan: do not cache a generation invalidated during that scan.
- Reuse after close: close clears the subscription and settled entry.
- Host repeats equivalent tools: measure separately; Forge cannot control host
  planning through a cache.

## Validation plan

- settled adjacent calls reuse one scan;
- explicit invalidation forces a new scan;
- the rescan ceiling forces a new scan without an event;
- unavailable observation scans every settled call;
- invalidation during an active scan creates a distinct fresh scan;
- full MCP and runtime suites remain green.

## Revisit or replacement conditions

Replace or extend this design when an indexed workspace service proves lower
latency and stronger change detection on representative large repositories, or when
a host supplies a trustworthy workspace generation token.

## References

- `docs/architecture/slice-1-read-only-repository-intelligence.md`
- `docs/audit/slice-1-closure-audit.md`
- `tests/slice1-workspace.test.ts`
