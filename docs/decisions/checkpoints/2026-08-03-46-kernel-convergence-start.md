# Checkpoint 46: kernel convergence starts from accepted Slice 2F-2b

**Date:** 2026-08-03
**Branch:** `feature/cli-kernel-convergence`
**Base:** protected `develop` at `6bc2bfb`

## What is true now

- Pull request #14 merged Slice 2F-2b into `develop`.
- Post-merge Windows/macOS Node conformance and Windows/macOS/Ubuntu hybrid kernel
  conformance passed.
- Rust owns the accepted run, approval, transaction, host-grant, and artifact state
  machines.
- CLI and MCP still use the TypeScript Slice 0 coordinator when
  `FORGE_KERNEL_BINARY` is absent. Therefore Rust product authority is not yet
  unconditional.
- `trusted` has no Forge-enforced OS containment, `host_managed` depends on an
  authenticated enclosing host, and `restricted` fails closed.

## Decision checkpoint

The immediate code increment closes the product-runtime ambiguity. Native
Windows/macOS restricted execution remains required for broader hardening, but a
credible implementation is too substantial to disguise as a quick core patch. The
trusted developer alpha may proceed only with the limitation visible in effective
configuration and evidence.

## Validation plan

1. unit and hybrid conformance;
2. product CLI smoke using the discovered Rust kernel;
3. missing-kernel fail-closed fixtures;
4. hosted Windows/macOS/Ubuntu gates;
5. controlled VS Code seven-tool read-only regression.
