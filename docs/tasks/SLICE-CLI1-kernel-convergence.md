# CLI ship lane 1: kernel convergence

- **Status:** Local implementation complete; hosted and VS Code acceptance pending
- **Opened:** 2026-08-03
- **Branch:** `feature/cli-kernel-convergence`
- **Base:** protected `develop` at `6bc2bfb`
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu

## User-visible outcome

A source-built Forge CLI or MCP server uses one Rust-owned runtime automatically.
If the kernel is missing, Forge explains exactly what is missing and how to build or
configure it; it never presents the TypeScript conformance coordinator as the
product runtime.

## Scope

1. Add deterministic kernel discovery with explicit provenance.
2. Require a Rust product runtime for CLI and MCP entry points.
3. Rename and isolate the TypeScript coordinator as a conformance fixture.
4. Expand `doctor` with kernel readiness and the effective execution posture.
5. Make product smoke tests exercise the Rust kernel.
6. Preserve the accepted read-only, transaction, host-authority, and evidence
   contracts.

## Non-goals

- local or cloud model inference;
- an interactive multi-turn CLI;
- native Windows/macOS restricted execution;
- MCP mutation;
- packaging the final release binaries;
- context compression, memory, skills, connectors, or automation.

## Exit gate

- no implicit TypeScript production fallback remains;
- local Node checks pass, and local product smoke passes wherever a Rust linker is installed;
- hosted Windows/macOS product checks pass;
- the seven-tool VS Code read-only scenario remains one-call and mutation-free;
- documentation names the trusted-mode limitation and retained restricted work.


## Local implementation checkpoint

The runtime fallback is removed from product entry points, kernel discovery and the
bounded protocol probe are implemented, and Node-only tests explicitly select the
TypeScript conformance fixture. `npm run check` passes 44/44 tests plus build, and
Rust formatting passes. Native Windows compilation remains unproven locally because
this workstation lacks `link.exe`; hosted platform execution and VS Code remain
mandatory. See [Checkpoint 47](../decisions/checkpoints/2026-08-03-47-kernel-convergence-local-gate.md).