# Checkpoint 23: verifier environment minimization hosted gate

**Date:** 2026-07-23
**Status:** Increment 2D-0 accepted
**Branch:** `feature/slice-2d-candidate-promotion`
**Accepted implementation:** `1339f5342085ff39492d745bd9971b794eed4fc1`

## Decision checkpoint

Forge verification children no longer inherit the entire Rust kernel environment.
The baseline isolation provider clears the child environment and reconstructs it
from three attributable sources:

1. a small platform/toolchain baseline;
2. fixed name/value pairs in trusted host verification policy;
3. environment names explicitly allowlisted by trusted host policy and present in
   the kernel environment.

Fixed and inherited names must be unique under platform case rules, the combined
policy is capped at 128 entries, names and values are bounded, and an explicitly
inherited but unavailable variable fails visibly before process launch. Values are
never added to the transaction artifact. Verification evidence records
`cleared: true`, inherited names, and fixed names only.

Windows currently preserves PATH, PATHEXT, SystemRoot/WINDIR, ComSpec, temporary
paths, USERPROFILE, APPDATA, and LOCALAPPDATA when present. Unix preserves PATH,
HOME, TMPDIR, LANG, and LC_ALL when present. Repository-specific tool variables
must be policy-allowlisted or fixed.

## Why this is not sandboxing

The verifier retains the Forge process's operating-system identity and can still
read files, use the network, access credentials stored on disk, and spawn child
processes. Environment clearing reduces accidental token/config leakage into
ordinary build and test commands; it does not establish containment.

## Local evidence

The complete `npm run check:hybrid` gate passes on Windows after the change:

- Rust formatting and Clippy with warnings denied;
- 47 active Rust tests, including a private-protocol fixture that places a secret
  and an allowlisted value in the kernel environment;
- 37 TypeScript tests and production build;
- 25 hybrid/MCP checks, including a TypeScript-to-Rust verifier fixture.

Both new fixtures prove PATH and policy values remain usable, the representative
secret is absent, and the returned artifact lists names without values. The
existing timeout/descendant cleanup fixture failed once in an initial full run and
then passed three focused consecutive repetitions plus the subsequent full gate.
This is recorded as test-timing evidence rather than hidden or attributed to the
environment change without reproduction.

## Hosted validation

Exact implementation `1339f53` passed:

- [Cross-platform conformance](https://github.com/celestialcactus/forge-engine/actions/runs/30038561292):
  Windows and macOS TypeScript, build, and packaged read-only CLI;
- [Hybrid kernel conformance](https://github.com/celestialcactus/forge-engine/actions/runs/30038561238):
  Windows, macOS, and Ubuntu Rust, TypeScript, hybrid, MCP, secret-exclusion,
  release build, and process-bridge latency gates.

## Honest remaining boundary

- The Rust kernel process itself still inherits the TypeScript host environment.
- No privilege reduction or Forge-enforced sandbox exists.
- Candidate inspection/promotion and a controlled local surface remain pending.
- MCP remains seven read-only tools.

## Next gate

Implement the Rust-owned restart-safe candidate inspection and all-or-nothing
promotion contract before adding any local command surface.