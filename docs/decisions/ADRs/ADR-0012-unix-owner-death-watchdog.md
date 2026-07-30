# ADR-0012: Unix verifier owner-death watchdog

- **Status:** proposed
- **Date:** 2026-07-30
- **Owners:** ForgeEngine maintainers
- **Checkpoint:** 2026-07-30-35
- **Refines:** ADR-0010

## Context

Windows Job Objects already terminate the verifier hierarchy when Forge dies.
Unix process groups only provide supervised cleanup while Forge is alive to signal
the group. macOS has no equivalent parent-owned kill-on-close handle.

This is a lifecycle reliability gap. It is not permission isolation: a trusted
verifier still runs as the developer, and a deliberately hostile verifier can try
to escape ordinary process-group conventions.

## Decision drivers

- killing Forge must not leave an ordinary verifier hierarchy executing;
- the verifier must not start if the packaged watchdog is absent or invalid;
- normal timeout, cancellation, direct-child exit, and output capture must retain
  the accepted `IsolationProvider` contract;
- owner observation must not depend on reusable process IDs or polling a PID;
- Windows behavior must remain unchanged and Ubuntu must keep the same contract;
- the helper must be small, first-party, Rust-owned, and release-packaged;
- the mechanism must not be described as a security sandbox.

## Decision

Forge will package a small Rust watchdog helper for Unix verifier execution. The
Forge owner retains the only write end of a liveness pipe. The helper receives the
read end, starts the verifier in its own inherited process group, mirrors its exit,
and kills that process group if the owner pipe reaches EOF or fails.

The launch sequence is:

1. Resolve the first-party watchdog beside the running Forge binary. A missing,
   non-file, or non-executable helper fails before verifier execution.
2. Create a liveness pipe. The Forge-side writer is close-on-exec; only the
   watchdog inherits the nonblocking reader.
3. Launch the watchdog as the process-group leader with the bounded verifier
   executable and argument vector. It inherits the already-minimized environment,
   working directory, and captured standard-output/error streams.
4. Before starting the verifier, the watchdog proves that its owner pipe is still
   live. It then starts the verifier in the same process group.
5. The watchdog polls the owner pipe and verifier status with a bounded interval.
   EOF, read failure, or owner loss causes `SIGKILL` to the complete group.
6. On ordinary verifier completion, the watchdog mirrors the exact exit code or
   terminating signal. The Forge owner still performs and confirms the accepted
   process-group teardown so late descendants cannot survive.

Pipe EOF is the authority signal because the operating system closes Forge's file
descriptors on process death. This avoids PID-reuse ambiguity and works on macOS
and other Unix targets without importing an Apple-only runtime service.

The helper is lifecycle machinery, not a sandbox.

## Alternatives rejected

- **Keep process groups alone:** they do nothing automatically after abrupt Forge
  death.
- **Use only Linux `PR_SET_PDEATHSIG`:** it is not available on macOS and its
  parent-thread semantics would create different Tier-1 and compatibility models.
- **Poll the Forge PID:** PID reuse creates ambiguity and introduces a race between
  observation and action.
- **Use macOS `kqueue` `EVFILT_PROC`:** it can observe `NOTE_EXIT`, but a pipe
  already provides lifetime-bound EOF, is portable across Unix, and needs less
  platform FFI.
- **Fork a watchdog from the multithreaded Forge process:** post-fork Rust work
  before `exec` is too easy to make unsound.
- **Move ownership into TypeScript or the host:** this would split terminal
  authority and would not protect standalone Forge.

## Consequences

### Positive

- macOS and Ubuntu gain automatic ordinary owner-death cleanup.
- Supervised cleanup and abrupt-owner cleanup use the same process group.
- The parent-liveness signal cannot be confused by PID reuse.
- Rust remains the lifecycle authority and the public isolation contract stays
  host-neutral.

### Negative and limitations

- Forge ships one additional small executable and must diagnose packaging errors.
- Every Unix verifier gains one helper process and a short polling interval.
- There is a small interval between verifier spawn and the watchdog's next EOF
  observation; this is lifecycle cleanup, not execution prevention.
- A trusted verifier that deliberately creates a new session/process group may
  escape this lifecycle mechanism. Preventing that requires the future restricted
  execution backend.
- Kernel panic, machine power loss, filesystem durability, privileges, network,
  credentials, and resource controls are outside this decision.

## Acceptance gate

- the helper is required and validated before a Unix verifier starts;
- killing the Forge owner with `SIGKILL` leaves no live verifier child/grandchild
  on hosted macOS;
- the same owner-death fixture passes on Ubuntu;
- timeout, cancellation, direct-child exit, environment minimization, bounded
  output, and candidate recovery regressions remain green;
- Windows Job Object behavior remains green without using the helper;
- helper startup failure is explicit and occurs before verifier work;
- Rust formatting, warnings-as-errors clippy, tests/build, TypeScript behavior,
  hybrid/MCP conformance, and release packaging pass on Windows/macOS/Ubuntu.

## References

- Apple `setpgid(2)`: https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setpgid.2.html
- Apple `kqueue(2)`: https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
- Apple `Pipe.fileHandleForWriting`: https://developer.apple.com/documentation/foundation/pipe/filehandleforwriting
- Linux `PR_SET_PDEATHSIG(2const)`: https://www.man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html
- ADR-0010
