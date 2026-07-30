# Checkpoint 2026-07-30-36: Unix owner-death hosted and VS Code gate

- **Status:** accepted
- **Date:** 2026-07-30
- **Implementation:** `c872a81`
- **Pull request:** #10
- **Decision:** ADR-0012
- **Tier-1 platforms:** Windows and macOS
- **Compatibility platform:** Ubuntu

## Accepted machinery

Unix verifier execution now runs through the packaged Rust
`forge-process-watchdog`. Forge retains the only writer for an owner-liveness
pipe. The watchdog owns the reader, launches the verifier in its dedicated process
group, and kills that group when owner EOF proves Forge has died.

A separate bounded startup pipe distinguishes “the verifier could not start” from
“the verifier ran and failed.” The watchdog marks both inherited descriptors
close-on-exec before starting the verifier. Forge requires an explicit success
byte within five seconds; failure, malformed status, premature helper exit, or
timeout fails closed and tears down the private group.

This preserves the accepted Windows Job Object path and the existing missing-
verifier recovery contract.

## Hosted evidence

- Hybrid run `30551820932` passed on Windows, macOS, and Ubuntu.
- Cross-platform Node run `30551821183` passed on Windows and macOS.
- Rust formatting, warnings-as-errors Clippy, the full workspace test suite,
  debug/release builds, TypeScript conformance, hybrid/MCP tests, and the latency
  ceiling all passed.
- The hosted macOS and Ubuntu `SIGKILL` fixture proved that the nested verifier
  hierarchy could not write its delayed survivor marker after Forge owner death.
- Windows retained its previously accepted kill-on-close Job Object owner-death
  behavior without invoking the Unix helper.

## Controlled VS Code regression

VS Code exposed exactly seven selected Forge tools. A fresh Agent chat used exactly
one `Forge Workspace Summary` call with `maxFiles: 20` and completed in seven
seconds without terminal, built-in search, retry, artifact externalization, or
mutation.

- run: `run:b0444a8e-66eb-4b25-9a8b-fe7aef40d4de`
- snapshot: `workspace:7b3c009ae89d6632`
- total files: 147
- truncated: true
- events: `run.started` → `context.planned` → `capability.requested` →
  `approval.decided` → `capability.completed` → `run.completed`

## Honest boundary

This closes ordinary inherited verifier lifecycle ownership after abrupt Forge
death. It is not a security sandbox. A trusted verifier can deliberately attempt
to create a new session/process group, and Forge still does not restrict its
filesystem, network, credentials, privileges, or resources in trusted mode.
Restricted execution remains Slice 2F.

## Next gate

Proceed to Slice 2E-3b: compose the accepted Rust transaction/candidate machinery
into one high-level sovereign CLI workflow, including complete candidate cleanup,
without adding generic shell or arbitrary direct-write authority.
