# ForgeEngine

ForgeEngine is a sovereign-first, host-neutral software-evidence runtime for
developer workspaces. It gives a CLI, IDE host, MCP client, or future provider the
same bounded and inspectable record of what evidence was selected, which
capability acted, and how the run ended.

The archived prototype is reference material only. The V1 runtime is being rebuilt
slice by slice from the contracts in `docs/architecture/`.

## Current implementation: Slice 1

The accepted read-only slice provides:

- one host-neutral run protocol with ordered events, context plans, approvals,
  capability results, cancellation, failures, and final artifacts;
- deterministic workspace inventory and literal search;
- bounded UTF-8 file reads with line evidence and SHA-256 content identity;
- TypeScript/JavaScript declarations and no-emit TypeScript diagnostics;
- read-only Git status and bounded diff evidence;
- a local CLI and seven-tool stdio MCP adapter tested with VS Code;
- observed, connection-scoped snapshot reuse with invalidation and a bounded
  rescan ceiling.

`forge run <task>` currently executes a deterministic read-only inventory plan. It
preserves the developer task in the run artifact; it is not yet natural-language
model orchestration.

## Explicitly not implemented yet

Forge does not yet expose workspace mutation, generic shell execution, durable
sessions, provider escalation, skills, compression, or an OS sandbox. TypeScript
diagnostics remain synchronous, snapshot identity is not a complete content
manifest, and very large workspaces still need indexed evidence services.

## Development

Requires Node.js 22 or newer.

```powershell
npm ci
npm run check
npm run smoke
```

Useful commands:

```powershell
node dist/src/cli.js doctor --json
node dist/src/cli.js inspect --workspace C:\path\to\repo --json
node dist/src/cli.js search "literal text" --workspace C:\path\to\repo --json
node dist/src/cli.js run "Inspect this workspace" --workspace C:\path\to\repo --json
```

VS Code uses the workspace-local `.vscode/mcp.json` after a production build. See
`docs/testing/vscode-developer-test-milestone-a.md` for the controlled prompts.

## Architecture and decisions

- `docs/architecture/forgeengine-v1-validated-build-plan.md` is the V1 execution
  authority.
- `docs/architecture/slice-1-read-only-repository-intelligence.md` explains the
  accepted slice.
- `docs/audit/slice-1-closure-audit.md` records the release-gate audit.
- `docs/decisions/architecture-changelog.md` indexes checkpoints and ADRs.
- `docs/archive/prototype/` preserves the preliminary implementation.
