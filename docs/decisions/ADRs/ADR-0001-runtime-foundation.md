# ADR-0001: runtime foundation

- **Status:** accepted; consolidated at Slice 1 closure
- **Date:** 2026-07-10
- **Amended:** 2026-07-22

## Decision

Use strict TypeScript on Node.js 22 in one package. The authoritative V1 kernel is
the host-neutral run protocol implemented by `src/slice0/contracts.ts`,
`src/slice0/context.ts`, and `src/slice0/runtime.ts`.

The package exports that implementation as both `ForgeRuntime` and
`Slice0Runtime`; these names refer to the same class. CLI, MCP, embedded callers,
and later provider adapters must adapt this kernel rather than introduce a second
session, event, capability, or policy model.

## Closure amendment

The earliest reconstruction pass created a separate provisional top-level runtime,
session store, capability registry, provider contract, and event vocabulary before
the golden-run protocol was finalized. The Slice 1 audit found that stack was used
only by its own tests and was not the runtime behind CLI/MCP evidence.

Those provisional modules were removed before the Slice 1 commit. Preserving them
would have violated the one-kernel/many-host invariant and forced future features
to choose between incompatible artifact models.

## Validation

- strict typecheck and production build;
- golden traces for success, denial, capability failure, cancellation, and budget
  exhaustion;
- public `ForgeRuntime` identity test;
- real-adapter deterministic trace test with a caller-supplied run ID factory;
- CLI and official MCP-client subprocess conformance.

Revisit the language/runtime choice only if measured cross-platform packaging,
performance, or isolation requirements cannot be met on Node.js.
