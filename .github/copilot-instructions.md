# ForgeEngine V1 contributor guidance

- Treat `docs/architecture/forgeengine-v1-validated-build-plan.md` and accepted
  ADRs/checkpoints as the current architecture authority.
- Treat `docs/archive/prototype/` as historical reference only. Do not restore a
  prototype abstraction solely for compatibility.
- Preserve the one-kernel/many-host rule: CLI, MCP, embedded, and future provider
  adapters must use the same Forge run and artifact contracts.
- Keep evidence deterministic, bounded, attributable, and explicit about
  truncation, cancellation, and enforcement limits.
- Do not add mutation, process execution, network access, provider dependencies,
  storage engines, or security claims without the corresponding slice checkpoint
  and measurable acceptance gate.
- Run `npm run check` before presenting a change as validated.
