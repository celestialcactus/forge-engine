# ForgeEngine

ForgeEngine is a sovereign-first, host-neutral software-evidence runtime for
developer workspaces. A CLI, IDE host, MCP client, or future provider receives the
same bounded record of what evidence was selected, which capability acted, what
changed, and how the run ended.

The archived prototype is reference material only. The V1 runtime is being rebuilt
slice by slice from the contracts in `docs/architecture/`.

## Current implementation

The accepted core currently provides:

- a Rust-owned run, approval, event, artifact, transaction, and recovery authority;
- deterministic workspace inventory, literal search, bounded line reads,
  TypeScript declarations/diagnostics, and read-only Git evidence;
- a seven-tool stdio MCP evidence adapter tested with VS Code;
- explicit local Ollama and direct OpenAI Responses inference routed through the
  same Rust-owned run and evidence contract, with no implicit provider fallback;
- complete bounded ChangeSet v2 operations through a disposable Git worktree,
  verification, durable local transaction state, and explicit accept or discard;
- supervised verifier process-tree cleanup on Windows, macOS, and Linux;
- authenticated, replay-resistant host-managed execution grants for embedding in a
  boundary supplied by another host.

The public CLI and MCP server require the Rust kernel. A source checkout discovers
`target/release/forge-kernel` and then `target/debug/forge-kernel`; an exact
`FORGE_KERNEL_BINARY` override is also supported. Forge fails closed if an explicit
kernel path is invalid. The TypeScript coordinator is retained only as an explicitly
selected conformance fixture.

`forge run <task>` requires an explicit `--provider <ollama|openai>` and `--model`.
Provider streams are normalized in TypeScript, while Rust retains turn budgets,
capability approval, ordered events, and terminal inference evidence. The current
command returns the final artifact as JSON or text; the next ship-lane increment is
the interactive streaming CLI lifecycle rather than a second orchestration runtime.

## Honest limitations

- Trusted verification runs with the Forge process's operating-system permissions.
  Forge owns process lifecycle and clears most environment variables, but it does
  not yet enforce a Windows/macOS filesystem or network sandbox.
- Authenticated `host_managed` execution proves who supplied a boundary; it does not
  make Forge the enforcer of that boundary.
- `restricted` execution remains unavailable and fails closed until native platform
  providers pass adversarial gates.
- There is no public MCP mutation tool, generic shell, unrestricted write tool,
  interactive streaming/resumable CLI session, durable session projection, skills,
  memory, compression, connector, or automation surface yet.
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
reports the exact kernel path, discovery source, runtime posture, and isolation
limitation.

Useful commands after the product build:

```powershell
node dist/src/cli.js doctor --json
node dist/src/cli.js inspect --workspace C:\path\to\repo --json
node dist/src/cli.js search "literal text" --workspace C:\path\to\repo --json
node dist/src/cli.js run "Inspect this workspace" --provider ollama --model qwen2.5-coder:7b --workspace C:\path\to\repo --json
node dist/src/cli.js change propose proposal.json --policy verification-policy.json --approve --json
```

The Ollama route expects a locally running Ollama API and an installed model.
`FORGE_OLLAMA_URL` can select a non-default endpoint. The OpenAI route reads
`OPENAI_API_KEY`; `FORGE_OPENAI_BASE_URL` can select a compatible direct endpoint.
Neither route silently falls back to the other.

VS Code uses the workspace-local `.vscode/mcp.json` after a product build. See
`docs/testing/vscode-developer-test-milestone-a.md` for the controlled prompts.

## Architecture and decisions

- `docs/architecture/forgeengine-v1-validated-build-plan.md` is the V1 execution
  authority and contains the immediate CLI ship lane.
- `docs/architecture/project-sybil-working-spec.md` preserves the future generalized
  worker-platform exploration without expanding Forge V1.
- `docs/decisions/ADRs/ADR-0017-product-runtime-authority-and-restricted-sequencing.md`
  records Rust product authority and the honest sandbox sequencing decision.
- `docs/decisions/architecture-changelog.md` indexes checkpoints and ADRs.
- `docs/archive/prototype/` preserves the preliminary implementation.
