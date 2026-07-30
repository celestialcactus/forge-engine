# Checkpoint 2026-07-30-35: Unix owner-death watchdog start

- **Status:** closed; accepted by Checkpoint 36
- **Date:** 2026-07-30
- **Related ADRs:** ADR-0010, ADR-0012
- **Scope:** Slice 2E-3a abrupt Unix/macOS verifier-owner death
- **Accepted implementation:** `c872a81`

## Starting evidence

- `develop@6a25a51` contains the accepted ChangeSet v2 coordinator.
- Windows already uses a kill-on-close Job Object and passes abrupt-owner tests.
- macOS and Ubuntu use checked process groups for supervised cleanup, but an
  abruptly killed Forge process cannot send the final group signal.
- Apple documents process groups and lifetime-bound pipe EOF; macOS does not expose
  the Linux-only `PR_SET_PDEATHSIG` contract.

## Proposed decision

Package one small Rust Unix watchdog. Forge owns the only liveness-pipe writer; the
watchdog inherits the reader, starts the verifier in its process group, and kills
that group when the owner pipe closes. Missing helper packaging fails before
verifier execution.

## Why this is next

The transaction coordinator is reliable across ordinary process restart, but the
future public CLI would expose a known Tier-1 lifecycle gap if Forge could be killed
while leaving verification running. This gate closes the machinery first.

## Acceptance required

- adversarial owner `SIGKILL` on hosted macOS and Ubuntu;
- no descendant completion marker after bounded observation;
- helper-missing failure before verifier execution;
- existing Windows/macOS/Ubuntu supervised lifecycle regressions;
- complete local and hosted Rust/TypeScript/hybrid/MCP/release gates.

## Known limitations

- lifecycle ownership is not a sandbox;
- deliberate session/process-group escape is not prevented;
- power-loss durability and restricted execution are separate gates;
- the sovereign transaction CLI remains Slice 2E-3b after this increment.
