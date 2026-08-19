# Checkpoint 91: effective configuration hosted gate

**Date:** 2026-08-19

**Decision:** accept `CLI7-ALPHA-CONFIG` for merge

**Implementation candidate:** `e7ba28406468298c670622ff1daa2a49f9a10fa7`

**Pull request:** [#31](https://github.com/celestialcactus/forge-engine/pull/31)

**Accepted baseline:** `origin/develop` at
`89eec1f3d4bbba5f48670136dc4610143acf08db` (PR #30)

## Accepted capability boundary

Forge now compiles one immutable effective product configuration for the CLI,
interactive shell, provider construction, embedded service, MCP server, `doctor`,
and `onboard`. Eligible selection facts resolve in the order managed host facts,
explicit CLI, environment, workspace, user, then built-ins. Provider and model form
one atomic route. Approval profiles choose the most restrictive applicable value;
numeric execution controls choose the minimum applicable ceiling.

Workspace and user files are fixed data-only JSON documents at
`<workspace>/.forge/config.json` and `~/.forge/config.json`. They are bounded,
strictly validated, and fail before provider or kernel work when present but
invalid. Workspace files may select provider/model and tighten controls, but cannot
select endpoints, credentials, executables, or state roots. `forge config path`,
`init`, `validate`, and `show` provide kernel-free discovery, safe creation,
validation, and one redacted source-attributed diagnostic truth shared by
`doctor`.

The OpenAI credential remains a fixed named environment handle. Compilation
retains only presence, source, reference, and a secret-byte-independent digest;
the adapter resolves bytes at construction. Configured provider failures name the
attempted provider/model without secrets and never discover or route to another
provider. Endpoint locality is derived conservatively from the normalized
hostname, so a non-loopback Ollama-compatible endpoint is not called local.

Rust remains the only final approval, budget, lifecycle, and artifact authority.
The same compiled approval and execution controls reach standalone service and MCP
construction, and the pre-existing `forge diagnostics --config <tsconfig>` command
keeps its command-local meaning.

## Local evidence

The complete product gate passed on Windows x64 on the final amended worktree over
implementation candidate `e7ba284`. The only change after the earlier full
implementation gate canonicalized the macOS `/var` versus `/private/var` path
comparison in tests; the exact candidate then passed both the complete local gate
and hosted matrix.

- Node.js `22.19.0`; npm `10.9.3`.
- Rust `1.97.1` (`rustc 8bab26f4f 2026-07-14`), Cargo `1.97.1`.
- `npm ci`: passed with zero reported vulnerabilities.
- `npm run repo:authority`: passed against the accepted PR #30 baseline.
- `npm run check:product`: passed; 175 Rust tests passed with 16 explicit ignores,
  151 Node tests passed, and 58 hybrid cases passed with seven explicit
  environment skips. Typecheck, build, source `doctor`, and source `inspect` smoke
  passed. Windows used the established GNU LLVM Rust target because the local MSVC
  linker was unavailable; hosted Windows is the MSVC authority.
- `npm run rust:audit`: passed for 46 dependencies against 1,217 loaded advisory
  records.
- `npm run release:smoke`: passed the packaged lifecycle events `pack`,
  `clean-install`, `config-path`, user/workspace `config-init`, `config-validate`,
  `config-show`, `config-partial-route-refusal`, `doctor`, conformant `onboard`,
  `inspect`, `update`, and `uninstall` in an isolated home/workspace with covered
  environment variables sanitized.
- `npm run package:native:pack`: packed
  `forge-engine-kernel-win32-x64@0.1.0`.
- `FORGE_BENCHMARK_SAMPLES=20 npm run benchmark:hybrid -- --assert`: passed. Rust
  mean/p50/p95/max were 73.083/68.588/96.363/101.305 ms; TypeScript were
  0.229/0.123/0.498/1.338 ms.
- `npm run check` passed independently with 151/151 Node tests, typecheck, and
  build before the complete product gate repeated those checks.

## Hosted evidence

Both required workflows passed at exact candidate `e7ba284`:

- [Cross-platform run 32294174902](https://github.com/celestialcactus/forge-engine/actions/runs/32294174902):
  Windows x64, macOS ARM64, macOS x64, and Ubuntu x64 Node/typecheck/build gates.
- [Hybrid run 32294174815](https://github.com/celestialcactus/forge-engine/actions/runs/32294174815):
  RustSec plus Windows x64, macOS ARM64, macOS x64, and Ubuntu x64 Rust, native
  package, hybrid, configured product, clean-install package, and benchmark gates.

An earlier macOS job exposed only the test assertion's `/var` alias assumption.
The production resolver already returned the host-canonical fixed path; `e7ba284`
made the assertion compare canonical paths and the complete matrix passed.

## Explicit non-claims

This checkpoint does not claim:

- public package publication, signing, notarization, registry ownership,
  provenance, or contributor-rights clearance;
- native restricted containment, credential containment, or sandbox-provider
  promotion;
- organization provider policy, data-residency enforcement, RBAC, compliance
  administration, or remote managed-policy distribution;
- OS secret-store integration, credential brokerage, secret rotation, or secrets
  in repository/user configuration;
- executable/YAML configuration, arbitrary product-config paths, provider
  expansion, plugins, or per-command default expansion;
- CLI8 memory retrieval, learned-skill activation, background agents, automatic
  workflows, or a public high-level mutation surface.

## Next lane

After PR #31 merges, the smallest serial product lane is CLI8's bounded memory
policy and attributable observation/replay foundation. Settle its four open policy
choices and replay only the scoped additive candidate onto fresh `origin/develop`.
Native sandbox-provider lifecycle work and public rights/signing work remain
independent gates and must not be folded into CLI8.
