# CLI7-ALPHA-CONFIG: effective configuration and conformance

**State:** Package 0 contracts and golden fixtures implemented; review is required before parallel core work
**Accepted baseline:** `origin/develop` at `dfed8dd` (PR #29 design lock)
**Architecture authority:**
[ADR-0036](../decisions/ADRs/ADR-0036-alpha-distribution-and-configuration-contract.md),
[ADR-0028](../decisions/ADRs/ADR-0028-product-approval-profiles.md), and
[ADR-0017](../decisions/ADRs/ADR-0017-product-runtime-authority-and-restricted-sequencing.md)
**Dependency:** the private trusted-alpha distribution/onboarding foundation accepted
through PR #27 and
[Checkpoint 90](../decisions/checkpoints/2026-08-18-90-trusted-alpha-hosted-gate.md)

## Objective

Replace the CLI's scattered flag/environment/default selection with one bounded,
typed effective-configuration compiler shared by standalone CLI, embedded service,
and MCP construction. Prove ADR-0036 selection precedence, monotonic policy
tightening, secret-safe projection, and attributable `doctor` output without
creating a second policy authority or broadening the alpha claim.

This is the next smallest implementation lane. It is independent of native sandbox
provider promotion and must close before CLI8 runtime activation.

## Q — accepted design lock

The maintainer accepted this design boundary on 2026-08-19. The answers below refine
ADR-0036 for this bounded implementation; package 0 freezes their exact types and
golden cases without reopening product scope.

### Where do configuration files live, and what format do they use?

- Workspace configuration is the fixed data-only file
  `<workspace>/.forge/config.json`.
- User configuration is the fixed data-only file `~/.forge/config.json`. Its
  discovery location does not move when `engineRoot` changes, avoiding a bootstrap
  cycle between locating configuration and resolving state.
- Both files require `schemaVersion: 1`, have a 64 KiB byte ceiling, and reject
  unknown keys and invalid values.
- TypeScript or other executable configuration, YAML aliases/tags, implicit upward
  directory search, and arbitrary product-config file paths are out of scope.
- The existing `forge diagnostics --config <tsconfig>` spelling remains a
  command-local TypeScript diagnostics input. This slice does not reinterpret it or
  add a second global `--config` meaning.

### Which existing settings enter schema v1?

Configuration is intentionally limited to settings already exercised by the
product:

- atomic inference route: `provider` plus `model`;
- state selection: `engineRoot`;
- non-secret provider options: Ollama base URL/context window and OpenAI base URL;
- approval posture: `developer`, `review`, or `locked`;
- execution ceilings: turns, capability calls, reported input tokens, reported
  output tokens, and timeout;
- OpenAI credential presence through the existing explicitly named
  `OPENAI_API_KEY` environment reference.

Command inputs such as workspace path, proposal path, verification-policy path,
check IDs, evidence pagination, and the diagnostics TypeScript-config path are not
product defaults. Kernel binary/package discovery, debug flags, package-smoke
controls, and test-only variables remain bootstrap or development inputs outside
schema v1.

### Which sources may set which fields?

ADR-0036 precedence applies among eligible sources; it does not make every field
safe for every source.

| Field group | Managed facts | Explicit CLI | Environment | Workspace file | User file | Built-in |
| --- | --- | --- | --- | --- | --- | --- |
| Inference route | yes | yes | yes | yes | yes | no configured route |
| Engine root | yes | yes | yes | no | yes, absolute path only | `~/.forge` |
| Provider URL/context options | yes | no new flags | yes | no | yes | provider defaults |
| Approval posture | ceiling | ceiling | ceiling | tighten only | ceiling | `developer` |
| Execution limits | ceiling | ceiling | ceiling | tighten only | ceiling | current defaults |
| OpenAI credential | handle only | never | fixed named reference | never | no secret field in v1 | absent |

Workspace configuration cannot select an executable, a state root, a provider
endpoint, or a host credential reference. That prevents a repository from turning
configuration convenience into executable selection, state relocation, or a
credential confused deputy. A workspace may select a supported provider/model pair
and may tighten policy ceilings.

### Who owns inference governance?

Forge owns the local harness mechanism; the operator or organization owns the
acceptability of the selected inference environment. For a cloud route, the
operator establishes the account, region, IAM, networking, retention, approved
models, data classification, and compliance boundary. For a genuinely local route,
the operator selects and operates that local endpoint. Forge does not relabel a
custom or remote endpoint as local merely because it uses a local-provider adapter.

Forge must faithfully use and report the resolved provider/model and endpoint,
protect credential material, fail predictably, and never silently fall back to a
different provider or widen the configured boundary. It continues to own the
security intrinsic to the harness: capability and tool authority, filesystem
mutation, approvals, secrets, provenance, destructive actions, and truthful
containment claims.

CLI7 does not add provider allowlists, provider ceilings, data-residency rules,
organizational RBAC, compliance policy, or a remote enterprise-policy service.
Managed facts remain a typed trusted-host input at the highest precedence; they do
not imply that Forge distributes or administers organization policy.

### How are values combined?

- Selection units choose the first defined eligible source in this exact order:
  managed facts, explicit CLI, environment, workspace file, user file, built-in.
- Provider and model are one atomic route unit. They cannot be spliced from
  different layers, and a partial pair fails with an attributable configuration
  error.
- Approval posture uses the restriction lattice
  `developer < review < locked`; the most restrictive applicable ceiling wins.
- Numeric execution limits use the minimum applicable valid ceiling. Existing
  runtime bounds remain authoritative and zero remains valid only where the
  existing runtime accepts zero.
- Selection and ceiling resolution are separate typed operations. There is no
  generic recursive object merge and no last-writer-wins policy merge.

### How are secrets represented and reported?

- Config files and CLI arguments contain no secret bytes.
- Schema v1 recognizes only the existing `OPENAI_API_KEY` named environment
  reference. A provider receives the value only when its adapter is constructed.
- The effective configuration retains a secret handle plus presence/source facts,
  not a diagnostic value.
- A secret-field digest is SHA-256 over canonical field/source/reference/presence
  metadata. Secret bytes, their length, prefixes, and hashes are never inputs.
- Changing secret bytes while source and presence remain unchanged must not change
  `doctor` output. Error messages must not echo the value.
- An OS-secret-store adapter is compatible with ADR-0036 but deferred until a
  separately scoped cross-platform provider is selected and tested.

### What does a tight configuration experience mean?

Configuration quality is an acceptance boundary, not deferred polish. The normal
path remains zero-config where the product can safely guide the user: an absent
route is reported plainly and interactive mode may offer local model discovery.
Users do not need to understand the precedence lattice before Forge is useful.

- There is one fixed workspace file, one fixed user file, and no ambiguous search
  or global `--config` override.
- File keys mirror CLI concepts, use human names in help and `doctor`, and retain
  stable machine field IDs only for automation and advanced diagnosis.
- Every invalid setting reports what is wrong, the exact file/option/environment
  location, and a concrete next action. A workspace-owned field rejected for
  safety specifically tells the user which user or environment surface can own it.
- Missing optional files stay silent. Present invalid files fail before work and
  are never ignored, partially applied, or replaced by a fallback source.
- `doctor` explains the chosen value and source without requiring network access,
  while secret fields expose only their named reference and presence.
- Unknown keys fail with bounded, typo-oriented guidance. Errors never dump whole
  files, raw environment values, secret bytes, or a stack trace unless the existing
  explicit debug mode is enabled.
- Human and JSON output describe the same facts. Human output favors short labels
  and remediation; JSON favors stable IDs, sources, digests, and redaction flags.

Package 0 makes these requirements executable by requiring a human label for every
field and a message-plus-hint contract for every configuration issue. Later
packages must add golden error text for each failure class they implement.

### Where does authority remain?

TypeScript discovers, validates, attributes, and combines configuration facts. It
may select an approval profile and execution ceilings, as it already does, but it
does not emit final `allow`, `ask`, or `deny` decisions. The resolved profile still
creates attributable facts through the shared approval-profile module; Rust
validates those facts, applies canonical policy, enforces budgets, and records the
only final decision and lifecycle state.

Malformed, oversized, escaping, or unsupported configuration fails before provider,
kernel-run, MCP, or capability work begins. Missing optional files are absence;
present invalid files are errors. Configuration is loaded once per product process
and is immutable for that process.

## R — repository research

The accepted architecture is ahead of the implementation:

- `src/cli.ts` currently resolves approval posture, engine root, route, limits, and
  verification-policy input independently from flags, environment, and defaults.
- `src/interactive-cli.ts` separately resolves route defaults and Ollama discovery.
- `src/inference/routing.ts` reads provider endpoints, context size, and
  `OPENAI_API_KEY` directly from the process environment.
- `src/hybrid/kernel-binary.ts` has a separate bootstrap precedence and package
  discovery contract; it should not become repository-controlled configuration.
- `src/v1/service.ts` already centralizes approval facts and sends execution budgets
  to the canonical runtime. Its TypeScript decision mapping is explicitly a
  test-only conformance oracle.
- `src/mcp/server.ts` receives `ForgeWorkspaceServiceOptions` from the CLI, so MCP
  can reuse one compiled product configuration without reading files itself.
- `doctor` reports only selected ad hoc sources today, while `onboard` truthfully
  labels full precedence as implementation-pending.

The repository has no active product configuration schema or loader. Historical
prototype references to YAML or executable TypeScript configuration are not
authority and must not be revived by this slice.

## D — design contract

### Effective model

Freeze a small public-within-the-repository contract before parallel work:

- `ConfigurationSource` names `managed`, `command_line`, `environment`,
  `workspace`, `user`, and `built_in`.
- `ConfigurationFact<T>` binds a field ID, source, normalized value or secret
  handle, and source-safe evidence metadata.
- `EffectiveField<T>` binds the resolved value/handle, contributing sources, and a
  stable redacted digest.
- `EffectiveProductConfiguration` contains the atomic route, state root, provider
  options, approval posture, execution limits, and ordered diagnostic projection.
- Managed facts are passed through a typed host injection interface. Standalone CLI
  supplies none; they cannot be impersonated by environment or repository data.

Use exact field-specific parsers and bounds already enforced by the CLI/service.
Normalize before hashing and resolution. Diagnostic entries are emitted in stable
field-ID order and contain `field`, `source` or `sources`, `digest`, `present`, and
`redacted`; only explicitly non-sensitive fields may include a human-readable
effective value.

### Source loading

- Resolve the workspace root first, then require the workspace config's canonical
  regular-file path to remain beneath that root.
- Discover the user file from the host home directory, independent of the resolved
  engine root.
- Read each present file once with the byte bound, parse data-only JSON, and validate
  it with a strict schema.
- Preserve source-specific errors while avoiding secret values and unbounded file
  contents in messages.
- Resolve relative CLI/environment paths with current CLI behavior. User-file
  `engineRoot` must be absolute; workspace `engineRoot` is rejected.

### Product integration

- Compile effective configuration once after argument parsing and workspace
  selection.
- Pass the result to kernel/service, interactive route, inference-provider, doctor,
  onboard, and MCP construction; those consumers do not reread process environment
  for covered fields.
- Keep session `/model` changes explicitly session-scoped. They do not mutate or
  rewrite effective configuration.
- Keep verification-policy loading command-scoped. This slice does not invent an
  intersection algebra for verification programs.
- Replace `onboard.configuration.precedenceStatus` with a conformant status only
  after all required gates pass.

## S — implementation structure and parallel ownership

Parallel work begins only after the contracts and golden fixture table are reviewed
and committed on an exact `origin/develop` descendant.

| Work package | Depends on | Exclusive files/surfaces | Exit artifact |
| --- | --- | --- | --- |
| 0. Contract freeze | this task review | `src/config/contracts.ts`, fixture manifest | Reviewed types, field eligibility, normalization, and golden cases |
| A. Source/schema loader | package 0 | `src/config/schema.ts`, `src/config/sources.ts`, source fixtures/tests | Bounded fixed-path loading and strict source validation |
| B. Typed resolver | package 0 | `src/config/resolve.ts`, resolver tests | Selection precedence, atomic route, approval lattice, numeric minima |
| C. Secret/projection | package 0 | `src/config/secrets.ts`, `src/config/projection.ts`, projection tests | Handle-only secret access and deterministic redacted reporting |
| D. Product integration | A, B, C | `src/cli.ts`, `src/interactive-cli.ts`, `src/inference/routing.ts`, service/MCP adapter tests | One compiled configuration used by every product entry path |
| E. Release conformance | D | package-smoke/hosted fixtures and release docs | Clean-install Windows/macOS/Ubuntu evidence and honest claims |

Packages A, B, and C are parallel-safe after package 0. Package D has sole ownership
of the central CLI integration to avoid three branches editing the same bootstrap
path. Package E runs after integration; it may execute platform jobs in parallel but
must report one exact implementation commit. Native sandbox work and CLI8A may
continue in separate worktrees only while they avoid the shared configuration and
product-bootstrap files named above.

Every delegated work package starts from the exact contract-freeze commit and must
return: commit SHA, changed-file list, tests run, remaining non-claims, and any
requested shared-boundary change. A worker stops and escalates if it needs to alter
an accepted ADR, a Rust protocol/schema, or another package's exclusive files.

## P — implementation sequence and acceptance gates

### Phase 0: golden contract

- [x] accept the design lock above, including the operator-owned inference-
      governance boundary;
- [x] freeze schema-v1 field IDs, source eligibility, normalization, and digest
      rules;
- [x] add table-driven golden cases before implementation;
- [x] confirm no Rust bridge or persisted-run schema change is required. Package 0
      adds TypeScript contracts and pre-runtime fixtures only.

### Phase 1: parallel core

- [ ] load missing/present/invalid/oversized workspace and user files deterministically;
- [ ] prove every eligible selection precedence pair and atomic route failure;
- [ ] prove managed/user/workspace/CLI/environment policy inputs can tighten but
      cannot relax an applicable ceiling;
- [ ] prove secret bytes never enter configuration artifacts, logs, errors, or
      digests;
- [ ] prove stable projection ordering and digest repeatability.

### Phase 2: serial product integration

- [ ] replace covered ad hoc reads in CLI, interactive routing, and provider
      construction;
- [ ] preserve the exact resolved provider/model and fail rather than silently
      selecting another provider when initialization or inference fails;
- [ ] preserve `forge diagnostics --config <tsconfig>` semantics;
- [ ] pass one effective configuration into standalone service and MCP construction;
- [ ] make `doctor --json` and human output show every effective field's source and
      digest without probing network services or executing configured adapters;
- [ ] make `onboard` report configuration conformance and retain all unrelated
      public-release blockers;
- [ ] prove locked/review/developer behavior and Rust-owned decisions are unchanged.

### Phase 3: exact-head release gate

- [ ] `npm run typecheck`;
- [ ] `npm test`;
- [ ] `npm run build`;
- [ ] `npm run check:hybrid` with the exact retained/built kernel;
- [ ] source-built `doctor`, `onboard`, interactive, run, and MCP smoke;
- [ ] clean-install package smoke with workspace/user/CLI/environment fixtures;
- [ ] hosted Windows x64 and macOS ARM64/x64 product gates;
- [ ] Ubuntu x64 compatibility gate;
- [ ] checkpoint exact commit, commands, counts, environment facts, and non-claims.

## Required adversarial fixtures

1. Every higher-priority selection source wins over every lower-priority eligible
   source, with no unrelated field drift.
2. A provider from one source and model from another never form a route.
3. User `locked` plus workspace/CLI `developer` remains `locked`; workspace may
   tighten user `developer` to `review` or `locked`.
4. Every numeric ceiling selects the minimum, independent of source order.
5. Workspace attempts to set engine root, endpoint, credential reference, or an
   unknown key fail before kernel/provider work.
6. Missing files are ignored; malformed, oversized, directory, escaping-link, and
   unreadable present files fail with bounded source-attributable errors.
7. Two different secret byte strings with the same named reference and presence
   produce identical doctor output; no output contains either string.
8. Human and JSON doctor output agree on field IDs, sources, digests, redaction,
   state separation, approval authority, and existing isolation non-claims.
9. CLI, embedded service, and MCP receive equivalent approval/runtime configuration
   from the same compiled fixture.
10. Packaged Windows/macOS/Ubuntu paths resolve the same schema and defaults without
    platform-specific fallback.
11. Provider initialization/transport failure does not select another configured or
    discovered provider, and the failure names the attempted route without secrets.
12. A custom non-loopback Ollama endpoint remains attributable configuration and is
    never described as proof that inference is local.

## Explicit non-claims

Closing this task does not claim:

- public package publication, signing, notarization, registry ownership, provenance,
  or contributor-rights clearance;
- native restricted execution, credential containment, or sandbox-provider
  promotion;
- organization policy distribution, remote managed-policy transport, or a policy
  administration UI;
- OS-secret-store support, credential brokerage, secret rotation, or secrets in
  repository/user config;
- executable or YAML configuration, dynamic plugins, provider expansion, or
  arbitrary per-command defaults;
- verification-policy intersection, Rust protocol migration, or a second policy
  evaluator;
- CLI8 memory retrieval, learned-skill activation, background agents, or automatic
  workflow execution.

## I — implementation authorization

The design checkpoint is accepted. Implementation may begin with package 0, the
serial contracts-and-golden-fixtures freeze. Once that commit passes review, A/B/C
may run in parallel without reopening product architecture unless executable
evidence invalidates the contract. This documentation checkpoint does not itself
start runtime implementation.
