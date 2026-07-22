# Checkpoint 2026-07-22-14: Hybrid kernel evaluation closure

- **Status:** passed; target architecture accepted, production adoption staged
- **Date:** 2026-07-22
- **Related ADRs:** ADR-0001, ADR-0002, ADR-0006
- **Scope:** SGU-003 closure and SGU-004 handoff

## Outcome

ForgeEngine will use a permanent hybrid architecture. Rust is the target authority
for policy, run state, scheduling, correlation, events, and terminal artifacts.
TypeScript remains the high-velocity integration layer for MCP, IDEs, providers,
compiler intelligence, tools, and workflow definitions.

This is an architecture go, not an immediate runtime cutover. The TypeScript
control remains shipped and remains the differential oracle while Rust adopts
authority in bounded, reversible increments.

## Executable evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Exact evaluated commit | Passed | `a3e220c9e7091a15ed4da19feebcc876e9487374` |
| Hybrid hosted matrix | Passed | [Run 29937948367](https://github.com/celestialcactus/forge-engine/actions/runs/29937948367): Windows, macOS, Ubuntu |
| Existing TypeScript matrix | Passed | [Run 29937948916](https://github.com/celestialcactus/forge-engine/actions/runs/29937948916): Windows and macOS |
| Rust and differential suites | Passed | 8 Rust, 37 TypeScript, and 15 hybrid/MCP tests before push |
| Controlled VS Code apprentice test | Passed | Exactly one Forge summary call; no retry, fallback, terminal, or built-in file search |

The VS Code run returned `run:f21a5d72-9c9d-43e8-9cbe-6c123a2a44f9`, snapshot
`workspace:9417adda28f7c4a9`, 172 files, correct truncation, and this order:
`run.started` -> `context.planned` -> `capability.requested` ->
`approval.decided` -> `capability.completed` -> `run.completed`.

## Accepted boundary

- Rust owns the authoritative record and final policy result.
- TypeScript owns host-specific integration and returns bounded evidence or facts.
- MCP remains the default public apprentice/master interoperability surface.
- A proprietary adapter for an organization harness requires inspection of that
  harness's real contracts first.
- The same kernel must support apprentice, embedded, orchestrating, and future
  standalone CLI modes without separate run semantics.

## Staged limitations

- The one-process-per-run bridge is retained for conformance, not selected as the
  production lifecycle.
- The current spike still accepts a complete TypeScript approval decision.
- Baseline sovereign operation does not yet have Rust-owned workspace, process,
  persistence, transaction, or recovery machinery.
- Native packaging is proven in CI but release signing and reproducibility remain
  future gates.
- The repository still needs an explicit root-license decision before claiming
  complete open-source licensing.

## Next bounded task

SGU-004 separates host/user approval facts from the final Rust policy decision.
It adds no mutation surface and no new MCP tool. Slice 2B production mutation
remains paused until that authority correction passes its differential, host, and
cross-platform gates.