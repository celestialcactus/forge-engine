# Checkpoint 48: kernel convergence hosted and VS Code gate

**Date:** 2026-08-03
**Branch:** `feature/cli-kernel-convergence`
**Implementation head:** `ca9809f`
**State:** accepted on the feature branch; PR #15 merge pending

## Decision closed

Forge CLI and MCP product entry points now require the Rust kernel. The former
TypeScript coordinator is an explicitly selected conformance fixture, not a silent
product fallback. This closes the product-runtime authority ambiguity identified by
ADR-0017.

## Hosted evidence

- Cross-platform Node conformance run `30839933843`:
  - Windows: pass in 54 seconds;
  - macOS: pass in 33 seconds.
- Hybrid kernel conformance run `30839933999`:
  - Windows: pass in 4 minutes 6 seconds;
  - macOS: pass in 2 minutes 48 seconds;
  - Ubuntu: pass in 1 minute 57 seconds.
- The hybrid jobs cover Rust formatting, lint, tests, release build, TypeScript
  typecheck/build/tests, differential and MCP conformance, automatic CLI kernel
  discovery, product smoke, and the latency ceiling.
- Each hosted job retained its optimized native kernel artifact for seven days.

## Local native-artifact evidence

This Windows workstation does not have MSVC `link.exe`, so it did not compile the
kernel locally. The exact Windows x64 artifact from hosted run `30839933999` was
downloaded into the source-release discovery location instead.

- `forge doctor --json`: pass; runtime `rust-kernel-typescript-adapter`, kernel
  version `0.1.0`, source `source-release`, and all four product protocol versions
  recognized.
- Reported posture: trusted verification, process lifecycle owned, and no
  Forge-enforced OS sandbox.
- `npm run smoke`: pass; Forge run
  `run:4c1137be-9561-42f3-8c7e-02a23b4bcbc5` completed with successful capability
  evidence.

This proves the hosted artifact works in the local TypeScript integration layer. It
does not convert the missing local linker into a local native-build pass.

## Controlled VS Code evidence

The exact feature worktree was opened and trusted in VS Code. MCP cached tools were
reset, the `forge-engine` workspace server was restarted, and Configure Tools showed
exactly seven selected Forge tools with all built-ins disabled.

Prompt:

> Use only Forge tools. Call Forge Workspace Summary exactly once with maxFiles 20.
> Report the Forge run ID, snapshot ID, total file count, truncation status, and
> ordered event sequence. Do not use any built-in tools and do not modify files.

Observed result:

- completion: three seconds;
- calls: exactly one `Forge Workspace Summary` call;
- Forge run: `run:be41c97b-b59e-4eb5-a1aa-2f7bd43b66c5`;
- snapshot: `workspace:866dd8119895837e`;
- workspace files: 277;
- truncation: `true` for the requested 20-file bound;
- events: `run.started` → `context.planned` → `capability.requested` →
  `approval.decided` → `capability.completed` → `run.completed`;
- no built-in tool, retry, externalized artifact, or repository mutation observed.

## Complications found

1. macOS temporary paths may appear under `/var` while the filesystem reports the
   canonical `/private/var` path.
2. Windows synchronous realpath resolution may return a DOS 8.3 alias while a
   different path primitive returns the long path.

Both were test comparison defects. The final fixture uses the same `realpathSync`
primitive as the production resolver; production discovery semantics did not need
to change.

## Honest boundary after acceptance

Kernel convergence is complete, not the standalone Forge product:

- no real local or cloud model inference path exists yet;
- no interactive streaming multi-turn CLI exists yet;
- release packaging and clean-install verification remain open;
- trusted execution inherits developer permissions;
- no Forge-enforced Windows or macOS sandbox exists;
- `restricted` remains fail-closed.

The next ship-lane increment is one measured local provider family plus one direct
cloud provider behind a common streaming/tool-call contract and explicit routing.
It must reuse the accepted Rust run, policy, event, and artifact authority.
