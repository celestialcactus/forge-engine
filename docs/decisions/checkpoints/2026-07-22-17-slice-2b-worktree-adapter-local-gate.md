# Checkpoint 2026-07-22-17: Slice 2B clean-revision adapter local gate

- **Status:** Local gate passed; hosted Windows/macOS/Linux and VS Code gates pending
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

## Local validation

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

## Known limitations

- Hosted macOS/Linux/Windows acceptance has not yet run on this checkpoint.
- The adapter is private Rust library functionality; bridge/CLI/MCP wiring is
  intentionally absent.
- A worktree is not an OS sandbox. Policy-owned verifiers retain developer-process
  permissions.
- Crash-durable transaction state and retained-candidate discovery are deferred.
- Final promotion requires a separate fresh-base policy gate.
- The Rust snapshot scan is an exact bounded compatibility implementation, not the
  future indexed workspace service.

## Next gate

Commit and push the exact local-green revision, require the hybrid matrix on
Windows/macOS/Ubuntu and the TypeScript matrix on Windows/macOS, then repeat the
controlled one-call VS Code apprentice test. If all pass, accept Increment 2B-2;
do not call complete Slice 2 until the host flow and deferred promotion boundary
are separately decided.