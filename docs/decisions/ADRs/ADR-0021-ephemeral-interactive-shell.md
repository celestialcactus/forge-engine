# ADR-0021: Ephemeral interactive shell over canonical runs

- **Status:** Accepted for CLI ship lane 3
- **Date:** 2026-08-03
- **Scope:** Developer-facing CLI interaction

## Context

The one-shot forge run command proved provider and Rust-kernel machinery, but it
required developers to reconstruct a long command for every task. That is useful
for scripts and acceptance fixtures, not a competitive interactive developer
experience.

Moving the prompt loop into a new agent runtime would undo kernel convergence.
Silently carrying model prose or tool evidence between tasks would also create
untracked memory before Forge has a durable session contract.

## Decision

1. Invoking plain forge starts a thin TypeScript input and presentation shell.
2. Every entered developer task creates a new ProviderTaskPlanner and a new
   canonical Rust-owned run. Tool continuation within that run is preserved.
   Cross-prompt conversation context is not implied or retained.
3. The shell may select an explicit command-line route, a complete
   FORGE_DEFAULT_PROVIDER and FORGE_DEFAULT_MODEL pair, or a locally discovered
   Ollama model, in that order. It never auto-selects a cloud provider.
4. Local discovery is bounded and deterministic. The measured
   qwen2.5-coder:7b family is preferred when installed, then another coder model,
   then the first stable lexical model name. The selected route is always printed.
5. Slash commands are presentation controls only: /help, /status, /model, /clear,
   and /exit. /model changes only the current process. /clear clears presentation,
   not evidence or durable state.
6. forge run remains the non-interactive and JSON automation surface.
7. Startup failures are concise by default. FORGE_DEBUG=1 restores a stack for
   troubleshooting.

## Consequences

- Local developers can build once, run forge, and begin prompting without repeating
  provider and model flags when Ollama has an installed model.
- The shell does not become a second coordinator, policy engine, event log, or
  memory system.
- The current session is intentionally not conversational across prompts. Durable
  resume and inspected conversation state remain recovery-lane work.
- Source checkouts still need a discoverable Rust build or FORGE_KERNEL_BINARY.
  Final bundled installation and default persistence remain release-hardening work.
