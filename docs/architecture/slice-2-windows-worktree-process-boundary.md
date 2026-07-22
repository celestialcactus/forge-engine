# Slice 2 worktree/process boundary spike

**Status:** executable candidate validated; production boundary not yet accepted
**Date:** 2026-07-22

## Question

Can Forge apply and verify a proposed change away from the developer's active
workspace on supported desktop platforms while retaining honest, bounded evidence?

This spike evaluates two mechanisms only:

1. a detached Git worktree as a recoverable change boundary;
2. a fixed, shell-free child process as a verification transport.

It does not claim that either mechanism is an operating-system security sandbox.

## Executable evidence

`tests/slice2-boundary-spike.test.ts` creates a temporary Git repository and
worktree, then proves:

- changing the candidate worktree leaves the developer workspace unchanged;
- the worktree begins from the committed revision, not dirty source files;
- ignored local dependencies such as `node_modules` are not available in the new
  worktree;
- a direct child process can run with `shell: false`, a fixed executable and
  argument array;
- combined captured output can be byte-bounded while retaining actual stdout and
  stderr byte counts;
- timeout and caller cancellation can be distinguished in evidence.

The experiment passed locally on Windows on 2026-07-22. The same executable suite
is included in the Windows/macOS hosted conformance matrix. macOS acceptance remains
pending until that hosted job passes.

## Architectural interpretation

A detached worktree is a useful recoverability and review boundary for a clean,
revision-bound proposal. It is not sufficient for a proposal based on dirty or
untracked developer state: the same path in the worktree can have different bytes
from the bytes Forge proposed against. Applying anyway would verify a different
change transaction.

The initial production contract therefore needs an explicit base policy. Reasonable
options are to require a clean, matching revision or to create a separate staged
copy whose content digests exactly match the proposal. Forge must reject or visibly
rebase a mismatch; it must never silently substitute `HEAD`.

Likewise, direct child-process termination proves the basic timeout/cancellation
transport, but not reliable descendant-process termination across supported operating systems. An approved
verification runner still needs a process-tree strategy and policy-selected command
definitions.

## Gates before a mutation surface

- bind the isolation target to repository revision, dirty state, and proposal
  digests;
- decide and test the dirty/untracked workspace policy;
- define dependency/toolchain availability without automatic installation;
- use policy-named verification commands rather than arbitrary command strings;
- terminate or contain descendant processes on timeout/cancellation;
- make worktree creation and cleanup outcomes durable evidence;
- test cleanup failure, stale proposals, failed verification, and cancellation;
- emit the candidate and final diffs and prove the original workspace is unchanged.

Until these gates pass, `workspace.change.propose` remains service-only and the
seven MCP tools remain read-only.
