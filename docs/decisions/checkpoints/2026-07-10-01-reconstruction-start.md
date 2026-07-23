# Checkpoint 2026-07-10-01: Reconstruction start

- **Status:** passed
- **Date:** 2026-07-10
- **Related ADRs:** none yet
- **Scope:** establish a clean architectural boundary before framework selection

## Objective

Confirm that ForgeEngine V1 will be reconstructed independently of the prototype and create a durable decision-record process before new implementation begins.

## Architecture at this checkpoint

No reconstructed production runtime exists yet. The intended architecture has a host-neutral runtime kernel surrounded by inference, capability, policy, context, persistence, delegation, CLI, SDK, and MCP adapters. Standalone, master, apprentice, and embedded operation must traverse the same kernel.

## Changes since the previous checkpoint

- Completed the current-state and plan-reconciliation audits.
- Moved the prototype `src/`, `tests/`, `bin/`, and `scratch/` trees intact to `docs/archive/prototype/`.
- Paused package and framework changes pending architectural review.
- Established this decision documentation process.

## Decisions proposed or adopted

| Decision | Status | Rationale | ADR |
|---|---|---|---|
| Prototype is reference material, not an architectural authority | accepted | Prevent accidental preservation of unvalidated abstractions | ADR pending |
| TypeScript/Node 22 single-package kernel | proposed | Matches developer ecosystem and VS Code integration while minimizing initial packaging complexity | ADR pending |
| SQLite events plus snapshots, filesystem artifacts, derived graph projection | proposed | Balances local operation, transactional resume, inspectability, and future graph evolution | ADR pending |
| MCP is the first VS Code integration surface | proposed | Exercises a portable apprentice boundary before a VS Code-specific extension | ADR pending |

## Validation performed

| Command or experiment | Result | Evidence |
|---|---|---|
| `node --version` | passed: `v22.19.0` | terminal output captured during reconstruction start |
| `npm --version` | passed: `10.9.3` | terminal output captured during reconstruction start |
| `code --version` | passed: VS Code `1.126.0`, x64 | terminal output captured during reconstruction start |
| Repository status inspection | passed | prototype moves and unchanged legacy package metadata verified |

## Failures and surprises

- The Codex patch helper cannot currently enforce the configured split writable roots on this Windows workspace. No package rewrite was accepted as a result; documentation-only recovery is tracked separately from architectural decisions.

## Known limitations

- No reconstructed runtime or validation suite exists.
- Persistence, MCP, CLI, schema, provider, and test-framework choices remain proposed rather than accepted.
- The current root `package.json` still describes the archived prototype and is not a valid V1 manifest.

## Framework and service inventory

No new framework or service has been adopted at this checkpoint.

## Repository state

- Branch: `master`
- Production behavior available: none from the reconstructed V1
- Prototype: retained under `docs/archive/prototype/`

## Next checkpoint

Review ADRs for the TypeScript/Node package shape and the first in-memory runtime slice. Only after acceptance should implementation begin. Persistence and MCP decisions remain separate later checkpoints.
