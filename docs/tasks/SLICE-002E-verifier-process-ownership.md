# Slice 2E: deterministic verifier process ownership

- **Status:** Local gate passed; hosted acceptance pending
- **Opened:** 2026-07-28
- **Branch:** `feature/slice-2e-process-ownership`
- **Base:** protected `develop` at `c14edf5`
- **Decision:** ADR-0010
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu
- **Does not add:** a shell, public mutation, privilege reduction, filesystem/network containment, or a `restricted` isolation backend

## Objective

Guarantee that a supervised verifier process tree has one Rust-owned lifecycle and
that timeout, cancellation, direct-child exit, cleanup error, and Windows owner
death cannot silently leave descendants running.

## Scope

1. Replace Windows `taskkill` with a private kill-on-close Job Object.
2. Prevent the spawn/assignment race by creating the verifier suspended, assigning
   it, and resuming only after ownership succeeds.
3. Confirm the Windows job has zero active processes after termination.
4. Preserve pre-exec Unix/macOS process groups, but propagate signal errors and
   confirm the group is absent after teardown.
5. Route early-return cleanup through one owned-process-tree guard.
6. Record platform-specific lifecycle limitations in verification evidence.
7. Add nested-descendant repetition and abrupt Windows owner-death fixtures.

## Acceptance

- no verifier code executes before Windows ownership succeeds;
- no production `taskkill` invocation remains;
- three nested timeout and three nested cancellation trees pass in one focused run;
- five consecutive focused runs pass without a survivor;
- a successful direct verifier exit terminates a still-running nested descendant;
- killing the Windows owner without running cleanup still kills the nested tree;
- the original worktree transaction timeout/cancellation regression remains green;
- cleanup uncertainty returns an explicit error and causes candidate recovery;
- complete local Rust, TypeScript, CLI, MCP, and hybrid gates pass;
- hosted Windows/macOS/Ubuntu gates pass before the increment is accepted.

## Honest boundary

Windows Job Objects provide lifecycle ownership, not a security sandbox. macOS and
Unix process groups cover supervised timeout/cancellation/exit, but they do not
survive an abrupt Forge supervisor death. That parity gap remains P1 before Slice
2E closes. The `restricted` profile still fails closed.