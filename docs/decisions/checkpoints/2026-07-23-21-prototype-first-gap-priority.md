# Checkpoint 21: prototype-first limitation priority

**Date:** 2026-07-23
**Status:** accepted planning priority
**Branch:** `feature/slice-2c-host-transaction-bridge`

## Decision

Known Forge limitations are now prioritized by their effect on a credible one-month prototype rather than treated as an undifferentiated security backlog.

P0 closes the private Rust/TypeScript transaction bridge and supplies one controlled local invocation path. P1 completes a genuinely useful developer loop: minimize the verifier environment, promote or discard with fresh checks, and expose a thin experimental candidate CLI. P2 covers broader IDE/enterprise adoption: authenticated host handshake, high-level MCP transaction workflow, and any public transaction capability. P3 contains platform sandboxing, privilege separation, and process-topology optimization.

## Why this ordering is honest

A controlled local prototype can use `trusted` execution without an OS sandbox if every artifact says that containment is absent and `restricted` fails closed. It cannot credibly claim a developer change loop if a verified candidate cannot be invoked outside Rust tests or explicitly accepted/discarded.

Environment minimization is pulled ahead of sandboxing because it is comparatively cheap and reduces accidental credential exposure when verification starts running against real repositories. It does not reduce OS permissions and must not be described as sandboxing.

The unauthenticated `host_managed` assertion remains in the internal isolation contract, but the future transaction bridge must reject that mode until an authenticated handshake exists.

## Product-surface guard

Forge will not add a generic shell command, unrestricted file-write tool, or model-authored verifier as a shortcut. A future CLI or MCP mutation path is a thin adapter over the same Rust-owned transaction, promotion, approval, and recovery contracts.

## Fast path

1. private transaction protocol;
2. embedded TypeScript adapter and fixture demo;
3. verifier environment minimization;
4. explicit promotion and restart-safe discard;
5. experimental candidate CLI;
6. controlled VS Code apprentice validation;
7. high-level MCP mutation only if needed for the demo and the lower layers are stable.

OS sandbox backends and enterprise handshake work remain visible, explicit gates rather than hidden omissions.
