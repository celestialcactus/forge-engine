# ADR-0001: runtime foundation

- **Status:** accepted for Slice 1 history; product authority superseded by ADR-0017
- **Date:** 2026-07-10
- **Amended:** 2026-07-22 and 2026-08-03

## Decision

Use strict TypeScript on Node.js 22 in one package. The authoritative V1 kernel is
the host-neutral run protocol implemented by `src/slice0/contracts.ts`,
`src/slice0/context.ts`, and `src/slice0/runtime.ts`.

At Slice 1 closure the package exported that implementation as both `ForgeRuntime`
and `Slice0Runtime`; those names referred to the same class. ADR-0017 later made the
Rust kernel the product authority and retained the TypeScript coordinator only as
`TypeScriptConformanceRuntime`. The one-session/event/capability/policy-model intent
is unchanged.

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
