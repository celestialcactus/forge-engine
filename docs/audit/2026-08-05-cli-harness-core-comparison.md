# CLI harness core comparison: ForgeEngine, Codex, Claude Code, Copilot CLI, and Hermes

**Snapshot date:** 2026-08-05  
**Purpose:** product and architecture calibration for the ForgeEngine developer alpha  
**Evidence rule:** Forge claims come from the repository and accepted gates. Competitor claims come only from first-party documentation or first-party repositories. Missing public documentation is recorded as unknown, not absence.

## Straight answer

Forge has a credible and unusually strict **narrow core**, but it is not yet as strong as the mature CLI products as a whole.

The strongest parts are the canonical Rust lifecycle, ordered evidence artifacts, digest-bound capability context, and durable verified-change transaction. Those are real differentiators, especially for an apprentice or embedded runtime. The weak parts are equally real: no clean standalone installation, no outer run/conversation recovery, no Forge-enforced OS sandbox, a small capability surface, no MCP client or skill/memory system, no central policy distribution, and very little field exposure compared with the established products.

A useful calibration is:

| Scope | Current confidence | Honest meaning |
| --- | ---: | --- |
| Rust lifecycle and verified local-change machinery | 8 / 10 | Strong design and adversarial fixtures; 5B Rust and hybrid parity now pass hosted Windows/macOS/Ubuntu. It still lacks power-loss coverage for the outer run. |
| Standalone CLI product | 5 / 10 | Live Ollama/OpenAI, an interactive loop, and explicit developer/review/locked profiles work, but installation, session resume, and general developer-tool breadth are not alpha-grade yet. |
| Enterprise-ready harness | 3 / 10 | The contracts point in the right direction, but distribution, sandboxing, administration, durable audit export, and operating evidence are unfinished. |
| Overall parity with mature CLI harnesses | 4 / 10 | Forge is ahead in a few narrow evidence/transaction semantics and behind across most product surfaces. |

These scores are engineering judgment, not benchmark results. Completing a narrow
approval-profile seam does not by itself raise the overall parity score; recovery,
packaging, capability breadth, containment, and field evidence still dominate it.

## Comparison matrix

| Capability | ForgeEngine now | Codex CLI | Claude Code | GitHub Copilot CLI | Hermes Agent |
| --- | --- | --- | --- | --- | --- |
| Canonical lifecycle authority | One Rust run state machine; TypeScript is integration plus conformance oracle. | Mature Rust core and native CLI, headless execution, MCP client/server. | Mature agent loop with sessions, tools, permissions, hooks, and subagents. | Mature interactive/programmatic CLI with tools, agents, hooks, plugins, and MCP. | Broad Python agent runtime across CLI, gateways, providers, tools, memory, and skills. |
| Evidence/provenance | Per-run ordered events, snapshot/context IDs, capability results, approval basis, inference evidence, outcome assessment, and verified transaction evidence. | Public docs describe session rollouts, sandbox/approval state, and programmatic output, but not Forge's exact per-capability evidence envelope. | JSONL sessions, checkpoints, permission events, and hook inputs; checkpoint recovery intentionally excludes Bash/external changes. | Session event logs, workspace artifacts, plans, checkpoints, and JSONL output are documented. | SQLite sessions retain messages, tool calls/results, model configuration, token counts, and lineage. |
| Mutation safety | High-level governed change: complete-file evidence, digest binding, isolated candidate, verification, second promotion decision, durable recovery. No generic write/shell MCP tools. | General edits and shell execution under sandbox and approval policy. | General edit and Bash tools under permissions; file-edit checkpoints support rewind. | General edit, patch, file, shell, URL, MCP, and subagent tools with allow/deny controls. | General terminal/file tools with approval and optional container backends. |
| OS containment | **Absent.** Process-tree ownership and minimized verifier environment are not a sandbox. | OS-enforced local sandbox; public docs cover macOS, Linux, and Windows mechanisms. | OS sandbox for Bash on macOS, Linux, and WSL2; native Windows sandbox is documented as planned. File tools use permissions rather than the Bash sandbox. | Local and cloud sandboxes are public preview; local support is macOS/Linux and Windows Insider builds. | Optional hardened Docker/Singularity/remote backends; local execution otherwise inherits the host boundary. |
| Approval/control | Rust resolves every final decision and owns call/token budgets. TypeScript now exposes developer/review/locked as attributable facts, with exact-context embedded review callbacks and fail-closed unresolved asks. Local/live/VS Code 5C gates pass; hosted exact-head acceptance is pending. No central policy distribution exists. | Configurable sandbox and approval policies, granular approval categories, managed settings, and review flows. | Layered allow/ask/deny permissions, managed settings, hooks, and sandbox policy. | Tool/path/URL allow/deny, persisted permissions, hooks, admin restrictions, and autopilot continuation limits. | Dangerous-command approval, file-write controls, platform authorization, and container policy. |
| Run/session recovery | Durable ChangeSet/candidate recovery exists. **Conversation and outer RunArtifact resume do not.** | Saved chats can be resumed; noninteractive and app/server surfaces are mature. | Continuous local sessions, resume/branch/export, and edit checkpoints that persist with sessions. | Local session event logs/artifacts, resume/continue, checkpoints, and optional cloud sandbox snapshots. | Full SQLite session persistence, resume/search, lineage, and cross-surface history. |
| Context management | Deterministic byte-bounded manifest and compact tool evidence. The planned mixed-method context compiler is not built. | Compaction, skills, subagents, MCP scoping, and durable repository guidance are product features. | `/compact`, `/context`, session branching, skills, scoped subagents, and tool-result management are mature. | Automatic compaction, resumable sessions, instructions, skills, plugins, agents, and tool availability controls. | Dual compression, pluggable context engines, FTS5 session search, memory providers, and explicit context references. |
| Provider/local model choice | Explicit Ollama and direct OpenAI transports; no fallback. Live Qwen and credentialed OpenAI gates exist. | Primarily OpenAI with configurable model providers in the maintained Rust CLI. | Claude-first with supported cloud deployment integrations. | BYOK supports OpenAI-compatible endpoints including Ollama, Azure OpenAI, and Anthropic. | Broad provider/endpoints model including local or OpenAI-compatible routes. |
| Extensibility and host symmetry | Seven read-only MCP apprentice tools; embedded Rust bridge. No MCP client, public mutation tether, skills, hooks, or plugin system yet. | MCP client and experimental server, skills, plugins, hooks, SDK/app server, CLI/IDE/app surfaces. | MCP, hooks, skills, plugins, subagents, agent teams, SDK, IDE integrations. | MCP, hooks, skills, plugins, custom agents, ACP server, CLI/cloud/IDE integration. | MCP client and server, ACP, plugins, self-authored skills, memory providers, messaging gateways. |
| Packaging and onboarding | **Not clean-installable today.** The npm pack omits the native kernel and the repository has no root license file. | Global npm, Homebrew, and platform release binaries; Apache-2.0 repository. | One-command supported installer/package flows and polished first-run UX. | Direct install and account-backed startup; customization is optional. | Documented installer/setup with a broad configuration wizard. |
| Field maturity | Small private reconstruction with strong tests but little developer exposure. | Large open-source project and commercial product surface. | Widely deployed commercial CLI with extensive documented controls. | Enterprise-integrated commercial CLI with policy and GitHub ecosystem. | Fast-moving open-source general agent with broad feature surface. |

## What Forge can legitimately claim

1. Forge records a deterministic, host-neutral evidence trail for each accepted run rather than treating the transcript as the only authority.
2. Forge's governed mutation path binds evidence, approval, candidate execution, verification, and promotion to Rust-owned state.
3. The same kernel contract is used by CLI, service, and MCP-facing adapters; no second product runtime is intended.
4. Local and cloud inference are explicit choices. Forge does not silently fall back between them.
5. Windows and macOS are Tier-1 acceptance targets, with Ubuntu retained as a compatibility gate.

Forge must **not** currently claim mature standalone-agent parity, enterprise readiness, OS containment, crash-resumable conversations, an intelligent context compiler, learned skills, durable memory, or a general MCP mutation surface.

## Immediate alpha critical path

The fastest defensible path is not more intelligence features. Increment 5C is now
at its exact-head hosted acceptance gate without adding another policy engine. The
remaining path is:

1. Add minimum outer-run recovery: append the canonical events/artifact, resume only idempotent work, and surface retained non-idempotent transactions without replaying them.
2. Package the native kernel with the TypeScript CLI for clean Windows and macOS installation; add `doctor`, effective configuration, and upgrade smoke tests.
3. Resolve the root open-source license with owner/legal review and add contribution/security guidance.
4. Ship an alpha test kit: five representative prompts, expected evidence, known limitations, issue template, and telemetry that is local/opt-in.
5. Add bounded recovery guidance for malformed tiny-model tool continuations. Qwen 0.5B is not a general tool-use floor; Forge must preserve call identity rather than guessing through a malformed stream.

A focused implementation lane can plausibly reach an externally shareable developer alpha in **2–4 weeks**. That estimate assumes the root license decision is made quickly, hosted CI remains healthy, and OS sandboxing stays clearly deferred. A small internal source-based preview can happen earlier; it must not be presented as the installable alpha.

## Next after alpha

- Native Windows/macOS restricted execution, built as a separate adversarially tested boundary.
- Indexed/watch-invalidated repository evidence and performance budgets for large workspaces.
- Context compiler quality evaluation before lossy compression becomes automatic.
- MCP client and high-level mutation symmetry using the same approval/transaction contracts.
- Reviewed skills and scoped memory only after recovery and provenance storage are stable.
- Policy distribution, durable audit export, signed releases, and enterprise administration.

## Primary sources

### Codex

- [Codex Rust CLI README](https://github.com/openai/codex/blob/main/codex-rs/README.md)
- [Codex approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Codex projects and chats](https://learn.chatgpt.com/docs/projects)
- [Codex customization and skills](https://learn.chatgpt.com/guides/best-practices)

### Claude Code

- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Sessions](https://code.claude.com/docs/en/sessions)
- [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Hooks](https://code.claude.com/docs/en/hooks-guide)
- [Subagents](https://code.claude.com/docs/en/sub-agents)

### GitHub Copilot CLI

- [About Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli)
- [CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Tool permissions](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools)
- [Cloud and local sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes)
- [CLI state directory and recovery artifacts](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [CLI customization](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/overview)
- [BYOK providers](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models)

### Hermes Agent

- [Hermes documentation](https://hermes-agent.nousresearch.com/docs/)
- [CLI and session UX](https://hermes-agent.nousresearch.com/docs/user-guide/cli)
- [Session persistence](https://hermes-agent.nousresearch.com/docs/user-guide/sessions/)
- [Context compression and caching](https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching/)
- [Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)
- [Memory providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers/)
- [Security and container isolation](https://hermes-agent.nousresearch.com/docs/user-guide/security/)
