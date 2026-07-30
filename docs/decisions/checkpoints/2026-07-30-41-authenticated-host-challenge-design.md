# Checkpoint 41: authenticated host challenge design

- **Date:** 2026-07-30
- **Status:** implementation gate opened
- **Slice:** 2F-2a
- **Branch:** `feature/slice-2f2-authenticated-host-handshake`

## Plain-language decision

Forge will not turn host-managed execution back on merely because a caller includes
more fields. The host must sign a one-time challenge that names the exact capability
and policy. Forge must persist that the challenge was consumed before it trusts the
result, so restarting Forge or racing two processes cannot reuse the proof.

## Dependency decision

Use `ed25519-dalek` for strict public-key signature verification and `getrandom` for
OS randomness. Do not implement cryptography or pseudo-random nonces locally. Forge
stores public verification keys only. The dependency addition must pass locked
Windows/macOS/Ubuntu builds and later receive the repository's release dependency-
license review.

## Boundary

This checkpoint opens authentication machinery, not containment. A valid signature
means the configured host made the recorded statement. It does not prove the host's
sandbox is effective. Slice 2F-2b wires verified statements to the provider; Slice
2F-3 independently tests Forge-enforced OS controls.

## Rejection conditions

Reject this design if the implementation cannot prove deterministic transcript
bytes, cross-process single consumption, restart replay rejection, strict signature
validation, bounded persistent state, or native Windows/macOS compatibility without
moving authority into TypeScript.