# ADR-0032: platform-native npm packages

- **Status:** Windows local packaging gate accepted; hosted platform publication gates open
- **Date:** 2026-08-10
- **Scope:** CLI ship-lane release packaging and clean installation

## Context

The TypeScript CLI is portable, but Forge's authoritative kernel and Unix process
watchdog are native Rust executables. A source checkout can discover `target/release`
or `target/debug`; an npm installation has neither directory. The original npm
tarball therefore installed a CLI that could not run its authority.

Shipping every architecture in one package would make all users download unrelated
native binaries. A postinstall downloader would move trust, proxy, offline, checksum,
and failure behavior into an installation script. Requiring Cargo would make the
developer install path a build-from-source workflow rather than a product install.

## Decision

1. `forge-engine` remains the universal JavaScript/TypeScript package and declares
   exact-version optional dependencies for one native package per supported
   platform/architecture.
2. Native packages use the names
   `forge-engine-kernel-{win32|darwin|linux}-{x64|arm64}` and declare npm `os` and
   `cpu` constraints in their staged publication manifests.
3. Repository manifests are private templates without `os`/`cpu`, so contributor
   workspace installation remains portable and an empty native package cannot be
   published accidentally. Release staging removes `private`, adds target guards,
   and copies only release executables.
4. The product adapter resolves only the exact package name for the running target,
   requires an exact main/native version match, validates target metadata and the
   executable, and otherwise fails closed. Source-checkout release/debug discovery
   remains a development fallback, not an npm install contract.
5. No postinstall downloader or native build runs during installation. Enterprise
   mirrors can cache and approve ordinary npm artifacts, and offline installation can
   use the same tarballs.
6. A clean-package smoke packs the native and main packages, installs them into an
   empty temporary project with scripts disabled, runs `forge doctor`, then executes
   a real Rust-backed workspace inspection. CI must run this from release binaries.

## Consequences

- A normal install downloads only the current target's native package.
- Package publication becomes a six-target release operation with exact version
  coordination, checksums/provenance, and platform signing requirements.
- The current Windows x64 local smoke proves the contract, not cross-platform
  publication readiness. macOS signing/notarization and hosted x64/arm64 package
  smokes remain release gates.
- The root license decision remains independent and blocking; package metadata must
  be updated consistently after that decision.

## Rejected alternatives

- **One fat package:** simple resolution, but materially larger installs and poor
  mirror/cache behavior.
- **Postinstall download:** adds a second distribution channel and hidden network
  execution during install.
- **Build Rust during npm install:** requires a toolchain and platform build setup,
  making onboarding slow and fragile.
- **JavaScript fallback authority:** creates a parallel runtime and contradicts the
  Rust-authoritative transaction/policy contract.

## Acceptance gates

- clean install in an empty directory needs neither Cargo nor the source tree;
- `doctor` reports `kernel.source=packaged` and exact protocol versions;
- one real kernel-backed operation succeeds from the installed package;
- a missing, wrong-target, or version-mismatched native package fails explicitly;
- Windows and macOS signed artifacts pass hosted x64/arm64 package smokes before
  public alpha promotion.
