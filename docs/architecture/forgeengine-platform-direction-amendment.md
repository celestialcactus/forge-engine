# ForgeEngine platform direction amendment

**Status:** accepted; takes precedence over conflicting wording in prior V1 plans
**Date:** 2026-07-10
**Applies to:** all ForgeEngine architecture and product planning

## Correction

ForgeEngine is not intended to remain only an integration layer around Codex,
Copilot, VS Code, or any other developer product.

ForgeEngine is a **software-evidence runtime and emerging sovereign developer
platform**. Its initial V1 role is deliberately smaller: prove a useful,
inspectable, sovereign-first developer loop and interoperate cleanly with tools
developers already use. That initial interoperability is a route to adoption and
validation; it is not the ceiling of the product.

The long-term intent is that Forge can stand on its own as a first-party CLI
development platform, comparable in the category of capability to leading coding
harnesses such as Claude Code, Copilot CLI, and Hermes. Forge's distinct direction
is to make its reasoning inputs, tool actions, context decisions, verification, and
local/cloud choices inspectable and controllable.

## Product horizons

| Horizon | Position | What "success" means |
| --- | --- | --- |
| **V1** | Sovereign-first runtime and complementary developer harness. | A developer can complete a bounded, evidence-backed workflow locally or with a deliberate cloud escalation, inspect the trace, and use Forge through CLI or an interoperable host. |
| **Moonshot** | Independently competitive Forge CLI platform. | Forge owns the primary developer task loop: workspace exploration, planning, editing, verification, sessions, skills, context planning, provider selection, and safe execution. It is usable without an IDE-hosted agent. |
| **Starshot** | Sovereign platform beyond the developer workflow. | Forge provides a domain-neutral runtime whose developer capabilities are one pack among many, while preserving local control, portable state, and selective cloud interoperability. |

The moonshot is the product baseline we architect toward. The starshot is a longer
product horizon. Neither authorises speculative V1 scope.

## Operating modes

The same Forge kernel must support all of these modes without changing its core
semantics:

| Mode | Forge's role | Why it matters |
| --- | --- | --- |
| Standalone Forge CLI | Primary runtime and developer interface. | This is the intended moonshot destination, so it is a first-class architectural client from day one. |
| Master/orchestrator | Forge delegates to selected local or cloud model providers and capabilities. | Gives the user a sovereign default and deliberate escalation control. |
| MCP apprentice | Another host invokes Forge's evidence, workflows, and capabilities. | Lets Codex, Copilot, VS Code, and future clients benefit without duplicating the harness. |
| Embedded runtime/SDK | A host incorporates Forge's kernel directly. | Enables product integrations without reimplementing runs, context, state, or verification. |

No integration mode is architecturally privileged over standalone CLI. An external
host may enrich the experience, but the kernel must never require an external
host's private state, prompt format, or proprietary tool semantics to function.

## Adoption sequencing

The near-term enterprise adoption path is apprentice-first. Existing IDE agents,
provider runtimes, and central organization harnesses should be able to invoke
Forge's evidence, local-compute, context, and verification capabilities without
being replaced. MCP is the default public surface; an additional adapter is
justified only after inspecting a target harness whose contract cannot be mapped
cleanly to MCP.

This is a delivery priority rather than an architectural privilege. Forge as an
apprentice and Forge as a standalone or master runtime use the same authoritative
run, policy, evidence, and capability contracts. The product competes by producing
better accepted outcomes, clearer provenance, fewer corrective turns, and more
deliberate local/cloud use—not by forcing developers to abandon a working host.

TypeScript owns the fast-moving host and tool integration layer. Rust owns the
authoritative workflow execution, policy resolution, and evidence machinery.
Organization-specific harness adapters remain optional and must not introduce a
second run model or proprietary semantics into the kernel.

## Architectural consequences

1. **Forge CLI is a first-party host, not a debug shell.** The event protocol,
   session model, capability lifecycle, approvals, and artifact inspection must be
   usable directly by the CLI. MCP and IDE adapters consume these contracts; they
   do not define them.
2. **The developer loop is a product capability.** V1 begins with a narrow
   read-only evidence loop, then a reviewable change-and-verify loop. It must not
   become merely a provider proxy.
3. **No host lock-in inside the kernel.** Host UI state, extension APIs, model
   prompt conventions, and provider SDK objects remain adapters at the boundary.
4. **Provider plurality is strategic.** Local models, cloud models, and future
   remote executors map into the same capability and run contracts. Provider choice
   is observable policy, not hard-coded product identity.
5. **Portable durable state is non-negotiable.** Sessions, evidence, skills,
   workspace snapshots, and verification artifacts must remain intelligible outside
   the originating host. This is what lets a task move from VS Code/MCP to Forge
   CLI or vice versa.
6. **General-platform readiness comes from abstraction discipline.** Keep the
   kernel domain-neutral and ship the developer workflow as a capability pack. Do
   not build a hypothetical consumer platform in V1.

## Revised language for the V1 plan

Replace this prior idea wherever it appears:

> Forge does not try to replace Codex, Copilot, or an IDE.

With this:

> In V1, Forge complements Codex, Copilot, IDEs, and other runtimes. It is
> architected to become an independently capable Forge CLI platform, so none of
> those integrations is a permanent architectural dependency or product ceiling.

## Guardrails against premature platform-building

- V1 may not add a capability simply because a leading CLI has it. It must support
  the current vertical slice and have an acceptance test.
- Build the standalone CLI's shared contracts early, but defer feature parity
  theatre: browser automation, agent teams, marketplaces, background scheduling,
  and broad consumer UX are not V1 prerequisites.
- Evaluate parity by the developer outcome loop—evidence, action, verification,
  persistence, provider choice, and user control—not by a checklist of copied
  commands.
- Keep interoperability real: a developer should be able to begin through an MCP
  host and continue the same attributable session through Forge CLI later.

The concrete one-month delivery and harness-compatibility plan is recorded in
`forgeengine-v1-demo-and-interop-plan.md`.

## Decision

Proceed with the existing Slice 0 build gate. Its event, artifact, context, and
capability contracts are even more important under this clarified direction:
they are the foundation that permits both V1 integration and a future primary Forge
CLI without a second rewrite.
