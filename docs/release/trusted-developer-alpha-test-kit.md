# ForgeEngine trusted developer alpha test kit

This bounded kit exercises the Rust-authoritative private trusted-alpha
acceptance candidate. It does not promote a restricted provider, add a containment
claim, activate CLI8 learning work, prove contributor-rights attestation, or
publish a public release.

## Prerequisites

- Node.js 22 or newer and npm;
- Rust 1.97.1 for source-built acceptance;
- Git for workspace evidence; and
- the platform build tools listed in the root README.

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
conformant onboarding, and a real Rust-backed inspection. It then runs an exact-
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
