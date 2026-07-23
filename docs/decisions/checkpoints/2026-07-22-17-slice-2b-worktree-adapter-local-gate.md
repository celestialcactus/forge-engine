# Checkpoint 2026-07-22-17: Slice 2B clean-revision adapter local gate

- **Status:** Accepted
- **Date:** 2026-07-22
- **Related ADR:** ADR-0007
- **Scope:** Private Rust worktree/application/verification/retention adapter

## Outcome

Rust now has a production-shaped private adapter behind the accepted transaction
authority. It creates a detached clean-revision candidate, applies an exact
manifest only there, runs a policy-registered verification check, revalidates the
candidate after verification, and either retains it or removes it.

This does not expose mutation through MCP or CLI and does not promote a candidate
into the active workspace.

## Boundary guarantees

- repository root is canonicalized;
- Git status must be clean and HEAD must equal the expected revision;
- Rust recomputes the Slice 1 path/size snapshot identity;
- every snapshot file must be reproducible from the tracked revision;
- every proposed before digest is checked in both source and candidate;
- candidate storage must be outside the governed workspace;
- Git receives fixed arguments directly, never a shell command;
- only manifest paths are written;
- verification check IDs resolve through a fixed Rust-side registry;
- output, time, and evidence diff sizes are bounded;
- cancellation is polled while verification is running;
- timeout/cancellation terminates the process tree;
- final paths and after digests are checked after verification;
- final diff and retention evidence are recorded;
- failure or cancellation removes and prunes the candidate.

## Acceptance validation

- npm run check:hybrid passed.
- Rust: 1 context test, 11 transaction tests, 5 policy tests, 7 runtime tests,
  and 7 active worktree-adapter tests passed.
- TypeScript: 37/37 tests passed.
- Hybrid/MCP: 22/22 tests passed; the public surface remains seven read-only tools.
- Worktree fixtures cover clean success, dirty state, stale revision, an ignored
  snapshot dependency, missing verifier, failed verifier, timeout, in-flight
  cancellation, verifier-created extra paths, retention, and cleanup.
- The timeout fixture spawns a descendant and proves it cannot write its delayed
  marker after process-tree termination.
- The first Windows run caught Git for Windows rejecting canonical extended-length
  path spelling. The adapter now preserves canonical filesystem paths internally
  and projects ordinary Windows paths only at the Git argument boundary.
- Hosted hybrid conformance passed on Windows, macOS, and Ubuntu for exact commit
  `99357c0` ([run 29947454166](https://github.com/celestialcactus/forge-engine/actions/runs/29947454166)).
- Hosted TypeScript conformance passed on Windows and macOS for the same commit
  ([run 29947453918](https://github.com/celestialcactus/forge-engine/actions/runs/29947453918)).
- After a VS Code window reload, Configure Tools showed exactly seven selected
  Forge tools. A fresh Agent chat made one Forge Workspace Summary call and no
  terminal, built-in file search, retry, or non-Forge tool call.
- The VS Code call returned run `run:455150e2-06e2-4cc1-b5f1-b4073ee1d455`,
  snapshot `workspace:f9e2813c78122442`, 185 files, truncated evidence, and the
  expected six ordered lifecycle events.

## Known limitations


- The adapter is private Rust library functionality; bridge/CLI/MCP wiring is
  intentionally absent.
- A worktree is not an OS sandbox. Policy-owned verifiers retain developer-process
  permissions.
- Crash-durable transaction state and retained-candidate discovery are deferred.
- Final promotion requires a separate fresh-base policy gate.
- The Rust snapshot scan is an exact bounded compatibility implementation, not the
  future indexed workspace service.

## Next gate

Increment 2B-2 is accepted. The next change must separately decide the host-facing
transaction flow and the deferred promotion contract. Do not expose generic write
or shell tools, and do not describe worktree recoverability as security isolation.
