# ForgeEngine

ForgeEngine is a sovereign-first, host-neutral software-evidence runtime for
developer workspaces. A CLI, IDE host, MCP client, or future provider receives the
same bounded record of what evidence was selected, which capability acted, what
changed, and how the run ended.

The archived prototype is reference material only. The V1 runtime is being rebuilt
slice by slice from the contracts in `docs/architecture/`.

## Current implementation

The current implementation provides; acceptance status is recorded by the linked checkpoints:

PR #34 merge `9bba75e` is the accepted Slice 4 baseline. `memory preview` is the
active, unaccepted Slice 5 candidate until its exact local, package, hosted, and
merge gates complete.

- a Rust-owned run, approval, event, artifact, transaction, and recovery authority;
- a bridge-v10 Rust outer-run ledger accepted through the private hosted regression:
  request-before-run,
  append-before-notify events, terminal-before-result artifacts, bounded interaction
  transcripts, deterministic same-runtime continuation, and read-only
  terminal/open/repair inspection;
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
  boundary supplied by another host;
- attributable repository decisions and developer preferences through `forge memory
  remember`, `find`, `show`, `explain`, `correct`, `forget`, `history`, `restore`,
  `purge`, `autosave`, `preview`, and `status`, with Rust-authoritative identity, provenance,
  standing grants, correction, bounded recovery, and erasure rewrite. Forget is
  reversible through bounded history; purge removes the selected lineage from Forge
  memory, and `memory history clear` removes recovery while retaining active memory.
  Neither operation claims to erase separate runs, artifacts, conversations,
  backups, or media. Autosave defaults to `ask`;
  only a local `forge memory autosave off|ask|auto` action can change it for the
  current repository. A narrow safe preference grammar can save without pausing in
  `auto`, with `/memory explain` and immediate `/memory undo`. `forge memory
  preview` shows the exact repository-plus-developer records eligible under the
  baseline freshness policy, their deterministic byte budget, and omission reasons
  without contacting a provider, compacting recovery, or changing saved memories.
  Forge still does not insert memory into planner or provider prompt context. This
  is an architectural non-activation statement, not a claim of general
  prompt-injection resistance.

The public CLI and MCP server require the Rust kernel. A source checkout discovers
`target/release/forge-kernel` and then `target/debug/forge-kernel`; an exact
`FORGE_KERNEL_BINARY` override is also supported. Forge fails closed if an explicit
kernel path is invalid. The TypeScript coordinator is retained only as an explicitly
selected conformance fixture.

Packaged users do not need Rust, Visual Studio, or another native compiler. A normal
install includes the exact-version `forge-engine-kernel-<platform>-<arch>` optional
package for the host. A missing kernel after a packaged install is an installation or
packaging defect: verify that npm did not omit optional dependencies and that the main
and native package versions match. Do not ask an end user to compile the kernel or use
an unrelated binary as a workaround.

A Git source checkout is different: compiled artifacts are intentionally absent and
`target/` is ignored. Each checkout or worktree has its own build output, so a kernel
built in another checkout is not discovered. Build the current checkout as described
under [Development from source](#development-from-source).

Plain `forge` starts an interactive local-first prompt shell and auto-discovers an
installed Ollama model when no route is supplied. Each prompt creates a separate
Rust-authoritative run; tool continuation is preserved within the run, but
cross-prompt conversation context is not yet retained. Each outer run is durably
inspectable. `forge runs resume` replays validated completed interactions through
the same Rust runtime; ambiguous provider/approval work and unresolved
non-idempotent capabilities remain blocked rather than guessed. `forge run <task>`
remains the explicit non-interactive and JSON automation surface.

Product configuration is data-only JSON at the fixed paths
`<workspace>/.forge/config.json` and `~/.forge/config.json`. Forge compiles it once
with explicit CLI/environment facts into one immutable configuration shared by
CLI, service, and MCP entry points. `forge config path`, `init`, `validate`, and
`show` provide discovery, no-overwrite creation, validation, and redacted source/
digest diagnostics without requiring a kernel or probing a provider.

## Honest limitations

- Trusted verification runs with the Forge process's operating-system permissions.
  Forge owns process lifecycle and clears most environment variables, but it does
  not yet enforce a Windows/macOS filesystem or network sandbox.
- Authenticated `host_managed` execution proves who supplied a boundary; it does not
  make Forge the enforcer of that boundary.
- `restricted` execution remains unavailable and fails closed until native platform
  providers pass adversarial gates.
- There is no public MCP mutation tool, generic shell, unrestricted write tool,
  automatic cross-prompt conversational capture/retrieval, skills, compression,
  connector, or automation surface yet. Safe continuation is bounded; ambiguous
  provider/approval requests and unresolved mutation capabilities are intentionally
  not retried.
- OpenAI transport conformance is tested, but a live cloud acceptance run requires
  the user's own `OPENAI_API_KEY`; Forge does not accept credentials as CLI flags or
  write them into run evidence.
- Exact-version native packaging, the clean-install lifecycle, the trusted-alpha
  Windows x64 and macOS ARM64/x64 matrix, Ubuntu x64 compatibility, and complete
  effective-configuration conformance are accepted. Signing/provenance and
  contributor-rights attestation remain open. Until those public gates close, this
  is a private accepted alpha foundation rather than a publicly shippable alpha.

## Trusted-alpha acceptance spike

From a source checkout, one-command onboarding builds the Rust/TypeScript product
and reports runtime readiness, the trusted/no-containment posture, accepted
release contracts, and remaining evidence gates:

```powershell
npm run onboard
```

The complete current-host package lifecycle spike builds release binaries, packs
the exact-version main and native packages, installs them in an empty project,
runs doctor plus a real Rust-backed inspection, updates the exact pair, and
uninstalls both packages:

```powershell
npm run release:smoke
```

See [the trusted developer alpha test kit](docs/release/trusted-developer-alpha-test-kit.md)
for bounded prompts, expected evidence, and issue-reporting guidance. This command
is acceptance evidence for the current host; the separate hosted workflows prove
the accepted target matrix. Neither proves artifact provenance or ownership rights
for every existing contribution.

## Development from source

Requires Git, Node.js 22 or newer with npm, and Rust 1.97.1. Platform prerequisites
are:

- Windows: the `x86_64-pc-windows-msvc` Rust toolchain, Visual Studio Build Tools
  2022 with the **Desktop development with C++** workload (MSVC x64/x86 build tools),
  and a Windows 10 or Windows 11 SDK. Run native builds in the **x64 Native Tools
  Command Prompt for VS 2022**, or launch VS Code from that prompt. After installing
  the tools, restart VS Code and open a new integrated terminal so it receives the
  updated environment.
- macOS: the Xcode command-line tools.
- Linux: the distribution C/C++ compiler and linker toolchain.

On Windows, this preflight must find the MSVC linker and SDK resource compiler from
the developer terminal, and Rust must report the MSVC host:

```powershell
rustup show active-toolchain
where.exe link
where.exe rc
```

Install dependencies, run the Node/TypeScript checks, then build the complete source
product:

```powershell
npm ci
npm run check
npm run build:product
node dist/src/cli.js doctor --json
npm run smoke
```

`npm run check` type-checks, tests, and builds the Node/TypeScript layer; it does
**not** invoke Cargo and does not create the native kernel. `npm run build:product`
runs the Rust workspace build and then the TypeScript build. A successful debug build
creates `target/debug/forge-kernel.exe` on Windows or
`target/debug/forge-kernel` on macOS/Linux. `forge doctor` reports the exact selected
kernel path and discovery source, runtime posture, isolation limitation, effective
run-store root/recovery posture, and whether the state root is outside the governed
workspace. Rust revalidates canonical paths when opening the transaction authority.

Common kernel failures:

| Symptom | Meaning and action |
| --- | --- |
| `link.exe` or Windows SDK tools are missing | Install the Windows prerequisites above, restart VS Code, and build from a fresh x64 developer terminal. |
| `Forge Rust kernel is unavailable` after `npm run check` | This is expected for a fresh source checkout; run `npm run build:product` in that same checkout. |
| A kernel exists in another Git worktree | Build the current worktree. Discovery is deliberately package-root-relative. |
| An explicit kernel path fails | Remove a stale `FORGE_KERNEL_BINARY` value or set it to the exact trusted binary; invalid overrides fail closed. |
| A packaged install has no kernel | Confirm optional dependencies were enabled and the exact-version host-native package was installed; treat a missing published package as a release defect. |

Useful commands after the product build:

```powershell
node dist/src/cli.js --workspace C:\path\to\repo
node dist/src/cli.js doctor --json
node dist/src/cli.js config path
node dist/src/cli.js config init workspace
node dist/src/cli.js config validate --json
node dist/src/cli.js config show --json
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
