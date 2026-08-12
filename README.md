# ForgeEngine

ForgeEngine is a sovereign-first, host-neutral software-evidence runtime for
developer workspaces. A CLI, IDE host, MCP client, or future provider receives the
same bounded record of what evidence was selected, which capability acted, what
changed, and how the run ended.

The archived prototype is reference material only. The V1 runtime is being rebuilt
slice by slice from the contracts in `docs/architecture/`.

## Current implementation

The current implementation provides; acceptance status is recorded by the linked checkpoints:

- a Rust-owned run, approval, event, artifact, transaction, and recovery authority;
- a bridge-v10 Rust outer-run ledger at its local gate: request-before-run,
  append-before-notify events, terminal-before-result artifacts, bounded interaction
  transcripts, deterministic same-runtime continuation, and read-only
  terminal/open/repair inspection; exact-head hosted acceptance remains pending;
- deterministic workspace inventory, literal search, bounded line reads,
  TypeScript declarations/diagnostics, and read-only Git evidence;
- a seven-tool stdio MCP evidence adapter tested with VS Code;
- explicit local Ollama and direct OpenAI Responses inference routed through the
  same Rust-owned run and evidence contract, with no implicit provider fallback;
- complete bounded ChangeSet v2 operations through a disposable Git worktree,
  verification, durable local transaction state, explicit accept or discard, and a
  bounded read-only transaction audit;
- supervised verifier process-tree cleanup on Windows, macOS, and Linux;
- authenticated, replay-resistant host-managed execution grants for embedding in a
  boundary supplied by another host.

The public CLI and MCP server require the Rust kernel. A source checkout discovers
`target/release/forge-kernel` and then `target/debug/forge-kernel`; an exact
`FORGE_KERNEL_BINARY` override is also supported. Forge fails closed if an explicit
kernel path is invalid. The TypeScript coordinator is retained only as an explicitly
selected conformance fixture.

Plain `forge` starts an interactive local-first prompt shell and auto-discovers an
installed Ollama model when no route is supplied. Each prompt creates a separate
Rust-authoritative run; tool continuation is preserved within the run, but
cross-prompt conversation context is not yet retained. Each outer run is durably
inspectable. `forge runs resume` replays validated completed interactions through
the same Rust runtime; ambiguous provider/approval work and unresolved
non-idempotent capabilities remain blocked rather than guessed. `forge run <task>`
remains the explicit non-interactive and JSON automation surface.

## Honest limitations

- Trusted verification runs with the Forge process's operating-system permissions.
  Forge owns process lifecycle and clears most environment variables, but it does
  not yet enforce a Windows/macOS filesystem or network sandbox.
- Authenticated `host_managed` execution proves who supplied a boundary; it does not
  make Forge the enforcer of that boundary.
- `restricted` execution remains unavailable and fails closed until native platform
  providers pass adversarial gates.
- There is no public MCP mutation tool, generic shell, unrestricted write tool,
  cross-prompt conversational memory, skills, compression, connector, or automation
  surface yet. Safe continuation is bounded; ambiguous provider/approval requests
  and unresolved mutation capabilities are intentionally not retried.
- OpenAI transport conformance is tested, but a live cloud acceptance run requires
  the user's own `OPENAI_API_KEY`; Forge does not accept credentials as CLI flags or
  write them into run evidence.
- Final npm/native binary packaging and clean-install release smoke are still open.
  The current developer alpha is run from a source checkout.

## Development from source

Requires Node.js 22 or newer and Rust 1.97.1. Windows also needs the Visual C++ build
tools/linker; macOS needs the Xcode command-line tools.

```powershell
npm ci
npm run check
npm run rust:build
npm run build
npm run smoke
```

`npm run build:product` builds the Rust kernel and TypeScript adapter. `forge doctor`
reports the exact kernel path, discovery source, runtime posture, isolation
limitation, effective run-store root/recovery posture, and whether the state root is
outside the governed workspace. Rust revalidates canonical paths when opening the
transaction authority.

Useful commands after the product build:

```powershell
node dist/src/cli.js --workspace C:\path\to\repo
node dist/src/cli.js doctor --json
node dist/src/cli.js runs inspect run:the-id-from-a-prior-result --json
node dist/src/cli.js runs resume run:the-id --provider ollama --model qwen2.5-coder:7b --json
node dist/src/cli.js inspect --workspace C:\path\to\repo --json
node dist/src/cli.js search "literal text" --workspace C:\path\to\repo --json
node dist/src/cli.js run "Inspect this workspace" --provider ollama --model qwen2.5-coder:7b --workspace C:\path\to\repo --json
node dist/src/cli.js change propose proposal.json --policy verification-policy.json --approve --json
node dist/src/cli.js change audit --workspace C:\path\to\repo --json
```

The Ollama route expects a locally running Ollama API and an installed model.
`FORGE_OLLAMA_URL` can select a non-default endpoint. Ollama defaults to an 8K
context window; `FORGE_OLLAMA_CONTEXT_TOKENS` accepts an explicit value from 2048
through 262144. The OpenAI route reads
`OPENAI_API_KEY`; `FORGE_OPENAI_BASE_URL` can select a compatible direct endpoint.
`FORGE_DEFAULT_PROVIDER` and `FORGE_DEFAULT_MODEL` may set a complete interactive
default pair. Neither route silently falls back to the other, and interactive
discovery never selects cloud inference.

VS Code uses the workspace-local `.vscode/mcp.json` after a product build. See
`docs/testing/vscode-developer-test-milestone-a.md` for the controlled prompts.

## Architecture and decisions

- `docs/architecture/forgeengine-v1-validated-build-plan.md` is the V1 execution
  authority and contains the immediate CLI ship lane.
- `docs/architecture/project-sybil-working-spec.md` preserves the future generalized
  worker-platform exploration without expanding Forge V1.
- `docs/decisions/ADRs/ADR-0017-product-runtime-authority-and-restricted-sequencing.md`
  records Rust product authority and the honest sandbox sequencing decision.
- `docs/decisions/ADRs/ADR-0031-transaction-retention-and-native-sandbox-sequencing.md`
  records the non-destructive transaction policy and Tier-1 native sandbox gates.
- `docs/decisions/architecture-changelog.md` indexes checkpoints and ADRs.
- `docs/archive/prototype/` preserves the preliminary implementation.
