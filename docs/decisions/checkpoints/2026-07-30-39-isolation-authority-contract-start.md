# Checkpoint 39: isolation authority contract start

- **Date:** 2026-07-30
- **Branch:** `feature/slice-2f1-host-auth-restricted-contract`
- **Base:** `develop` at `337aea8`
- **Decision:** close the provider/evidence authority gap before selecting a
  Windows or macOS restricted-execution mechanism

## Audit finding

The baseline provider can currently execute a `host_managed` request from an
allowlisted but unauthenticated assertion. The assertion is labeled honestly in
evidence, but the executable path still exists and could be exposed accidentally.

Restricted evidence also lacks a provider capability declaration against which the
core can validate the claimed controls.

## Chosen increment

Require every isolation provider to declare bounded capabilities. Validate them
before launch and validate result evidence against request, policy, and provider
after execution. Restrict the baseline provider to trusted mode.

## Honest boundary

This slice removes an unverified execution path and strengthens future provider
contracts. It is not the authenticated handshake and it is not an OS sandbox.

## Next evidence

The closing checkpoint must record pre-launch rejection, provider-spoof and
control-mismatch fixtures, unchanged trusted behavior, hosted Windows/macOS/Ubuntu
matrices, and the controlled VS Code read-only regression.
