# Checkpoint 80: Windows AppContainer preview conformance

**Date:** 2026-08-11
**Branch:** `codex/transaction-sandbox-hardening`
**Decision:** retain the AppContainer provider as `setup_required`; accept the local
preview mechanism and its tests, not production restricted execution

## Objective

Prove that Forge can compile its existing isolation contract into a real Windows
AppContainer boundary without granting authority to TypeScript, mutating the active
repository, changing external tool ACLs, or claiming readiness from compilation.

## Implemented preview mechanism

- One unique `ForgeEngine.Sandbox.<digest>.<pid>.<sequence>` profile per run.
- A recovery journal is created and flushed before profile/ACL mutation; startup scans
  at most 64 records and retries unique-SID revocation/profile deletion.
- The candidate root receives a non-inheriting read/write/execute grant. Existing
  non-protected top-level entries receive explicit grants, recursive only for safe
  directories. Existing `.git`, `.forge`, `.agents`, and `.codex` are excluded.
- The launcher uses zero AppContainer capabilities, a minimized explicit environment,
  an explicit three-handle list, suspended creation, Job assignment/resource limits,
  and only then resumes untrusted code.
- Cleanup revokes only the disposable SID. Partial cleanup retains the profile and
  journal so a later startup can derive the SID and retry.

## Validation completed

The focused Windows suite passes 9/9:

1. strict profile-name grammar;
2. profile/ACL/journal lifecycle;
3. allowed candidate write;
4. denied outside-candidate and protected-path writes;
5. explicit/minimized environment;
6. requested candidate working directory;
7. Job timeout and cancellation;
8. abandoned profile/ACL journal recovery; and
9. direct loopback denial with zero capabilities.

The tests use Rust `1.97.1-x86_64-pc-windows-gnullvm`. The exact local head also
passes `npm run check:hybrid`: strict Rust format/clippy, the full Rust workspace
test/build gate, 96/96 Node tests/build, and 56/56 executed hybrid tests with seven
explicit `FORGE_KERNEL_BINARY` skips. `cargo audit --deny warnings` scanned 46 locked
dependencies with no advisories, and the staged Windows x64 native-package smoke
selected the packaged kernel and completed a real inspection. Hosted and VS Code
restricted-provider gates remain open.

## Complications discovered

- A recursive root grant plus a package-SID deny ACE was not safe: live testing showed
  protected `.git` content remained writable because the AppContainer SID participates
  as a restricted grant. The implementation was narrowed to positive grants only.
- Rust canonical paths use `\\?\` syntax. Passing that spelling to the child caused
  `cmd.exe` to fall back to `C:\Windows`; the launcher now normalizes only the Win32
  launch/environment representation while the compiled plan retains canonical paths.
- A copied `curl.exe` could not be spawned through an AppContainer `cmd.exe` child,
  so the network test launches the probe directly. This exposed the broader unresolved
  toolchain/dependency projection problem.
- The first aggregate hybrid run found that source discovery preferred a stale
  `target/release` kernel over a newly built debug kernel. Source discovery now picks
  the newest local source binary (while explicit and packaged paths retain priority),
  and a regression plus `forge doctor` prove probe-v3 selection. A second failure was
  an outdated hybrid assertion that omitted the new provider class, availability, and
  limitations; the exact probe-v3 shape is now asserted.
- The follow-up repository audit found that sandbox-plan validation trusted a valid
  self-hash more than the original process semantics. Validation now re-derives exact
  executable, working directory, writable/protected paths, ordered controls, timeout,
  output, and fixed resource ceilings; re-hashed escape/limit/executable regressions
  fail closed. Job creation also moved before process creation, and failed assignment
  now terminates/waits/drains explicitly.
- Recovery-record validation now rejects duplicate or non-compiled protected/grant
  paths. Failure to derive an abandoned profile SID retains the journal rather than
  misreporting cleanup. The full local gate and rebuilt package smoke pass after these
  audit fixes.

## Explicit debt and next gate

Production remains blocked on: policy-owned toolchain/dependency projection; durable
new root-path semantics; credential-channel probes beyond environment; a forced
separate-process owner-death/fault-injection harness; explicit process/memory ceiling
tests; packaged and hosted Windows acceptance; and `doctor` integration. The full
priority list is in [ADR-0033](../ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md).

The preferred enterprise improvement path remains a managed lower-privilege identity,
WFP/firewall policy, and private desktop behind the same provider contract. The
AppContainer preview must not become a parallel transaction runtime or be promoted
merely because its focused suite is green.
