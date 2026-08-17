# ADR-0033: Sandbox policy compilation and provider conformance

- **Status:** Accepted architecture; Windows preview conformance partial; production provider acceptance open
- **Date:** 2026-08-10
- **Scope:** CLI ship-lane 7B, Forge-restricted execution, Tier-1 desktop platforms

## Context

Forge already distinguishes trusted, authenticated host-managed, and Forge-enforced
restricted execution. It validates provider capabilities, policy requests, and
resulting evidence, and it owns verifier process-tree cleanup. It does not yet turn a
restricted policy into an operating-system boundary. A provider that merely returns
the right evidence shape would therefore satisfy the type contract without proving
the boundary it claims.

Public implementations converge on several useful patterns without converging on one
portable primitive:

- Codex compiles a shared policy into native macOS, Linux, and Windows enforcement,
  separates approval from sandboxing, and describes a stronger managed Windows path
  plus a weaker compatibility fallback.
- Claude Code treats filesystem and network isolation as separate layers, uses
  Seatbelt on macOS and bubblewrap on Linux/WSL2, and routes policy expansion through
  an approval boundary.
- Gemini CLI exposes multiple sandbox providers and makes the active mechanism
  inspectable instead of pretending each provider has identical strength.
- Copilot's hosted agent uses a host-created appliance and firewall. That validates
  Forge's separate `host_managed` posture; it is not evidence that a local Forge
  process created or independently verified the same boundary.

These are architectural influences, not implementation dependencies. Forge needs a
small, original contract that can support native backends without inheriting another
project's runtime, licensing surface, or product assumptions.

## Decision

### 1. Compile policy before selecting or launching a process

Rust compiles the validated `IsolationPolicy`, `IsolationRequest`, and
`IsolatedProcessSpec` into one immutable `EffectiveSandboxPlan`. The plan records:

- the canonical executable and working directory;
- the exact required controls;
- the writable candidate root and explicit read-only/protected path posture;
- direct-network posture;
- credential and environment posture;
- descendant ownership, timeout, and output/resource bounds.

Compilation is deterministic and side-effect free. A provider must fully represent
every required item. Partial representation fails before the child is created.

### 2. Provider strength and availability are explicit facts

Providers report a bounded class and availability:

- `trusted_baseline`: no permission boundary;
- `external_attested`: a verified host claims the boundary, but Forge did not create
  or independently verify it;
- `native_fallback`: Forge applies native restrictions but documents controls or
  threat classes it cannot enforce;
- `native_strong`: Forge creates and verifies every advertised boundary control.

Availability is `available`, `setup_required`, or `unsupported`, with bounded reasons.
Compilation, installation, or configured intent alone cannot produce
`restrictedReady=true`.

### 3. Backends implement one narrow launcher contract

The backend receives only the compiled plan and cancellation signal. It must:

1. prove availability and exact representability;
2. establish all boundary objects before untrusted code can execute;
3. launch with explicit environment and handle inheritance;
4. bind descendants and resource limits;
5. return evidence identifying the actual provider, boundary, controls, class, and
   limitations;
6. clean up temporary identities, ACLs, profiles, proxy state, and processes; and
7. fail terminally if establishment or cleanup is uncertain.

The transaction coordinator remains the mutation authority. Sandbox providers run
verification against a disposable candidate; they do not gain a second write or
promotion path.

### 4. Network and credentials stay separate from process ownership

Job Objects and process groups prove lifecycle, not filesystem or network policy.
Environment clearing reduces accidental credential exposure, but does not prove that
the child cannot reach ambient credential stores. Direct network deny and any future
broker/proxy allowlist are a separate control with separate evidence. A provider that
cannot enforce them does not advertise them.

### 5. Native hierarchy

- **Windows preferred managed provider:** dedicated lower-privilege identity,
  disposable-candidate ACLs, private desktop, explicit handles/environment,
  outbound network enforcement, and Job Object ownership/resource limits.
- **Windows fallback:** restricted token plus the subset of candidate ACL, Job, and
  network controls that can be proved without setup. Its class and limitations remain
  visible. AppContainer may be evaluated as an optional strict provider.
- **macOS alpha/preview:** Seatbelt profile plus process-group/watchdog ownership and
  explicit network policy. A signed App Sandbox helper remains the durable release
  candidate.
- **Linux:** bubblewrap namespaces, `no_new_privs`, seccomp, and a separate network
  broker/namespace strategy.

No fallback silently satisfies a `native_strong` or all-controls policy.

### 6. Conformance is behavioral

Each advertised control requires a native negative and positive test:

- workspace/candidate access succeeds exactly as granted;
- filesystem reads and writes outside allowed roots fail;
- protected control paths remain unwritable;
- descendants stay in the lifecycle boundary and are removed on timeout,
  cancellation, normal parent exit, and Forge owner death;
- direct network access fails when denied and only brokered destinations work when
  explicitly granted;
- secret environment and platform credential channels are unavailable unless
  explicitly granted;
- CPU/time/output/process limits terminate or bound the workload;
- setup, launch, and cleanup faults fail closed and leave no durable permission
  residue.

`doctor` reports local probe facts. CI and release evidence record the adversarial
suite for each exact target. Neither substitutes for the other.

## Independent implementation and provenance discipline

Forge will use public documentation and observable contracts to understand design
tradeoffs, then write original code against operating-system APIs. We will not copy
provider source wholesale, mirror another project's internal module structure, or add
a runtime dependency merely to obtain branding-level parity. The ADR records design
influences. If literal code or a substantial licensed implementation is ever adopted,
that change must include a license review, provenance record, and any required NOTICE
before merge.

This discipline minimizes legal and architectural coupling. It does not erase credit:
the references below identify the projects that informed the decision.

### Evaluation-module terminology

Any Forge component that deliberately reproduces an established architecture,
composition pattern, or obvious public-API structure for comparison must be named
and documented as an **evaluation module** until separately promoted. An evaluation
module is conformance/test machinery used to measure whether a pattern fits Forge;
it is not evidence that Forge adopted the originating implementation, and it is not
a production provider merely because its tests pass.

Evaluation-module documentation must record:

- the external project, operating-system facility, or public design that influenced
  the experiment;
- the public material used: documentation, published API/types, license, and
  observable behavior;
- the architecture or obvious pattern reproduced;
- the Forge-specific authority boundaries and structural changes;
- whether any external executable/package is called through a published interface;
- dependency, license, maintenance, setup, and promotion status.

Forge may independently reproduce architecture, patterns, and code organization
that make sense within Forge's contract—for example, plan validation followed by
boundary preparation, suspended launch into an owner Job, evidence capture, and
cleanup/recovery. The resulting control flow, names, module layout, validation, and
tests must be original Forge work shaped around Rust's authority model. We do not
copy source verbatim or intentionally mirror non-public/internal implementation
details. If verbatim or substantial source reuse is ever proposed, it is no longer
this independent-evaluation path and requires a separate adoption decision and
legal/provenance review before implementation.

The current named evaluation modules are:

- **managed Windows provider evaluation module:** evaluates the documented
  dedicated-identity + ACL + WFP + broker/runner pattern. Its temporary adapter
  calls the pinned package only through published APIs; Forge's Rust plan, outer
  Job/resource ownership, lifecycle, evidence, and fail-closed selection are
  original and authoritative;
- **AppContainer evaluation module:** evaluates a platform-native strict alternative
  using documented Windows AppContainer, ACL, and Job Object APIs through an
  original Forge implementation;
- **provider-conformance evaluation module:** Forge-original plan exporter, shared
  adversarial corpus, normalization, measurement, and residue checks used to
  compare either execution approach without importing provider policy.

## Consequences

- Forge gains one policy language and evidence model without pretending the OS
  mechanisms are identical.
- Strong and fallback backends can coexist without weakening the meaning of
  restricted execution.
- Platform setup may be required for the strongest Windows path; that is visible in
  `doctor` instead of hidden in an installer side effect.
- macOS can be exercised sooner through a preview backend while preserving a durable
  signed-helper path.
- Native implementation and adversarial CI remain significant work. This ADR is not
  sandbox acceptance.

### Next contract-refinement gate (not yet accepted)

The current provider conformance work exposed a useful refinement that must be
decided before production provider promotion. The semantic policy should be
representable as four explicit stages:

1. `SandboxRequirements`: provider-neutral launch and security requirements;
2. `ProviderSupportReport`: a side-effect-free statement of exact representability;
3. `BoundSandboxPlan`: the selected provider/version/setup and enforcement mapping;
4. `SandboxLifecycleReceipt`: prepare, launch, observe, cancel, cleanup, recovery,
   and residue evidence.

This would prevent provider identity from contaminating semantic requirements,
remove any dual launch truth between a plan and a separate process specification,
and distinguish mechanism from enforcement assurance. The active VM/conformance
spike must first report whether this split preserves the existing corpus and Rust
authority. Until an ADR update accepts it, the existing `EffectiveSandboxPlan`
contract remains authoritative and adapters may not implement the proposed split
independently.

## 2026-08-11 Windows AppContainer preview checkpoint

The first Windows-native experiment now implements a disposable AppContainer
profile/SID, zero capabilities, explicit standard-handle inheritance, a minimized
environment, suspended launch into the existing resource-limited Job Object, and a
bounded recovery journal written before ACL/profile mutation. The journal records
only Forge-owned disposable-candidate paths and Forge adds/revokes only the unique
per-run SID; it does not mutate the active repository or external executable ACLs.

A recursive candidate-root grant was rejected after live testing showed that a deny
ACE for the AppContainer's restricted package SID did not reliably override the
inherited grant on `.git`. The preview instead grants the candidate root without
inheritance and grants each existing non-protected top-level entry, recursively only
below safe directories. Existing `.git`, `.forge`, `.agents`, and `.codex` entries
receive no package-SID grant. This is a bounded original implementation of the ADR's
policy contract, not borrowed provider code.

Nine local Windows conformance tests pass: profile/ACL lifecycle, allowed candidate
write, denied outside/protected writes, explicit environment, requested working
directory, timeout, cancellation, abandoned-journal recovery, and direct loopback
network denial. The provider deliberately remains `setup_required`; its native
launcher is conformance-only and production transactions still fail before launch.

### Explicit technical debt and improvement room

These are tracked design constraints, not implied acceptance:

1. **P0 - toolchain projection:** Node, npm, Cargo, compilers, shells, and their DLLs
   commonly live outside the candidate. Forge will not solve that by changing their
   ACLs. A first-party launch helper/package projection or a brokered read-only
   toolchain view must pass compatibility tests before production selection.
2. **P0 - root-path semantics:** the non-inheriting root grant protects existing
   metadata but does not give newly created root-level paths durable reopen semantics.
   A brokered filesystem projection or another native provider must replace this
   preview compromise for general developer workloads.
3. **P1 - credential breadth:** the test proves explicit/minimized environment state,
   not denial of every Windows credential, registry, named-pipe, COM, or broker
   channel. Each claimed channel needs its own negative probe.
4. **P1 - owner-death evidence:** startup recovery is tested by an abandoned boundary
   fixture and the Job Object already owns descendants, but a separate-process forced
   owner-death test must prove both process and ACL/profile cleanup behavior.
5. **P1 - network evolution:** zero AppContainer capabilities prove direct loopback
   deny. Any future allowlist must use an explicit broker/proxy and must not silently
   add broad internet capabilities.
6. **P2 - bounded ACL fan-out:** the preview accepts at most 256 existing safe
   top-level entries and a 16 KiB recovery record. Monorepo performance and unusual
   layouts need measured fixtures before changing those limits.
7. **P2 - durability:** the journal file is flushed before mutation and startup
   recovery is bounded, but directory-entry durability and injected cleanup failures
   still need a dedicated Windows fault harness.
8. **Strategic option:** the managed lower-privilege identity + WFP/firewall + private
   desktop provider remains the preferred enterprise path if it offers better
   toolchain compatibility. It must implement the same plan/evidence contract rather
   than create a parallel runtime.

## 2026-08-11 product-allocation update

[ADR-0034](ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md)
classifies native sandboxing as a required commodity platform boundary rather than
Forge's innovation lane. This ADR's provider contract, conformance rules, and honest
readiness requirements remain unchanged. The AppContainer preview is frozen at
conformance quality while a bounded managed-Windows compatibility spike evaluates
the established dedicated-identity/WFP/broker pattern. Native provider completion
does not block the trusted alpha or the first evidence-to-memory-to-reviewed-skill
vertical slice.

## 2026-08-11 bounded commodity-provider spike

The pinned `@anthropic-ai/sandbox-runtime@0.0.71` was evaluated only through a
temporary adapter/probe. The probe consumes Rust-emitted `EffectiveSandboxPlan`
case records and refuses a plan for another provider; it does not compile policy,
select a provider, or call the package's install/uninstall APIs.

The package is Apache-2.0 licensed and exposes useful published library/status
surfaces, but its Windows backend is an alpha, dedicated-user/WFP/ACL system with
one-time elevated setup. On this workstation the vendored `srt-win.exe` was
present, while every read-only Windows status probe failed at process creation with
`EPERM`; the dependency check reported `srt-win user status failed: spawn EPERM`.
No UAC prompt, account creation, WFP mutation, or ACL mutation was attempted.
The package has four direct runtime dependencies (`@pondwader/socks5-server`,
`commander`, `node-forge`, and nested `zod`), and the repository audit reported
zero known vulnerabilities across 144 installed dependency entries.

Recommendation: adapt the commodity provider pattern behind the existing Rust
contract, but do not adopt `sandbox-runtime` as Forge's policy/runtime authority
and do not build another bespoke universal primitive. Keep the exact dependency
only as an unmerged, temporary spike input; remove it before merge/package
publication unless a later implementation slice explicitly accepts its Windows
setup, lifecycle, compatibility, licensing-notice, and maintenance obligations.
The production decision remains open until the same plan is exercised on an
approved Windows host with setup complete and the full adversarial matrix passes.

## 2026-08-12 completed commodity-provider follow-up

After explicit approval, the published Windows installer provisioned the dedicated
account/group, DPAPI credential state, and SID-scoped WFP fence. Rust now emits a
schema-v4 plan that binds canonical readable, denied-read, denied-write, and
writable roots into both launch and plan identities. A fresh 17-record corpus then
passed 17/17 through the temporary SRT adapter, including sensitive read and
outside/protected write denial, direct network denial, explicit-only environment,
normal descendant exit, timeout, cancellation, broker owner death, process/ACL/
recovery residue, and shell/Node/npm/Git/Cargo/rustc compatibility.

The final measured means were 1,196.59 ms boundary setup, 1,116.80 ms reset, and
325.05 ms launch. This is acceptable spike evidence but expensive default-local
overhead. The published API still cannot represent Forge's process-count and
process-memory ceilings, so resource-bearing plans fail before launch. The package
was removed from the application manifest/lock. The current disposable-lab path
installs it from a separately attributed, exact-version, payload-local lock with
scripts and network disabled; it remains evaluation-only.

The recommendation remains **adapt**. The next implementation slice must be
Rust-owned, compose full resource enforcement, and execute the same corpus against
the managed provider and AppContainer in the VM lab. Until then both production
selection and `restrictedReady` remain closed. See
[Checkpoint 82](../checkpoints/2026-08-12-82-commodity-sandbox-conformance-completion.md).

## 2026-08-12 Rust-owned managed-provider local gate

The follow-up now composes the pinned provider machinery beneath Forge's complete
five-control schema-v4 plan and resource-limited Job Object. Direct execution is
conformance-only: Rust validates the plan and returned executable, launches the
prepared provider runner, controls timeout/cancellation/descendants, confirms Job
emptiness, and owns evidence. The adapter may initialize, prepare, and reset the
published provider boundary; it cannot select providers, compile policy, weaken a
control, or fall back.

The same fresh 17-case corpus passed 17/17 against the managed adapter and 17/17
against AppContainer, including separate-process Forge-owner death and before/after
ACL residue checks. Mean per-case latency was 8,940.12 ms for the cold managed path
and 1,972.14 ms for AppContainer. The comparison closes the local full-control
same-plan gap and shows a material managed-provider cold-start cost; it does not
close package, disposable-host, uninstall, hosted, credential-channel, or Tier-1
cross-platform gates.

Kernel probe v4 reports the selected trusted baseline separately from candidate
statuses. Both Windows candidates remain `setup_required` and
`restrictedReady=false`. Doctor is side-effect-free and deliberately does not
execute environment-configured adapter code. The root application dependency
remains absent; the exact package exists only under a temporary evaluation root.
Recommendation remains **adapt**, with the next production gate scoped to a
separately packaged payload lifecycle in the disposable Windows lab. See
[Checkpoint 83](../checkpoints/2026-08-12-83-managed-windows-provider-adapter-local-gate.md).

## 2026-08-12 packaged lifecycle preparation

The next bounded slice prepares, but does not execute, the disposable-host gate. A
new evaluation-payload builder records exact published archive hashes, all five
package identities/licenses, license texts, third-party notices, the original Forge
adapter hash, and explicit evaluation-only/no-verbatim-source provenance. Bundle
schema 2 binds that payload separately from the Forge application graph and rejects
extra as well as missing or changed files.

The guest lifecycle evaluation module now has write-once phases for payload verify,
elevated install, post-install hard-reboot verification, one Rust-exported corpus
against both candidates, elevated uninstall, post-uninstall hard-reboot residue
verification, and finalization. Rust still owns both executions and all plan,
resource, lifecycle, and evidence decisions. A chained host log and independent
schema-2 finalizer require clone creation/start, both resets, artifact export,
shutdown, and destruction. No VM or host mutation was performed.

The gate intentionally remains open: only `0.0.71` is approved, so a real upgrade
cannot be evidenced without a second separately audited exact pin and a two-payload
upgrade phase. Hardware virtualization, VirtualBox, the licensed Windows template,
and the first VM run are also absent. This preparation changes neither candidate's
`setup_required` status nor the **adapt** recommendation. See
[Checkpoint 84](../checkpoints/2026-08-12-84-packaged-provider-lifecycle-gate-preparation.md).

## Rejected alternatives

- **Vendor another harness sandbox runtime:** faster initially, but imports policy,
  release, and licensing assumptions that would become Forge's core dependency.
- **One universal container dependency:** not native to every developer desktop and
  not equivalent to the required workspace/IDE interaction.
- **Treat a restricted token, Job Object, worktree, or cleared environment as the
  full sandbox:** each is useful defense in depth, but none proves all five controls.
- **Turn readiness on from feature detection:** availability is not behavioral
  conformance.
- **Let TypeScript choose or claim the boundary:** Rust remains the policy,
  transaction, launcher, and evidence authority; TypeScript presents and integrates.

## References and influences

- [OpenAI: Codex sandboxing](https://learn.chatgpt.com/docs/sandboxing)
- [OpenAI: Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [OpenAI: agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Anthropic: Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Anthropic experimental sandbox runtime](https://github.com/anthropic-experimental/sandbox-runtime)
- [Google: Gemini CLI sandboxing](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md)
- [GitHub: Copilot coding-agent firewall](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-the-firewall)
- [Microsoft: AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)
- [Microsoft: Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Apple: App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)
