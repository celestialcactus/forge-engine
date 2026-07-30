# Slice 2E-3a: Unix verifier owner-death watchdog

- **Status:** Accepted at `c872a81`; merge pending through PR #10
- **Opened:** 2026-07-30
- **Branch:** `feature/slice-2e3-owner-death`
- **Base:** protected `develop` at `6a25a51`
- **Decision:** ADR-0012
- **Acceptance evidence:** Checkpoint 36; hosted runs `30551820932` and
  `30551821183`
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu
- **Does not add:** a sandbox, public mutation, generic shell, privilege reduction,
  or a TypeScript lifecycle authority

## Objective

If Forge is forcibly terminated while a verifier tree is running, macOS and Ubuntu
must automatically terminate the ordinary inherited verifier hierarchy just as
Windows already does through its Job Object.

## Scope

1. Package one small first-party Rust watchdog binary.
2. Resolve and validate it before Unix verifier execution.
3. Use a parent-owned close-on-exec liveness pipe rather than PID polling.
4. Run the watchdog and verifier in the same dedicated process group.
5. Require a separate bounded startup acknowledgement so launch failure cannot be
   misreported as verifier failure.
6. Mirror verifier exit status while preserving bounded output and environment.
7. Kill the group on owner EOF/read failure and retain supervised teardown.
8. Add abrupt-owner, missing-helper, and existing lifecycle regressions.

## Acceptance

- hosted macOS `SIGKILL` owner-death fixture leaves no surviving marker;
- Ubuntu passes the same fixture;
- Windows retains its accepted Job Object owner-death test;
- missing or invalid helper fails before verifier execution;
- normal verifier success, failure, timeout, cancellation, output, and environment
  behavior remains unchanged;
- the helper is present in debug and release workspace builds;
- all protected Windows/macOS/Ubuntu matrices pass.

## Accepted evidence

- Hybrid run `30551820932` passed on Windows, macOS, and Ubuntu.
- Node conformance run `30551821183` passed on Windows and macOS.
- Hosted macOS and Ubuntu owner-`SIGKILL` tests left no survivor marker.
- Missing, non-executable, and missing-verifier startup paths failed before verifier
  work and preserved the existing recovery distinction.
- A controlled VS Code regression exposed exactly seven Forge tools and completed
  one workspace-summary call in seven seconds with no retry or mutation. See
  Checkpoint 36 for the run and snapshot IDs.

## Honest boundary

This owns an ordinary inherited process group. It does not prevent a trusted
verifier from deliberately escaping through a new session, and it restricts no
filesystem, network, credential, privilege, or resource access. Those are Slice 2F
restricted-execution concerns.
