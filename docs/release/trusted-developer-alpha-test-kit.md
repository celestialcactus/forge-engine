# ForgeEngine trusted developer alpha test kit

This bounded kit exercises the Rust-authoritative private trusted-alpha
acceptance candidate. It does not promote a restricted provider, add a containment
claim, activate memory retrieval/ranking, insert memory into planner/provider
context, activate skills, prove contributor-rights attestation, or publish a public
release.

PR #34 merge `9bba75e` is the accepted Slice 4 baseline. `memory preview` is the
active, unaccepted Slice 5 candidate until its exact local, package, hosted, and
merge gates complete.

## Prerequisites

- Node.js 22 or newer and npm;
- Rust 1.97.1 for source-built acceptance;
- Git for workspace evidence; and
- the platform build tools listed in the root README.

Packaged end users do not need a compiler: the install must supply the matching
exact-version `forge-engine-kernel-<platform>-<arch>` optional package. The source
acceptance path does compile the kernel. On Windows it specifically requires the
`x86_64-pc-windows-msvc` Rust toolchain, Visual Studio Build Tools 2022 with the
**Desktop development with C++** workload, the MSVC x64/x86 build tools, and a
Windows 10 or Windows 11 SDK. Open the x64 Native Tools developer terminal (or launch
VS Code from it) and verify:

```powershell
rustup show active-toolchain
where.exe link
where.exe rc
```

`npm run check` does not compile the Rust kernel. Use `npm run onboard` for the
one-command source path, or run `npm run build:product` before invoking
`node dist/src/cli.js`. A fresh source build should leave the native binary at
`target/debug/forge-kernel.exe` on Windows or `target/debug/forge-kernel` on
macOS/Linux. Because `target/` is ignored and discovery is checkout-relative, a
binary built in a different worktree does not satisfy this prerequisite.

Trusted verification inherits the launching developer account's filesystem,
network, credentials, privileges, and resource access. Forge owns process
lifecycle and transaction policy; that is not an accepted OS sandbox.

## One-command paths

Build the source product and report runtime readiness, current precedence status,
and release blockers:

```powershell
npm run onboard
```

Exercise the current host's exact-version main/native package lifecycle in an
empty disposable project:

```powershell
npm run release:smoke
```

The package smoke builds release binaries, packs the main and target-native npm
packages, and installs both with scripts disabled into an isolated project and
home. It sanitizes every covered environment variable, exercises fixed user and
workspace configuration paths, safe no-overwrite initialization, validation,
redacted show/doctor output, partial-route refusal before kernel/provider work,
conformant onboarding, installed autosave `ask → auto → off`, and a real
Rust-backed memory eligibility preview and workspace inspection. It then runs an exact-
pair update and uninstalls both packages. It removes its temporary project unless
`FORGE_KEEP_PACKAGE_SMOKE=1` is set.

Capture `forge config show --json`, `forge doctor --json`, and
`forge onboard --json` as support evidence. Config show and doctor project the same
ordered twelve-field, redacted, source-attributed configuration truth; doctor adds
kernel, state-separation, Rust approval-authority, and isolation facts. Onboard
reports configuration precedence as conformant while retaining the independent
rights and signing/provenance blockers.

## Configuration experience

Forge uses exactly two product files: `<workspace>/.forge/config.json` and
`~/.forge/config.json`. The user path is independent of `engineRoot`. Use:

```powershell
forge config path [workspace|user]
forge config init <workspace|user>
forge config validate --json
forge config show --json
```

`config path` does not read file contents. `config init` atomically writes a
minimal schema-v1 document and refuses to overwrite an existing file. `validate`
compiles the complete effective configuration, so malformed files, ineligible
fields, and partial routes fail with a location, message, and next-action hint.
`show` reports values only for non-secret fields; the OpenAI credential diagnostic
contains its fixed reference and presence, never credential bytes. These commands
do not require Rust, construct a provider, or probe a network endpoint.

## Memory control experience

Repository decisions remain explicit through `forge memory remember`. Slice 3 adds
a separate local capture control for direct developer preferences:

```powershell
forge memory autosave status
forge memory autosave off
forge memory autosave ask
forge memory autosave auto
forge memory find "concise test output"
forge memory explain "concise test output"
forge memory forget "concise test output"
forge memory history "concise test output"
forge memory restore "concise test output"
forge memory purge "concise test output"
forge memory history clear
forge memory preview
forge memory preview --max-bytes 1024 --json
```

`ask` is the default. These commands are not workspace configuration: checked-in
files, model output, tools, and providers cannot enable or widen the standing
grant. Slice 3 accepts only a grant for the current repository and local developer
actor. In interactive Forge, a narrow safe statement such as `I prefer concise
test output.` saves without pausing in `auto` and prints `Remembered · /memory undo
· /memory explain`. Other preference-like statements ask; ordinary prompts are
ignored by capture; secret-like or authority-changing content is ineligible.

`forget` removes a selected memory from normal results but keeps it in bounded
recovery for `restore`. `purge` irreversibly removes the selected lineage from
active and recovery memory; `history clear` irreversibly removes all recoverable
content while retaining active memory. The two irreversible commands confirm in a
terminal and require `--yes` in noninteractive or JSON automation. Their receipts
contain operation metadata but no claim text, observation/claim/target ID, content
digest, or reversible content fingerprint.

Immediate `/memory undo` removes the just-admitted content from Forge memory state
without a recovery copy. It does not erase independently retained run artifacts,
conversation logs, backups, filesystem journals, or storage media. Memory remains
excluded from planner/provider prompt context until the separately gated CLI8B
evaluation.

`memory preview` is a Rust-authoritative, read-only eligibility report over the
exact current repository and local developer scopes. It defaults to 65,536 bytes,
never exceeds 262,144 bytes, and reports selected active records plus stable
omission reasons. Forgotten and recovery content are counted only in aggregate;
purged and cross-repository content remain absent. It does not compact recovery or
change saved memory records. Human output says that nothing was sent to a model,
and JSON reports `retrievalActive=false`,
`plannerInjection=false`, and `providerWorkPerformed=false`.

## Prompts and expected evidence

1. Command: `forge inspect --json --max-files 10`.
   Expected evidence: a completed Rust-authoritative run artifact with a bounded
   workspace snapshot and no mutation.
2. Command: `forge search "ForgeEngine" --json --max-matches 10`.
   Expected evidence: bounded workspace-relative matches with attributable line
   evidence.
3. Command: `forge doctor --json`.
   Expected evidence: exact kernel path/source/version/protocols, run-store root,
   all twelve effective configuration fields with sources and stable redacted
   digests, approval source, trusted isolation posture, and no restricted-ready
   claim unless a separately accepted provider supplies it.
4. Optional local-inference prompt: start `forge --provider ollama --model
   <installed-model>` and ask `Summarize the bounded README evidence.`
   Expected evidence: one Rust-owned run with explicit provider/model routing,
   bounded capability evidence, and no implicit cloud fallback.
5. Before any governed change, review the proposal, verification policy, and exact
   approval. Expected evidence is the Rust-owned transaction artifact; do not use
   the test kit to experiment on a valuable workspace.

## Report an issue

Copy this template into a new issue or private maintainer report:

```text
ForgeEngine trusted developer alpha report

Main/native package versions:
Source commit and workflow run URL:
OS and architecture:
Node/npm/Rust versions:
Kernel source from doctor:
Command and prompt:
Expected evidence:
Observed output (redact secrets and repository content):
Reproduction steps:
Did the issue involve explicit configuration or environment variables? yes/no
Was this trusted execution? yes/no/unknown
Security-sensitive details: use the private maintainer channel, not a public issue.
```

Never upload credentials, environment values, private repository contents,
transaction replacement text, or raw sensitive kernel output.
