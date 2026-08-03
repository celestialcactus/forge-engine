# Checkpoint 47: kernel convergence local gate

**Date:** 2026-08-03
**Branch:** `feature/cli-kernel-convergence`
**State:** local implementation complete; hosted and VS Code acceptance pending

## Implemented

- `ForgeRuntime` now names the Rust kernel adapter.
- The former TypeScript product fallback is renamed
  `TypeScriptConformanceRuntime` and requires an explicit
  `typescript_conformance_fixture` service configuration.
- CLI and MCP product entry points require a Rust runtime configuration.
- Kernel discovery checks an explicit configured/environment path, packaged binary
  locations, and source release/debug builds in a deterministic order. An invalid
  explicit path fails closed and does not fall through.
- `forge doctor` performs a bounded `forge.kernel.probe.v1` exchange and reports the
  kernel version plus run, transaction, candidate, and sovereign-change protocol
  versions.
- Node-only MCP tests use a separate conformance entry point; hosted hybrid tests
  exercise the real product CLI and MCP server.

## Local evidence

- `npm run check`: pass; typecheck, 44/44 tests, and production build.
- `cargo fmt --all -- --check`: pass.
- Focused kernel/doctor tests: 5/5 pass, including rejection of a non-Forge
  executable.
- Compiled `forge doctor --json` without a kernel returns exit code 1, `ok: false`,
  the searched paths, `runtime: unavailable`, and the trusted/no-sandbox posture.
- Native Windows Cargo build cannot run on this workstation because the configured
  MSVC toolchain cannot find `link.exe`. This is an environment limitation, not a
  native pass; hosted Windows remains authoritative.

## Still required for acceptance

1. hosted Windows/macOS/Ubuntu Rust, hybrid, product-CLI, and MCP gates;
2. hosted Windows/macOS Node conformance;
3. controlled VS Code seven-tool read-only regression from the exact feature
   branch;
4. post-gate documentation and final completion estimate.
