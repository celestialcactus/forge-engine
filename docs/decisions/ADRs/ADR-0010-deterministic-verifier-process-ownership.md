# ADR-0010: deterministic verifier process ownership

- **Status:** accepted for local implementation; hosted acceptance pending
- **Date:** 2026-07-28
- **Owners:** ForgeEngine project
- **Checkpoint:** 2026-07-28-31
- **Refines:** ADR-0008
- **Supersedes:** best-effort Windows `taskkill` process-tree cleanup

## Context

Forge verification already launches one fixed, policy-named process through the
Rust `IsolationProvider`. Unix places that process in a new process group. Windows
previously used `CREATE_NEW_PROCESS_GROUP` and invoked `taskkill /T /F` after a
timeout, cancellation, or direct-child exit. The return status was ignored.

A complete Rust run observed a surviving Windows descendant. Later repeats passed,
but the mechanism did not give Forge an owning kernel handle, could race process
creation, depended on an external executable, and could not guarantee cleanup if
the Forge owner died. This is a core runtime reliability defect, not a request to
claim filesystem/network isolation.

## Decision drivers

- verifier code must not execute before Windows process-tree ownership succeeds;
- descendants inherit the boundary by default;
- timeout, cancellation, direct-child exit, error, early return, and owner death
  must converge on one cleanup mechanism;
- cleanup uncertainty must be an explicit error, never an ignored return code;
- the accepted GNU Rust Windows toolchain must not gain a hidden system dependency;
- macOS/Unix must preserve the same Rust authority and explicit supervised cleanup;
- lifecycle ownership must not be described as a security sandbox.

## Decision

`BaselineIsolationProvider` owns a private `OwnedProcessTree` for every verifier.
All terminal and error paths use that object; its destructor is a final best-effort
backstop for early returns.

### Windows

1. Create a private Job Object and set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
2. Create the verifier with `CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP`.
3. Assign the still-suspended verifier to the Job Object.
4. Enumerate and validate its single primary thread, then resume it.
5. On timeout, cancellation, direct-child exit, or observation failure, terminate
   the Job Object, reap the direct child, and query until `ActiveProcesses == 0`.
6. If Forge is killed, Windows closes its non-inherited job handle and the
   kill-on-close limit terminates the associated hierarchy.

If job creation, configuration, assignment, thread discovery, or resume fails, the
suspended process is terminated and never performs verifier work. No post-spawn
unowned execution window is accepted.

### macOS and other Unix platforms

The verifier remains assigned to a new process group before `exec`. Forge checks
`kill` failures and reaps the direct child. Linux and other supported Unix targets
then poll until the group is absent.

macOS does not use `kill(-pgid, 0)` as its sole completion proof. Darwin may retain
terminated descendants as zombies, and its documented process-group permission
semantics can return `EPERM` when any listed member cannot be signalled. Forge
therefore performs a bounded `proc_listpgrppids` query and reads
`PROC_PIDT_SHORTBSDINFO` for each member. Teardown succeeds only when every listed
member is a zombie or has disappeared; any live, truncated, or uninspectable state
remains an explicit failure. Zombies count as terminated because they cannot
execute, even if `launchd` has not yet collected their process-table records.
Timeout, cancellation, and normal direct-child exit therefore have an explicit
supervised no-live-descendant result on macOS.

A Unix process group does not automatically die when the Forge supervisor is
forcibly killed. A small watchdog/parent-death design remains a separate Slice 2E
gate for macOS parity; this ADR does not hide that difference.

### Dependency

Use target-only Microsoft `windows-sys` 0.59 bindings. The initially evaluated
0.61 line required an external `dlltool.exe` under the accepted GNU Rust toolchain.
That hidden packaging prerequisite was rejected. Version 0.59 supplies the target
import libraries through Cargo and adds no runtime service.

## Alternatives rejected

- **Keep `taskkill`:** external, best-effort, return status previously ignored, and
  no owner-death guarantee.
- **Assign a normally running child to a Job Object:** leaves a race in which the
  verifier can create an unowned descendant before assignment.
- **Add a separate launcher executable:** can provide a handshake but expands the
  package and introduces another runtime/process protocol before it is needed.
- **Replace `std::process` with a complete custom `CreateProcessW` implementation:**
  provides the primary thread handle directly but duplicates command-line,
  environment, standard-handle, and executable-resolution behavior. Suspended
  creation plus documented thread enumeration keeps that surface smaller.
- **Call undocumented NT resume APIs:** rejected in favor of documented Win32
  Toolhelp/OpenThread/ResumeThread functions.

## Consequences

### Positive

- Windows verifier code starts only after process-tree ownership succeeds.
- Descendants are terminated as one kernel-owned hierarchy on supervised cleanup
  and abrupt owner death.
- Cleanup failures become transaction-visible verification failures.
- TypeScript, MCP, CLI, policy, and transaction authority remain unchanged.
- Unix cleanup no longer discards signal errors.

### Negative and limitations

- This does not limit what a trusted verifier may read, write, access, or transmit
  while it runs. `trusted` remains no-containment execution.
- A host job configuration incompatible with nested jobs can cause pre-execution
  assignment to fail closed; `forge doctor` must eventually diagnose this.
- macOS/Unix abrupt-supervisor death is not solved by process groups alone.
- Windows-specific unsafe FFI remains, isolated in one private module with owned
  handles, exact structure sizes, documented call invariants, and adversarial tests.
- Job Objects do not implement the future `restricted` isolation profile by
  themselves; filesystem, network, credential, privilege, and resource controls
  remain Slice 2F/release work.

## Validation gate

Local acceptance requires:

- repeated nested verifier → child → grandchild timeout and cancellation tests;
- successful direct-child exit with a still-running nested descendant;
- Windows owner-process forced termination proving kill-on-close;
- the existing worktree-level timeout/cancellation recovery test;
- no `taskkill` production path;
- Rust format, warnings-as-errors Clippy, full Rust tests/build, TypeScript tests and
  build, CLI/hybrid tests, and unchanged seven-tool MCP conformance.

Hosted acceptance additionally requires Windows and macOS Tier-1 plus Ubuntu
compatibility matrices. macOS proves supervised process-group teardown; it does not
close the separately recorded abrupt-owner-death gap.

## References

- https://learn.microsoft.com/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject
- https://learn.microsoft.com/windows/win32/procthread/job-objects
- https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html
- https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.h
- https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h
- docs/decisions/ADRs/ADR-0008-execution-isolation-profiles.md
- docs/architecture/slice-2-change-transaction.md