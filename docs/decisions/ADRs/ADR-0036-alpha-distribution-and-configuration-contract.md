# ADR-0036: Alpha distribution and configuration contract

- **Status:** accepted
- **Date:** 2026-08-17
- **Owners:** ForgeEngine maintainers
- **Checkpoint:** 89
- **Supersedes:** unresolved release-matrix and configuration-precedence gates
- **Superseded by:** none

## Context

The release lane could not replay its clean-install work until Forge selected a
license, bounded its target matrix, and defined how CLI, environment, workspace,
user, and organization inputs combine.

## Decision

ForgeEngine distributions use Apache-2.0. The root license, npm/Cargo metadata, and
native package templates carry the same SPDX identity. Public release still requires
a maintainer rights attestation and exact dependency/provenance review.

The trusted developer alpha supports Windows x64 and macOS ARM64/x64. Ubuntu x64 is
a compatibility/CI target without an alpha support promise. Windows ARM64 and Linux
ARM64 are deferred. Existing six-target scaffolding may remain, but unaccepted
targets are not published or advertised merely because a template exists.

Effective configuration has two combination rules:

1. Selection values use this precedence: managed facts, explicit CLI, environment
   or secret references, workspace config, user config, built-in defaults.
2. Policy/authority values are the intersection of every applicable ceiling. A
   lower layer can tighten but never relax a managed or user security constraint.

Repository configuration cannot contain secrets. Secrets come from the OS secret
store or explicitly named environment variables, are projected as presence/source
facts only, and are redacted from diagnostics. `doctor` must eventually show each
effective field's source and a stable redacted digest.

## Consequences

- The release lane has a finite hosted/package matrix.
- The configuration model remains convenient without allowing a workspace to weaken
  authority.
- Current runtime behavior does not yet implement the entire precedence contract;
  release acceptance requires tests before claiming it does.
- Signing, notarization, registry ownership, and public rights attestation remain
  separate gates.

## Validation plan

- Package manifests and packed native payloads include matching license metadata and
  root license/notice files.
- Hosted clean-install gates cover the three alpha targets; Ubuntu x64 remains a
  compatibility job.
- Config fixtures prove selection precedence, monotonic policy tightening, secret
  redaction, and effective-source reporting.
