# Checkpoint 90: trusted-alpha hosted gate

- **Status:** accepted for merge as a private trusted-developer alpha foundation
- **Date:** 2026-08-18
- **Candidate:** `264e477`
- **Pull request:** #27
- **Scope:** hosted validation of the authoritative trusted-alpha replay

## Exact evidence

- Local exact-head `npm run check:product` passed with Rust toolchain
  `1.97.1-x86_64-pc-windows-gnullvm`: formatting, Clippy with warnings denied,
  Rust/Node/hybrid tests, builds, MCP/product smoke, and exact-version native
  package install/update/uninstall lifecycle.
- Hosted Node run
  [32128145647](https://github.com/celestialcactus/forge-engine/actions/runs/32128145647)
  passed on Windows, macOS, and Ubuntu.
- Hosted hybrid/native run
  [32128145686](https://github.com/celestialcactus/forge-engine/actions/runs/32128145686)
  passed the Rust kernel plus TypeScript adapter on Windows, macOS, and Ubuntu;
  the same run passed the locked RustSec advisory audit.
- The hosted jobs built optimized kernels, proved clean-install native package
  discovery, exercised the product CLI with automatic kernel discovery, and
  enforced the process-bridge latency ceiling.

## Accepted claim

The repository now contains a cross-platform-validated private trusted-alpha
distribution and onboarding foundation. This is sufficient to merge the bounded
release gate and begin configuration-loader and tester-distribution work.

## Non-claims and remaining gates

- `trusted` execution is still not OS containment; the deferred sandbox-provider
  spike is not part of this candidate.
- No npm package or public artifact was published.
- Contributor-rights attestation remains required before public distribution.
- Artifact signing/provenance and the accepted configuration precedence loader
  plus conformance suite remain open.
- CLI8 memory/learning work remains inactive and must be replayed independently.

## Decision

Merge PR #27 if its refreshed documentation-only head retains all required checks.
Do not hold the private trusted alpha for the deferred VM sandbox experiment.
