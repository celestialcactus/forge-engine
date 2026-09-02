# 2026-09-02 - CLI8A Slice 4 merges and bounded Slice 5 preview is authorized

- PR #34 merged the Checkpoint 94 Slice 4 privacy lifecycle into `develop` at
  `9bba75e`; recoverable forget/restore, selected-lineage purge, and
  recovery-history clear are now accepted baseline behavior.
- The reviewer approved CLI8A Slice 5 only as a deterministic baseline eligibility
  preview over the exact current repository and requesting developer scopes.
- Rust owns selection, omission reasons, scope validation, ordering, preview
  identity, and byte accounting. TypeScript owns invocation and human/JSON
  presentation without recomputing admission.
- The default preview budget is 65,536 UTF-8 bytes and the maximum is 262,144.
  Unresolved evidence-bound and run-bound freshness fails closed; only explicitly
  declared contradictions count as conflicts in this slice.
- Slice 5 does not authorize a task query, semantic ranking, planner/provider or
  network work, memory insertion into planner/provider prompt context,
  recovery-content disclosure, CLI8B retrieval, or CLI8C skills. This is not a
  claim of general prompt-injection resistance.
- A separate terminal observable-activity lane passed its Product Gate on the same
  date. Its architecture/program design and implementation remain separately gated;
  shared CLI, smoke, and documentation integration must be serialized.

# 2026-09-02 - CLI8A Slice 4 passes the local and hosted privacy gate

- PR #34 implementation candidate `20b9bac` is accepted for merge through
  [Checkpoint 94](checkpoints/2026-09-02-94-cli8a-memory-slice-4-hosted-gate.md).
- The accepted boundary adds recoverable forget/restore, selected-lineage purge,
  recovery-history clear, content-minimized receipts, exact destructive
  confirmation, and truthful output about independently retained runs, artifacts,
  conversations, backups, and media.
- Rust remains authoritative for exact actor/scope and lineage validity, durable
  locking, rebuild, recovery, and atomic rewrite before acknowledgement; TypeScript
  owns orchestration and human/JSON UX.
- The exact gate includes 200 Rust tests, 165 Node tests, 61/68 hybrid scenarios
  with seven explicit skips, RustSec, clean-install privacy lifecycle, native
  packing, benchmark assertion, and both full hosted workflows on Windows x64,
  macOS ARM64/x64, and Ubuntu x64.
- Review found and corrected a multi-version lineage defect across correction,
  forget, compaction, restart, and restoration of an older version. The final
  candidate has a deterministic regression for that sequence.
- Slice 5 context preview, planner/provider retrieval, CLI8B evaluation, CLI8C
  skills, wider grants/scopes, and erasure outside Forge memory remain unclaimed
  and unauthorized.

# 2026-09-02 - CLI8A Slice 4 privacy lifecycle is explicitly authorized

- The reviewer approved the existing Product, Architecture, Program Design, and
  Vertical Slice boundary for Slice 4 after Slice 3 merged and passed the
  post-merge `develop` gate.
- The authorized user proof is limited to forgetting and restoring a memory,
  purging selected active/recovery content, and clearing recovery history while
  retaining active memories. Ordinary forget remains recoverable; explicit purge
  and history clear use the Rust-authoritative atomic rewrite path.
- Purge and clear must survive restart and failure injection, return only
  content-free receipts without reversible fingerprints, and state truthfully
  that independently retained runs, artifacts, conversations, backups, and media
  are outside the memory-store operation.
- TypeScript owns orchestration and accessible human/JSON UX; Rust continues to
  own lifecycle validity, exact scope, durable locking, rewrite atomicity,
  projection rebuild, retention, and final acknowledgement.
- This authorization does not accept an implementation and does not authorize
  Slice 5 context preview, planner/provider retrieval, CLI8B evaluation, CLI8C
  skills, developer-profile grants, or team/organization memory.

# 2026-09-01 - CLI8A Slice 3 passes the hosted and real VS Code gate

- PR #33 implementation candidate `26f011e` is accepted through
  [Checkpoint 93](checkpoints/2026-09-01-93-cli8a-memory-slice-3-hosted-gate.md).
- The accepted boundary is deliberately narrow: current-repository `off|ask|auto`,
  exact developer-ledger standing grants, bounded direct-preference eligibility,
  visible attribution, narrow immediate undo without a recovery copy, and the same
  Rust grant authority across CLI and conversation orchestration.
- The gate includes 195 Rust tests, 162 Node tests, 60/67 hybrid results with seven
  explicit skips, RustSec, clean-install package lifecycle, native packing,
  benchmark assertion, all nine declared hosted jobs, a separate real Windows PTY,
  and the user's exact-head VS Code integrated-terminal Backspace/`/help`/`/exit`
  confirmation.
- The UX investigation corrected two real adapter defects rather than weakening
  the gate: terminal output was first bound explicitly, and the final candidate
  separates owned TTY editing from queued non-TTY pipe ingestion while preserving
  Rust run and memory authority.
- Retrieval, planner/context injection, developer-profile grants, privacy
  forget/purge/history-clear, context preview, skills, and Slices 4–5 remain
  inactive. The next smallest lane is a separate four-gate review and explicit
  authorization of Slice 4.

# 2026-08-31 - CLI8A Slice 3 candidate corrects the interactive PTY gate

- Candidate `afa6e67` implements current-repository `off|ask|auto` controls. The
  standing grant and developer preference live in the exact developer ledger; the
  grant carries the repository identity, and developer-profile grants fail closed.
- TypeScript limits no-pause auto capture to a narrow deterministic
  presentation/style grammar. Preference-like ambiguity falls back to `ask`;
  normal task text is ignored, and secret-like, structured/remote,
  authority-changing, repository, model, and tool material cannot use the auto
  candidate path.
- Rust validates the active grant, actor, exact provenance and scope, appends before
  acknowledgement, and performs immediate undo as a narrow atomic rewrite with a
  content-free receipt and no recovery copy. Ordinary find/show/explain see the
  developer preference across process restart; planner/provider retrieval remains
  inactive.
- The first live VS Code pilot found that terminal input was accepted but rendered
  invisibly because the readline terminal adapter omitted its output stream. Candidate
  `33ee986` supplies the exact output stream and adds a terminal-stream regression that
  proves both prompt rendering and typed-command echo. The pilot must pass again on the
  corrected candidate before acceptance. Follow-up `5c84a97` removes the doubled-period
  undo notification exposed by that PTY pilot.
- The first corrected hosted attempt then exposed a Linux stdout-drain race: the memory
  adapter parsed on child `exit` before the protocol stream closed. Candidate `3849cd0`
  waits for `close` and adds a deterministic delayed-writer regression.
- The corrected local Windows x64 gate passes 195 Rust tests with 16 explicit ignores, 161
  Node tests, real memory and configured-interactive product fixtures, RustSec,
  clean-install ask/auto/off lifecycle, native packing, and the 20-sample benchmark
  assertion. Hosted target, merge, and checkpoint acceptance remain open; Slices
  4–5 and CLI8B/C remain unauthorized.

# 2026-08-31 - CLI8A Slice 3 autosave proof is explicitly authorized

- Approved the restated Product, Architecture, Program Design, and Vertical Slice
  boundary for repo-scoped autosave `off|ask|auto`; `ask` remains the default.
- Only local user action may create or revoke an actor/scope-bound standing grant.
  Rust validates grant, provenance, scope, and durable admission; TypeScript owns
  bounded candidate eligibility, orchestration, and `Remembered · Undo · Explain`
  presentation.
- Secrets, capability/approval changes, model/tool/repository text, speculative
  inference, organization policy, scope widening, and ambiguous candidates cannot
  auto-save. Ambiguity falls back to `ask`; undo removes the just-admitted content.
- This authorization does not include Slice 4 forget/purge/history-clear, Slice 5
  context preview, CLI8B retrieval, or CLI8C skills.

# 2026-08-31 - CLI8A memory Slices 0–2 pass the hosted gate

- Exact implementation candidate `e9e8cd9` passed cross-platform run `33433043538`
  and hybrid run `33433043562`: Node, RustSec, Rust, hybrid, source
  product, native package, clean-install package, and benchmark gates on Windows
  x64, macOS ARM64, macOS x64, and Ubuntu x64.
- The first hosted candidate exposed a Windows-only `.exe` name in the memory
  hybrid fixture. The replacement exposed an existing 10-ms service-timeout test
  racing workspace snapshot construction on loaded macOS x64. The final candidate
  uses the native kernel filename and a deterministic snapshot fixture with a
  bounded planner-cancellation deadline.
- An earlier hybrid attempt passed macOS x64 behavior through the clean-install
  package proof, then GitHub artifact upload failed with DNS `ENOTFOUND`. Its
  targeted retry exposed a concurrent temporary-root collision in the two new
  retention tests. The final candidate adds a process-local atomic test nonce and
  passed 100/100 focused repetitions before the complete hosted rerun; no product
  lock or retry semantics were weakened.
- [Checkpoint 92](checkpoints/2026-08-31-92-cli8a-memory-slice-0-2-hosted-gate.md)
  accepts explicit remember/inspect/correct/recovery through PR #32. Autosave,
  forget/purge/history-clear, context preview/retrieval, and skills remain gated.

# 2026-08-31 - CLI8A Slice 0–2 passes the independent local product gate

- Exact implementation `6f37c8c` passed in a clean VS Code worktree using Rust
  1.97.1, Visual Studio Build Tools 2022 17.14.37614.0, MSVC 14.44.35207, and
  Windows SDK 10.0.26100.0.
- The four focused memory binaries passed 16/16, `npm run check` passed 154/154,
  the source kernel built/probed as `source-debug`, and the focused real-CLI hybrid
  passed 1/1.
- Fifteen separate CLI processes proved remember across restart, natural selectors,
  explainable provenance/scope, bounded correction/history, restore, and final
  erase-previous. One active version remained, erased prior content was absent from
  Forge memory state, stderr was empty, and retrieval/provider/network activity
  remained inactive.
- The authoritative follow-up passed the full product gate (191 Rust tests with 16
  explicit ignored cases, 154 Node tests, 59/66 hybrid with seven explicit skips,
  and source smoke), RustSec over 46 dependencies, clean-install package lifecycle,
  native archive packing, and a 20-sample benchmark with 90.757-ms Rust bridge p95.
- Initial hosted run `33429950359` exposed a Windows-only `.exe` filename in the new
  memory hybrid fixture after Rust and Node checks had passed on macOS ARM64 and
  Ubuntu x64. The fixture now selects the platform-native kernel filename; focused
  and full local hybrid reruns pass before the replacement hosted run.
- This closes the local supported-toolchain and separate VS Code product gate only.
  Hosted targets, merge, and Slices 3–5 remain explicitly unaccepted.

# 2026-08-29 - CLI8A Slice 0–2 four-gate packet is approved and implemented as a candidate

- Approved the individual-developer product outcome and explicit non-claims, the
  Rust-authority/TypeScript-orchestration split, bounded recovery, and the six-slice
  dependency graph. Only prerequisite Slice 0 and implementation Slices 1–2 are
  authorized; Slices 3–5 remain gated.
- Accepted ADR-0039 as the capture/recovery amendment to ADR-0038. The alpha safety
  budgets are 8-KiB normalized text, 64-KiB frames, 48-MiB compaction trigger,
  64-MiB ledger, 4,096 active records, and recovery bounded by 30 days, five
  versions, and 16 MiB per exact scope. A total-engine multi-scope budget remains
  deferred pending evidence.
- Implemented the candidate Rust hash-linked NDJSON ledger, projection rebuild,
  correction/recovery/restore, erase-previous rewrite, one-request kernel bridge,
  and TypeScript CLI orchestration for remember/find/show/explain/correct/history/
  restore. Retrieval, provider/planner injection, autosave, forget/purge, and skills
  remain inactive.
- Focused Rust tests and clippy initially passed under the available GNU-LLVM
  toolchain; the later 2026-08-31 entry records the exact MSVC and separate VS Code
  pass. Hosted and merge evidence remain before checkpoint acceptance. See
  [ADR-0039](ADRs/ADR-0039-cli8a-hybrid-memory-capture-and-recovery.md) and the
  [four-gate packet](../tasks/CLI8A-MEMORY-FOUR-GATE-REVIEW.md).

# 2026-08-28 - Consequential work adopts four proportional approval gates

- Connected Forge's existing build plan, task, ADR, fixture, and checkpoint
  practices into one explicit Product, Architecture, Program Design, and Vertical
  Slices workflow. Full approval is required before consequential implementation;
  fast and compact paths keep low-risk changes proportional.
- Required Program Design to freeze file layout, types/signatures, call stacks,
  errors, fixtures, shared boundaries, and ownership before parallel packages
  begin. Vertical slice packets must name independent evidence, merge order, and
  re-steer points.
- Preserved completed CLI8A Package 1 candidate work and required the later
  combined packet to be the first full-path application. That packet was approved
  for Slice 0–2 on 2026-08-29; this entry records the workflow decision at adoption.
  See the [workflow](../development/four-gate-delivery-workflow.md),
  [template](../tasks/FOUR-GATE-TASK-TEMPLATE.md), and
  [CLI8 task](../tasks/SLICE-CLI8-differentiated-learning-loop.md).

# 2026-08-20 - CLI8A memory policy is locked before implementation

- Accepted separate semantic claim and attributable observation identities, exact
  tagged scopes, and conservative `memory_text_v1` normalization. The normalization
  deliberately preserves case, punctuation, internal whitespace, Unicode, paths,
  and identifiers rather than attempting an opaque semantic merge.
- Required explicit remember/review admission for durable developer preferences;
  incidental conversation, model prose, repository text, and inferred behavior
  cannot silently become developer-scoped instruction.
- Separated append-only forgetting from explicit privacy purge and selected
  evidence-driven freshness instead of a universal TTL. Purge receipts retain no
  claim/observation digests or content and do not imply canonical run/artifact
  deletion.
- Kept the first CLI8A increment runtime-inactive and rejected a verbatim replay of
  stale candidate `b5effea`. Only conforming bounded types, limits, lifecycle ideas,
  and adversarial fixtures may be reimplemented. See [ADR-0038](ADRs/ADR-0038-cli8a-memory-identity-admission-and-retention.md)
  and [CLI8](../tasks/SLICE-CLI8-differentiated-learning-loop.md).

# 2026-08-19 - CLI7 effective configuration passes the hosted gate

- Accepted one immutable effective configuration across CLI, interactive,
  provider, embedded service, MCP, doctor, and onboarding paths. Fixed user and
  workspace JSON files, strict source eligibility, atomic provider/model routing,
  monotonic approval/budget ceilings, and secret-safe source/digest diagnostics
  now pass the local and clean-install product gates.
- Added a tight kernel-free configuration UX through `forge config path`, `init`,
  `validate`, and `show`; invalid present configuration fails before kernel or
  provider work and safe initialization never overwrites an existing file.
- Exact candidate `e7ba284` passed hosted Node and hybrid/native/package/benchmark
  workflows on Windows x64, macOS ARM64, macOS x64, and Ubuntu x64. This closes
  CLI7-ALPHA-CONFIG and makes bounded CLI8 memory policy and attributable
  observation/replay the next product lane.
- Retained the public rights/signing/provenance, native restricted-containment,
  organization inference-governance, OS secret-store, and CLI8 activation
  non-claims. See [Checkpoint 91](checkpoints/2026-08-19-91-effective-configuration-hosted-gate.md)
  and [CLI7-ALPHA-CONFIG](../tasks/SLICE-CLI7-ALPHA-effective-configuration.md).

# 2026-08-19 - CLI7 inference governance and configuration scope are locked

- Clarified ADR-0036: Forge owns correct configuration resolution, attributable
  provider/model routing, no silent cross-provider fallback, secret safety, and the
  capability/mutation/approval boundaries intrinsic to the harness. The operator or
  organization owns the acceptability and cloud/data-isolation boundary of its
  selected inference environment.
- Kept workspace provider/model selection for developer convenience while forbidding
  repository control of endpoints, credential references, executables, and state
  roots. A custom remote endpoint is not described as local merely because it uses a
  local-provider adapter.
- Removed provider ceilings, organizational RBAC/data-residency policy, and a remote
  enterprise-policy subsystem from CLI7 scope. Managed facts remain a trusted-host
  input, and future organization integrations require concrete requirements and a
  separate gate.
- Accepted the CLI7 effective-configuration design lock. At this design-lock
  checkpoint, the next serial action was the contracts-and-golden-fixtures freeze;
  the later implementation acceptance is recorded above.
  See [ADR-0036](ADRs/ADR-0036-alpha-distribution-and-configuration-contract.md) and
  [CLI7-ALPHA-CONFIG](../tasks/SLICE-CLI7-ALPHA-effective-configuration.md).

# 2026-08-18 - Trusted-alpha replay passes the hosted gate

- Accepted the authoritative replay as a private trusted-developer alpha
  foundation after Node run `32128145647` passed Windows/macOS/Ubuntu and
  hybrid/native/RustSec run `32128145686` passed the Rust/TypeScript product gate
  on Windows/macOS/Ubuntu plus the advisory audit.
- Retained honest boundaries: no public publication, no restricted-containment
  claim, and no activation of the deferred sandbox or CLI8 lanes. Contributor
  rights, configuration-loader conformance, and artifact provenance were open at
  that checkpoint; Checkpoint 91 later closes configuration conformance.
  See [Checkpoint 90](checkpoints/2026-08-18-90-trusted-alpha-hosted-gate.md).

# 2026-08-17 - Repository authority and release contracts are explicit

- Made reconstruction lineage—not a stale local path—the repository authority.
  New lanes must contain PR #25 anchor `5fff597` and the fetched
  `origin/develop`; stale candidates are replay-only. See ADR-0035 and Checkpoint
  89.
- Selected Apache-2.0 for Forge-authored distributions, aligned npm/Cargo/native
  package metadata, and retained a separate pre-publication rights attestation.
- Accepted Windows x64 and macOS ARM64/x64 for the trusted alpha, Ubuntu x64 as a
  compatibility target, and deferred Windows ARM64/Linux ARM64. Accepted
  selection precedence plus monotonic policy tightening in ADR-0036.
- Accepted per-contract live negotiation and copy-on-write durable migration in
  ADR-0037, calibrated against public MCP, Codex, Claude Code, and Gemini CLI
  protocol/release patterns.
- Added the system/build map and a memory-semantics primer. Memory normalization,
  preference promotion, privacy purge, expiry defaults, evaluation thresholds,
  and the final public extension promise remain explicit gates.

# 2026-08-17 - Trusted-alpha candidate is replayed onto canonical develop

- Preserved stale candidate `a023119` and replayed only its bounded release intent
  through `c89e888` and then onto the accepted authority checkpoint `d654a92`; no
  stale ancestry was merged.
- Adapted onboarding and install/run/update/uninstall evidence to the accepted
  Rust-authoritative, exact-version native package contract in ADR-0032. The
  hosted and public release gates remain distinct.
- Reconciled the candidate with Apache-2.0, the accepted alpha target matrix, and
  the configuration/secret precedence contract. Pre-publication rights
  attestation and hosted acceptance remain open. The candidate does not promote a
  restricted provider or activate CLI8 learning work. See
  [Checkpoint 43](checkpoints/2026-08-17-43-trusted-alpha-release-gate.md).

# 2026-08-17 - Documentation ground truth and lane baselines are reconciled

- Reconciled the ForgeEngine documentation hierarchy and active-lane truth on top
  of accepted implementation baseline `4e15226`. The V1 build plan remains the
  architecture/roadmap authority; `docs/execution/current.md` is now the short
  operational index, and release profiles define permitted containment and
  distribution claims.
- Release candidate `a023119` and learning candidate `b5effea` are explicitly
  replay-required because their worktrees were created from stale baseline
  `aa73e0e`; neither is accepted state. The sandbox lifecycle lane remains
  independent and unpromoted. See Checkpoint 88.
- Recorded a not-yet-accepted ADR-0033 refinement gate separating provider-neutral
  sandbox requirements, provider support facts, provider binding, and lifecycle
  receipts. Existing `EffectiveSandboxPlan` authority remains unchanged until the
  VM/conformance lane proves the refinement.

# 2026-08-13 - ForgeEngine and Project Sybil are separate projects

- Corrected the product identity: ForgeEngine remains an independent sovereign,
  context-aware developer CLI and software-evidence harness. Project Sybil is an
  independent sovereign agent-orchestration platform, not Forge's starshot,
  generalized mode, repository subproject, or eventual rename.
- Forge pilot results may inform Sybil, but concepts, protocols, evaluations,
  packages, or source components transfer only through an explicit adopt/adapt/
  reject decision. Neither project is a mandatory runtime, release, or schedule
  dependency of the other.
- Removed Sybil from Forge's V1 gate table and revised the Sybil start condition to
  require its own repository/product boundary and lesson-transfer record rather
  than completion of every Forge milestone.
- See the [Forge platform direction](../architecture/forgeengine-platform-direction-amendment.md),
  [Project Sybil working specification](../architecture/project-sybil-working-spec.md),
  and [Grok Bot pattern review](../audit/2026-08-13-grok-bot-sybil-pattern-review.md).

# 2026-08-13 - Grok Bot patterns enter the Project Sybil research roadmap

- Reviewed the official Grok Bot launch and product FAQ as a competitive product
  signal, not as implementation authority. The described patterns include an
  always-on worker computer, cross-surface threads, teach-by-demonstration routines,
  scheduled work, accumulating context, approval-aware application use, and
  coordinated specialist bots.
- Accepted adapted Sybil candidates for canonical task threads, portable execution
  cells, reviewed routine candidates, durable trigger/recovery machinery,
  evidence-producing UI fallback, and typed multi-worker work graphs.
- Rejected one shared mutable computer and ambient credential pool as Sybil's
  default. Workers instead receive scoped cell leases and exchange attributable
  artifacts and delegated capabilities.
- Preserved Forge scope: the installable CLI and CLI8 single-worker
  memory/retrieval/reviewed-skill work remain an independent pilot and source of
  lessons. Sybil implementation does not begin from this documentation update and
  belongs to its own project roadmap.
- See the [Grok Bot pattern review](../audit/2026-08-13-grok-bot-sybil-pattern-review.md),
  [Project Sybil working specification](../architecture/project-sybil-working-spec.md),
  and [ForgeEngine V1 build plan](../architecture/forgeengine-v1-validated-build-plan.md).

# 2026-08-12 - Consolidated transaction and sandbox hardening passes the local publication gate

- Revalidated the seven local recovery/continuation commits together with the
  transaction-retention, Windows sandbox evaluation, native-package, and
  disposable-lab preparation changes as one Rust-authoritative core-hardening line.
- The complete product gate, clean-install native package smoke, npm and RustSec
  audits, optimized bridge budget, script parsers, and fresh five-control
  AppContainer/managed Windows corpora pass locally.
- Both Windows candidates remain `setup_required` and restricted-ready false.
  Clean-VM lifecycle, hosted cross-platform, macOS containment, exact-head VS Code,
  signing, and provider-promotion gates remain open.
- See [Checkpoint 85](checkpoints/2026-08-12-85-consolidated-transaction-sandbox-local-gate.md),
  [Checkpoint 84](checkpoints/2026-08-12-84-packaged-provider-lifecycle-gate-preparation.md),
  and [ADR-0033](ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md).

# 2026-08-12 - Packaged provider lifecycle gate is prepared, not accepted

- Added an evaluation-only payload builder for exact cached published archives,
  package/version/license identities, license texts, third-party notices, adapter
  hash, and explicit no-verbatim-external-source provenance. The dependency remains
  absent from Forge's application manifest/lock.
- Advanced the disposable lab to bundle/evidence schema 2. Bundles bind the provider
  payload separately and reject missing, changed, duplicate, reparse-point, or
  unmanifested payload files.
- Added write-once guest lifecycle phases for verify, elevated install, post-install
  hard reboot, the Rust-owned same corpus against both evaluation providers,
  uninstall, post-uninstall hard reboot/residue, and fail-closed finalization.
- Added chained host lifecycle evidence and a read-only finalizer that requires both
  resets, exact guest artifact hashes, one unsandboxed canary control, a real upgrade,
  export, shutdown, and clone destruction.
- Local non-elevated payload, bundle, offline-install, exact-package, rejection, and
  fail-closed tests pass. No VM/hypervisor, UAC, account, WFP, network, or host setup
  mutation was performed. A second approved exact pin and real VM run remain blockers,
  so both candidates remain `setup_required` and the recommendation stays `adapt`.
- See [Checkpoint 84](checkpoints/2026-08-12-84-packaged-provider-lifecycle-gate-preparation.md),
  [ADR-0033](ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
  and the [evaluation lab](../testing/forge-evaluation-lab.md).

# 2026-08-12 - Rust-owned managed Windows adapter passes the local same-plan gate

- Classified the managed Windows, AppContainer, and shared conformance paths as
  evaluation modules. Forge independently reproduces useful architecture,
  composition patterns, and obvious structural ideas against public APIs/platform
  contracts; it does not copy implementation source verbatim or mirror private
  internals. Any later substantial source reuse requires a separate adoption and
  legal/provenance decision.
- Added a conformance-only Rust managed-provider adapter that validates the complete
  schema-v4 plan, launches the provider-prepared executable inside Forge's
  process-count/memory-limited Job, and retains Rust timeout, cancellation,
  descendant, cleanup, evidence, and fail-closed selection authority.
- A fresh five-control corpus passed 17/17 against managed Windows and 17/17 against
  AppContainer, including separate owner death, shell/Node/npm/Git/Cargo/rustc,
  and clean ACL/process/recovery/descendant residue.
- Measured cold mean/P95 at 8,940.12/19,711.26 ms for managed Windows and
  1,972.14/4,277.12 ms for AppContainer. Both reports record zero harness retries
  and null tokens because no inference provider participated.
- Probe v4 reports candidates separately from the trusted selected baseline. Both
  candidates remain `setup_required` and `restrictedReady=false`; doctor executes
  no environment-selected adapter code and production selection remains closed.
- Kept `@anthropic-ai/sandbox-runtime@0.0.71` outside the application dependency
  graph. Recommendation remains `adapt`; the next gate is a separately packaged
  payload's install/reboot/same-corpus/upgrade/uninstall lifecycle in the disposable
  Windows lab.
- See [Checkpoint 83](checkpoints/2026-08-12-83-managed-windows-provider-adapter-local-gate.md),
  [ADR-0033](ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
  and [ADR-0034](ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md).

# 2026-08-12 - Commodity sandbox spike reaches its bounded recommendation gate

- Added Rust schema-v4 read/deny/write boundary binding and a 17-case exact-plan
  corpus. The final SRT run passed 17/17 with clean ACL, recovery, helper/broker
  process, descendant, and pre/post account/WFP behavior evidence.
- Measured mean setup/reset/launch at 1,196.59/1,116.80/325.05 ms; the compatibility
  projection was 632,868,524 bytes. Native AppContainer 9/9, Job lifecycle 3/3,
  isolation authority 11/11, full Rust 174/0, Node 96/0, and exact hybrid 63/0 gates
  passed.
- Recommendation remains `adapt`: preserve Rust authority and compose managed
  identity/WFP/broker machinery with Forge Job/resource limits later. SRT cannot
  express full resource limits through its published API, so production readiness
  and provider promotion remain closed.
- Removed `@anthropic-ai/sandbox-runtime@0.0.71` from the Forge application
  manifest/lock. The new fail-closed VirtualBox lab scaffold installs it offline
  with `--no-save`; no VM, hypervisor, firmware, image, network, or firewall change
  was made.
- See [Checkpoint 82](checkpoints/2026-08-12-82-commodity-sandbox-conformance-completion.md),
  [ADR-0033](ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
  and the [evaluation lab](../testing/forge-evaluation-lab.md).

# 2026-08-11 - Commodity sandbox conformance spike remains setup-blocked

- Added a temporary provider-neutral exact-plan harness at
  `scripts/sandbox-conformance.mjs` with adversarial and representative toolchain
  case IDs, setup/launch/bytes/residue metrics, and fail-closed adapter behavior.
- Probed the pinned `@anthropic-ai/sandbox-runtime@0.0.71` only through published
  APIs. The vendored Windows helper was present, but status/dependency/WFP probes
  failed with `EPERM` at process creation; no UAC, account, WFP, ACL, or profile
  mutation was attempted.
- Audited Apache-2.0 licensing, four direct runtime dependencies plus nested zod,
  145 lockfile package records, and zero known vulnerabilities in the repository
  audit. The package remains an unmerged temporary spike input, not a promoted
  Forge provider.
- Recommendation is `adapt`: preserve Rust policy/transaction/evidence authority,
  evaluate a dedicated-identity/WFP/broker implementation behind the same contract
  in a later approved slice, and keep restricted readiness fail-closed.
- See [ADR-0033](ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
  [ADR-0034](ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md),
  and [Checkpoint 81](checkpoints/2026-08-11-81-commodity-sandbox-conformance-spike.md).

# 2026-08-11 - Product critical path moves from custom sandboxing to the learning loop

- Accepted [ADR-0034](ADRs/ADR-0034-commodity-sandbox-and-differentiated-learning-lane.md):
  sandboxing remains a required, separately accepted platform boundary, but is not
  Forge's product innovation lane.
- Froze the custom AppContainer implementation—not the sandbox program—at
  conformance quality and retained it as an optional strict backend. The actively
  scheduled Windows follow-up evaluates the established dedicated low-privilege
  identity, broker/runner, restricted-token/Job, recoverable ACL, WFP, and proxy
  pattern behind the existing Rust provider contract.
- Kept all restricted readiness claims fail-closed. The trusted developer alpha does
  not wait for native providers and must continue to state that it provides no
  Forge-enforced OS containment.
- Moved the post-alpha critical path to one evaluated, attributable loop: evidence to
  scoped candidate memory, measured retrieval, repeated-pattern recognition,
  developer-reviewed skill promotion, and measurable reuse through the canonical
  runtime.
- Retained Windows/macOS sandbox completion as a bounded parity lane. It does not
  block a truthfully labeled trusted alpha, but it remains mandatory for restricted
  beta and enterprise-readiness claims.
- Added sovereign/small-model efficiency guardrails: sandbox governed capability
  processes rather than inference by default, keep policy mechanics out of model
  context, avoid per-invocation workspace/toolchain copies, preflight failures in
  `doctor`, and compare provider overhead/retries/outcomes with trusted execution.
- Automatic unreviewed skills, uncorrectable memory, and opaque learning remain
  outside the first slice. The bounded implementation and evaluation gate are in
  [Slice CLI8](../tasks/SLICE-CLI8-differentiated-learning-loop.md).

# 2026-08-11 - Windows AppContainer preview reaches focused conformance

- Implemented a conformance-only disposable AppContainer launcher behind the existing
  Rust `IsolationProvider`/`EffectiveSandboxPlan` contract. Production status remains
  `setup_required`, so restricted transactions still fail before launch.
- Added unique profile/SID lifecycle, bounded pre-mutation recovery journals,
  positive-only candidate ACL grants, explicit handles/environment, suspended Job
  assignment, resource bounds, cancellation, and cleanup recovery.
- Rejected the first recursive-root/deny-ACE design after a live test showed the
  restricted package SID did not protect `.git` as intended. The corrected preview
  grants the root without inheritance and only existing safe top-level entries; it
  does not move metadata, restore whole DACLs, or alter active-repository/tool ACLs.
- Focused Windows conformance passes 9/9, including outside/protected denial,
  loopback denial, timeout/cancellation, requested cwd, and abandoned-boundary
  recovery. General toolchain projection, Windows credential breadth, forced owner
  death, resource-ceiling fixtures, packaging/doctor, hosted, and VS Code gates remain
  open.
- Fixed source-kernel discovery to choose the newest debug/release build instead of a
  stale release binary, and updated the hybrid doctor assertion for probe v3. The
  exact local head passes strict Rust validation, 96/96 Node tests/build, 56/56
  executed hybrid tests (seven explicit skips), RustSec audit of 46 locked
  dependencies, and the staged Windows x64 package smoke.
- The repository correctness pass then removed self-hash trust from sandbox-plan
  validation: exact process/path/control/limit semantics are re-derived, including
  regressions for a re-hashed escaped root, raised limit, and swapped executable. Job
  creation now precedes process creation, assignment failure drains explicitly, and
  recovery records reject duplicate/non-compiled paths. The full gate and rebuilt
  package smoke remain green after these fixes.
- Explicit architectural debt and improvement paths are recorded in
  [ADR-0033](ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md),
  [Checkpoint 80](checkpoints/2026-08-11-80-windows-appcontainer-preview-conformance.md),
  and the [CLI ship-lane 7 task](../tasks/SLICE-CLI7-transaction-retention-and-native-isolation.md).

# 2026-08-10 - Transaction retention and isolation readiness reach the local gate

- Accepted [ADR-0033](ADRs/ADR-0033-sandbox-policy-compilation-and-provider-conformance.md)
  after a primary-source audit of Codex, Claude Code, Gemini CLI, and Copilot's hosted
  boundary. Forge will adopt the recurring architecture patterns, not their source:
  one compiled effective plan, explicit backend strength/availability, separate
  network and credential controls, fail-closed exact representation, and native
  adversarial conformance.
- Replaced the single-primitive sandbox assumption with a provider hierarchy:
  managed plus honest fallback on Windows, a Seatbelt preview plus durable signed
  helper decision on macOS, and bubblewrap on Linux. AppContainer remains an optional
  strict Windows experiment. No backend is accepted by compilation or configuration.
- Recorded an independent-implementation rule: public designs may inform Forge, but
  literal code adoption requires an explicit provenance and license/NOTICE review.
- Moved exact unpublished transaction staging cleanup under the repository
  publication lock, added strict staging grammar/state-scan bounds, and retained
  every published prepared transaction until exact accept/discard.
- Added a bounded Rust-owned transaction audit, ChangeSet protocol v4, and human/JSON
  `forge change audit` projections. Prepared work becomes review-due after 24 hours
  but is never silently deleted.
- Advanced kernel probe to v2 so isolation readiness comes from the selected Rust
  provider. The baseline reports trusted-only/no controls/restricted-ready false;
  no OS sandbox is claimed.
- The full local gate passes: zero-warning Rust validation, 94/94 Node tests/build,
  63/63 exact-kernel hybrid tests, official MCP-client conformance, and source-built
  CLI smoke. Doctor now rejects a state root nested in the governed workspace.
- The repository audit confirms the npm tarball contains zero native kernel entries
  and the root license remains unresolved. Hosted Windows/macOS/Ubuntu, controlled
  VS Code, clean-install packaging, and native AppContainer/App Sandbox providers
  remain open.
- Closed the Windows x64 clean-install defect locally with exact-version
  platform-native npm packages, target/version validation, no install-time downloader
  or Rust build, and an empty-directory packaged `doctor` plus real kernel inspection
  smoke. Hosted targets, signing/provenance, publication, and the root license remain
  open; see [ADR-0032](ADRs/ADR-0032-platform-native-npm-packages.md).
- See [Checkpoint 79](checkpoints/2026-08-10-79-transaction-retention-and-isolation-readiness-local-gate.md),
  [ADR-0031](ADRs/ADR-0031-transaction-retention-and-native-sandbox-sequencing.md),
  [core audit](../audit/2026-08-10-core-correctness-and-quality-audit.md), and
  [CLI ship lane 7](../tasks/SLICE-CLI7-transaction-retention-and-native-isolation.md).

# 2026-08-06 - Outer runs cross-link durable ChangeSet recovery

- Advanced the private bridge to v10 with a typed, durably acknowledged
  `change_set_transaction` checkpoint bound to the active outer capability.
- The interactive governed-change workflow cannot cross from registered
  transaction creation to its second human decision until the outer Rust ledger
  synchronizes and acknowledges the recovery reference.
- Inspection exposes the exact registered ChangeSet transaction after a crash;
  resume still blocks the non-idempotent outer capability and invokes it zero
  times. ChangeSet journals remain the mutation authority.
- The exact local gate passes: full zero-warning Rust validation, 93/93 Node tests
  and build, 56/62 hybrid scenarios with six explicit separate-kernel skips,
  packaged CLI smoke, and a controlled one-call/five-second VS Code gate.
- Hosted Windows/macOS/Ubuntu, bounded orphan reporting, and cleanup policy for
  registered-but-never-finalized transactions remain open.
- See [Checkpoint 78](checkpoints/2026-08-06-78-changeset-recovery-checkpoint-local-gate.md),
  [ADR-0030](ADRs/ADR-0030-durable-interaction-transcript-and-safe-continuation.md),
  [hybrid boundary](../architecture/hybrid-rust-kernel-typescript-adapters.md), and
  [CLI ship lane 6](../tasks/SLICE-CLI6-run-recovery.md).
# 2026-08-05 - Initial run records publish atomically

- Moved OS execution locks into a non-authoritative `.locks` namespace so lock
  acquisition cannot manufacture a partial run record.
- Rust now synchronizes all four initial ledger files in private staging, closes
  append handles for Windows compatibility, and publishes the complete directory
  with one rename before reopening it for execution.
- A fault-injection regression proves the final run is invisible before publication;
  a second regression proves abandoned private staging is non-authoritative and does
  not block a clean retry. Concurrent duplicate creation remains single-winner.
- The full local hybrid gate passes: zero-warning Rust validation, 92/92 Node tests
  and build, and 59 hybrid scenarios. A restarted controlled VS Code session also passes in one Forge call and 5 seconds. Hosted Windows/macOS/Ubuntu remains pending.
- See [Checkpoint 77](checkpoints/2026-08-05-77-atomic-run-initialization-local-gate.md),
  [ADR-0030](ADRs/ADR-0030-durable-interaction-transcript-and-safe-continuation.md),
  and [CLI ship lane 6](../tasks/SLICE-CLI6-run-recovery.md).
# 2026-08-05 - Safe continuation exact-head local gate

- Implemented bridge v9 durable interaction intents/completions, bounded planner
  checkpoints, explicit capability replay safety, OS-owned per-run locks, and
  deterministic continuation through the existing `Slice0Runtime`.
- Completed responses replay without host work; one unresolved explicitly
  retryable evidence call may be deliberately retried once total. Ambiguous
  planner/approval work and unresolved non-idempotent capabilities block.
- `forge runs inspect` and `forge runs resume` expose the same Rust store contract;
  terminal resume returns the existing artifact without provider work.
- Exact local validation passes: zero-warning full Rust gate, 92/92 Node tests and
  build, 59 retained-kernel hybrid scenarios, and packaged CLI smoke.
- Controlled VS Code initially exposed a stale pre-v9 MCP process, then passed a
  fresh one-call/four-second gate after explicit server restart with all seven tools.
- Hosted Windows/macOS/Ubuntu, outer ChangeSet cross-linkage, and the earliest
  run-record initialization crash window remain open.
- See [Checkpoint 76](checkpoints/2026-08-05-76-safe-run-continuation-local-gate.md),
  [ADR-0030](ADRs/ADR-0030-durable-interaction-transcript-and-safe-continuation.md),
  and [CLI ship lane 6](../tasks/SLICE-CLI6-run-recovery.md).
# 2026-08-05 - Safe continuation uses deterministic replay through one runtime

- Accepted [ADR-0030](ADRs/ADR-0030-durable-interaction-transcript-and-safe-continuation.md)
  for CLI ship-lane 6B.
- Rust will persist planner, approval, and capability intents before host dispatch
  and validated completions before runtime use. Provider turns carry a bounded
  restorable message/tool-call checkpoint.
- Resume re-enters the existing `Slice0Runtime`, consumes recorded completions,
  verifies its reproduced events against the durable prefix, and appends only at
  the new frontier. No recovery runtime or child logical run is introduced.
- Unresolved provider or approval work and non-idempotent capabilities remain
  blocked. Evidence capabilities require explicit `read_only_retryable` metadata;
  missing metadata fails closed.
- Delivery is split into 6B-1 transcript/classification and 6B-2 deterministic
  replay/live continuation so the first increment cannot accidentally market
  classification as working resume.
- See [CLI ship lane 6](../tasks/SLICE-CLI6-run-recovery.md).
# 2026-08-05 - Run-recovery validation sufficiency audit

- Audited every CLI ship-lane 6A acceptance claim against executable evidence and
  added direct regressions for the request-only crash window, unpublished
  temporary artifact, concurrent duplicate creation, request tampering, literal
  event reordering, and end-to-end duplicate `run.start` rejection.
- Hardened bounded ledger reads against concurrent file growth and writes each
  JSONL event frame through one buffer before synchronization.
- Replaced a flaky fixed-delay Windows process-ownership fixture with explicit
  readiness-based cancellation; it passed three repeated stress runs and the full
  workspace gate.
- Current local validation passes 91/91 Node tests, Rust format and zero-warning
  Clippy, the full Rust workspace, 14/14 focused run-store cases, 2/2 live bridge
  cases, and 56/56 exact-kernel hybrid product tests with zero skips.
- This is sufficient for local 6A acceptance, not hosted cross-platform
  acceptance. Hosted Windows/macOS/Ubuntu remains pending, and 6B continuation is
  still deliberately unimplemented.
- See [Checkpoint 75](checkpoints/2026-08-05-75-run-recovery-validation-audit.md)
  and [CLI ship lane 6](../tasks/SLICE-CLI6-run-recovery.md).
# 2026-08-05 - Durable outer-run ledger passes the controlled VS Code gate

- Validated exact implementation `88501dc` in a newly trusted VS Code worktree.
  The workspace MCP server reached `Running`, discovered exactly seven tools, and
  exactly those seven were selected.
- One fresh Agent chat made one `Forge Workspace Summary` call in three seconds,
  used no built-in or mutation tool, and returned the complete seven-event
  projection for run `run:586c51b7-aaa8-4a13-a130-39df602110df`.
- A separate CLI process then inspected the default durable store and returned the
  same run as `terminal` / `return_terminal_artifact`, with seven events and
  terminal status `completed`, without re-executing planner, provider, approval,
  or capability work.
- Hosted Windows/macOS Node and Windows/macOS/Ubuntu hybrid gates remain pending
  because the feature branch is not yet published. Increment 6B remains blocked
  behind that acceptance gate.
- See [Checkpoint 74](checkpoints/2026-08-05-74-durable-run-ledger-vscode-gate.md)
  and [CLI ship lane 6](../tasks/SLICE-CLI6-run-recovery.md).
# 2026-08-05 - Durable outer-run ledger reaches the local gate

- Implemented [ADR-0029](ADRs/ADR-0029-append-before-notify-run-ledger.md):
  bridge v7 requires one Rust run-store root, persists the request before
  execution, synchronizes every canonical event before host notification, and
  validates/publishes the terminal artifact before host completion.
- Added Rust-owned terminal/open/repair inspection, the read-only
  forge runs inspect <run-id> CLI surface, and effective run-store reporting in
  forge doctor. Terminal artifacts return without re-execution; incomplete or
  corrupt runs are never automatically replayed.
- Local validation passes 91/91 Node tests and build, zero-warning clippy and the
  full Rust workspace, 56/56 retained-kernel hybrid tests, nine adversarial store
  regressions, and live append-before-notify/seal-before-result ordering.
- A full hybrid run exposed and corrected a partial token-usage projection
  mismatch before checkpoint. Hosted Windows/macOS/Ubuntu, controlled VS Code, and
  6B's exact continuation transcript remain pending.
- See [Checkpoint 73](checkpoints/2026-08-05-73-durable-run-ledger-local-gate.md)
  and [CLI ship lane 6](../tasks/SLICE-CLI6-run-recovery.md).
# 2026-08-05 - Product approval profiles accepted cross-platform

- Accepted increment 5C at exact implementation `2941948` after all five hosted
  jobs passed: Node on Windows/macOS and the real Rust-kernel/TypeScript product on
  Windows/macOS/Ubuntu.
- GitHub Actions run `31031189599` covers Node; run `31031189868` covers the hybrid
  matrix. The complete envelope also includes local 91/91 Node and 54/54 retained-
  kernel hybrid tests, zero audit findings, live Qwen 1.5B grant/decline behavior,
  and the final one-call controlled VS Code regression.
- This closes CLI ship-lane increment 5. It does not close outer-run recovery,
  packaging/license, the alpha test kit, OS containment, organization policy
  distribution, or MCP host-interactive approval.
- See [Checkpoint 72](checkpoints/2026-08-05-72-policy-profile-hosted-acceptance.md).
# 2026-08-05 - Product approval profiles reach the local/live/VS Code gate

- Implemented [ADR-0028](ADRs/ADR-0028-product-approval-profiles.md): one
  TypeScript profile adapter now supplies attributable facts for developer,
  review, and locked postures while Rust remains the only final approval authority.
- Removed fixed product policy mappings from the workspace service. CLI, embedded
  service, and MCP share the same profile module; the only TypeScript final-decision
  mapper is explicitly test-only conformance code.
- Added exact-context embedded review callbacks, provenance bounds, cancellation of
  non-cooperative callbacks, visible CLI review prompts, effective `doctor` and
  `/permissions` output, fail-closed MCP review without a host callback, and nonzero
  evidence-command exits for denied/unmet runs.
- Local typecheck, 91/91 tests, production build, and the complete 54/54 retained-
  kernel hybrid suite pass. Live Qwen 1.5B grant and decline gates
  behave safely. Qwen 0.5B exposed a malformed streamed continuation and is not
  claimed as a general tool-use floor.
- A trusted fresh VS Code chat with exactly seven Forge tools made one summary call
  in four seconds, used no built-ins or mutation, and returned the complete
  seven-event projection for `run:3a5bc81a-7f2a-49cc-b63f-9c2a7a13e0a5`.
- Hosted exact-head Windows/macOS Node and Windows/macOS/Ubuntu hybrid checks remain
  the final 5C acceptance gate. Minimum outer-run recovery is next; packaging,
  license, the alpha test kit, and OS containment remain open.
- See [Checkpoint 71](checkpoints/2026-08-05-71-policy-profile-and-host-callback-local-gate.md).

# 2026-08-05 - Rust-owned execution budgets accepted

- Closed the two remaining 5B gates without broadening the implementation. A
  conservative credentialed `openai/gpt-5.6` request completed under one turn,
  zero capability calls, and explicit reported-token ceilings with exact expected
  output. The run recorded 768 input and 12 output tokens.
- In a trusted fresh VS Code Agent chat with exactly seven Forge tools selected,
  Copilot made one `Forge Workspace Summary` call and no built-in call. It
  preserved the run/snapshot IDs, `outcome.status=verified`,
  `runStatus=completed`, and all seven ordered events.
- Accepted 5B at implementation `3f2774b`. Product policy posture and embedded
  host callback conformance remain 5C; outer-run recovery, native packaging,
  licensing, and OS containment are still open.
- See [Checkpoint 70](checkpoints/2026-08-05-70-execution-budget-openai-and-vscode-acceptance.md).

# 2026-08-05 - Rust-owned execution budgets reach the local gate

- Implemented [ADR-0027](ADRs/ADR-0027-rust-owned-execution-budgets.md):
  RunArtifact v4 and `forge.kernel.bridge.v6` now carry a versioned execution
  budget and exact admitted usage. Rust checks capability admission before policy
  or invocation, stops continuation after cumulative reported token usage crosses
  a ceiling, fails closed when reported usage is unavailable, and validates the
  direct-caller turn bound. Context exhaustion remains a separate state.
- The product defaults require no added startup ceremony and can be overridden
  with explicit capability/input/output ceiling flags. Documentation states that
  reported-token ceilings are post-response continuation controls, not provider
  transport or billing caps.
- Local typecheck, 86/86 tests, production build, Rust formatting, and dependency
  audit pass. A fresh advisory refresh exposed five MCP-tree findings; the locked
  MCP SDK/transitive graph was updated and the clean-install audit returned zero.
  The workstation lacks the MSVC linker, so native Rust correctness is
  explicitly pending hosted Windows/macOS/Ubuntu acceptance rather than inferred
  from TypeScript. See [Checkpoint 68](checkpoints/2026-08-05-68-execution-budget-local-gate.md).
- Exact implementation `3f2774b` passes hosted Node Windows/macOS and full hybrid
  Windows/macOS/Ubuntu. The retained Windows kernel passes product doctor/smoke,
  live Qwen 7B one-read evidence, and a Qwen 0.5B tiny-budget termination. The
  OpenAI credential is not inherited by this process and VS Code opened the new
  worktree in Restricted Mode, so both gates remain explicitly pending. See
  [Checkpoint 69](checkpoints/2026-08-05-69-execution-budget-hosted-and-live-qwen-gate.md).
- Added the source-backed [CLI harness comparison](../audit/2026-08-05-cli-harness-core-comparison.md).
  Forge is calibrated as a credible narrow evidence/transaction core, not a mature
  product peer. The alpha critical path is 5B acceptance, 5C policy UX, minimum
  outer-run recovery, native packaging/license, and a developer test kit.
# 2026-08-04 - Approval cancellation hardening accepted

- Merged accepted Rust-owned governed lifecycle convergence through PR #20; remote
  `develop` now points at `2ff5669`.
- Accepted [ADR-0026](ADRs/ADR-0026-cancellation-safe-approval-callbacks.md): the
  current run AbortSignal now governs both human edit decisions, and the executor
  races cancellation even when a host question adapter ignores that signal.
- Cancellation before candidate execution requests no mutation. Cancellation at
  promotion prints and retains the verified transaction ID and performs no
  accept/discard call.
- Accepted exact implementation `ae746ff`. Local validation passes typecheck,
  81/81 tests, production build, focused 14/14 approval/interactive tests, Rust
  formatting, and diff hygiene.
- Node passed on Windows/macOS in Actions run `30957571675`; the real
  Rust-kernel/TypeScript product passed on Windows/macOS/Ubuntu in run
  `30957571639`.
- Live Qwen 7B timeouts at the candidate and promotion prompts returned cancelled
  without source mutation. The second retained transaction
  `transaction:sha256:3e9555ae7f78a3d8d63c3bc848fd83947c63fb8b6fb9731347e8b8ff08d40cdc`.
- A trusted fresh VS Code chat selected exactly seven Forge tools, made one summary
  call in three seconds, used no built-ins/retries/mutations, and returned complete
  provenance for run `run:24afdcc4-c994-478d-9082-6bde3fd54f32`. See
  [Checkpoint 67](checkpoints/2026-08-04-67-approval-cancellation-local-gate.md).
- This is increment 5A. Independent Rust-owned call/usage budgets remain 5B; policy
  posture and embedded-host callback conformance remain 5C.
# 2026-08-04 - Governed edit enters the Rust lifecycle

- Accepted the 4B-3a contract at exact implementation `4ac3346`: Node passed on
  Windows/macOS in Actions run `30938191923`, and the real
  Rust-kernel/TypeScript product passed Windows/macOS/Ubuntu in run
  `30938194060`.
- Removed the interactive product's post-`run.completed` mutation handoff. A
  policy-enabled CLI now exposes one CLI-only `workspace.change.execute`
  capability that reuses complete-read proof, bounded plan evidence, ChangeSet v2,
  visible candidate approval, verification, and accept/discard/retain before the
  canonical Rust run terminates.
- Added bounded `forge.workspace.change.execution.v1` evidence without duplicating
  replacement bodies, plus a matched 4 MiB Rust/TypeScript ceiling for prior
  capability context.
- MCP and VS Code remain exactly seven read-only tools. No raw write, shell, public
  mutation, or TypeScript aggregate runtime was added.
- Accepted 4B-3b at exact implementation `1cc1e3f`: Node Windows/macOS passed in
  Actions run `30955324195`, and the real Rust-kernel/TypeScript product passed
  Windows/macOS/Ubuntu in run `30955324364`.
- A disposable exact-commit Qwen 7B run completed one governed promotion in 30.5
  seconds and changed source only after Rust reported `promoted`. Qwen corrected
  one malformed read before succeeding, so functional transaction acceptance does
  not claim perfect low-model tool-call efficiency.
- A trusted fresh VS Code chat selected exactly seven read-only Forge tools and
  completed one bounded summary call in roughly five seconds with full provenance,
  outcome, lifecycle, and ordered event metadata; no built-in or mutation tool was
  used. See [Checkpoint 66](checkpoints/2026-08-04-66-governed-edit-lifecycle-local-gate.md).

# 2026-08-04 - Rust-owned lifecycle convergence begins

- Merged accepted interactive edit composition through PR #19; remote `develop`
  now points at `1f0d792`.
- Accepted [ADR-0025](ADRs/ADR-0025-rust-owned-capability-context-and-lifecycle.md):
  RunArtifact v3 and bridge v5 will carry a Rust-authored, digest-bound prior
  capability context through approval and invocation plus bounded structured
  capability evidence.
- Increment 4B-3 will move the existing governed ChangeSet v2 edit flow inside the
  active Rust run. It must not add a TypeScript wrapper runtime or an MCP mutation
  tool.
- Crash-resumable inference replay remains explicitly deferred to the Recovery
  state ship lane; this increment closes the active-run evidence seam only.
- [Checkpoint 65](checkpoints/2026-08-04-65-rust-owned-capability-context-local-gate.md)
  records the green 78-test/build and Rust-format local gate, the unavailable
  Windows linker, and the still-required exact-head hosted Rust gate.

# Architecture Changelog

## 2026-08-04 - Interactive edit composition accepted

- Accepted CLI ship lane increment 4B-2 at implementation `bbf119e`. Local
  typecheck, all 76 tests, and production build pass; Node passed on Windows/macOS
  in Actions run `30933939503`; the real Rust-kernel/TypeScript product passed on
  Windows/macOS/Ubuntu in Actions run `30933939342`.
- A disposable Qwen 7B flow completed one read, one plan, exact diff review,
  explicit candidate approval, successful verification, and explicit promotion.
  The workspace changed only after Rust reported `promoted`, and governed provider
  prose remained hidden before the decision UI.
- A fresh trusted VS Code Agent chat exposed exactly seven read-only Forge tools and
  completed one workspace-summary call in four seconds with no built-ins, retries,
  or mutation surface. See [Checkpoint 64](checkpoints/2026-08-04-64-interactive-edit-accepted.md).
- Increment 4B-3 remains open: planning currently completes before the Rust
  transaction begins, so one Rust-owned continuable lifecycle is not yet proven.
## 2026-08-04 - Interactive edit presentation truthfulness

- Stopped streaming provider prose directly during a policy-enabled change-planning
  turn. A no-plan turn still prints the completed buffered answer, while a valid
  plan is presented only through Forge's diff, approval, verification, and Rust
  transaction-state UI.
- This is a presentation-boundary correction, not a new source of authority. A live
  Qwen 7B acceptance flow had correctly waited for approval and Rust promotion but
  its prose prematurely said that the replacement had occurred.
- Typecheck, all 76 tests, and the production build pass locally. Exact-head hosted
  and controlled VS Code acceptance remain pending.

## 2026-08-04 - Interactive edit composition local gate

- Implemented CLI-only, policy-enabled change planning over the accepted Rust
  ChangeSet v2 transaction authority. Ordinary CLI, one-shot inference, and MCP
  remain seven-tool read-only surfaces.
- Moved opaque digest and diff-budget bookkeeping out of the model schema. Forge now
  requires complete prior read coverage at the same digest, cross-checks retained
  content/diff against Rust preparation, and keeps both execution and promotion
  behind visible developer decisions.
- Added strict trusted-only policy parsing, bounded capability failure reasons, and
  fail-closed detection for registered tool calls printed as terminal JSON.
- Low-compute Qwen tests found an honest model floor: 0.5B/1.5B did not sequence the
  read, 3B leaked/malformed calls, and 7B produced one complete read plus one valid
  plan for a clear replacement.
- That 7B test exposed snake_case operation fields in the prepared Rust artifact.
  The v3 bridge now projects them to the camelCase host contract without changing
  durable/core ChangeSet serialization. No candidate or source mutation occurred.
- Recorded [ADR-0024](ADRs/ADR-0024-model-plan-and-rust-change-composition.md) and
  [Checkpoint 63](checkpoints/2026-08-04-63-interactive-edit-local-gate.md). Hosted
  native/product, exact-kernel full edit, VS Code, and aggregate RunArtifact gates
  remain open.

## 2026-08-04 - Prepared ChangeSet approval binding accepted

- Accepted CLI ship lane increment 4B-1 at exact implementation `3262e3b` after
  Node passed on Windows/macOS (Actions run `30925912676`) and the real
  Rust-kernel/TypeScript product passed on Windows/macOS/Ubuntu (Actions run
  `30925913647`).
- Downloaded exact Windows artifact `8899186885`; doctor, 41/41 hybrid tests, and
  product smoke pass locally with sovereign change protocol v3.
- The initial full local hybrid attempt exposed only an artifact-location assumption:
  auto-discovery intentionally ignores the environment override. Placing the exact
  unchanged binary in ignored `target/release` closed it without a source fix.
- Recorded [Checkpoint 62](checkpoints/2026-08-04-62-prepared-changeset-accepted.md).
  Increment 4B-2 interactive provider edit/diff/approval/accept-discard composition
  is next; MCP remains read-only.
## 2026-08-04 - Prepared ChangeSet approval binding opened

- Opened CLI ship lane increment 4B from merged `develop` at `742b8c8` on
  `feature/cli-edit-verification-composition`.
- The pre-implementation audit found that the expert change command approved only a
  proposal schema version and verifier list; the actual ChangeSet was constructed
  afterward and approval attribution was not retained in its artifact.
- Added the bounded design in
  [ADR-0023](ADRs/ADR-0023-prepared-changeset-approval-binding.md): Rust prepares an
  exact non-mutating ChangeSet, approved execution recomputes it, stale identity
  fails before candidate creation, and the artifact retains the exact approved call,
  facts, Rust decision, contract, and outcome.
- Local typecheck, 63/63 ordinary tests, build, Rust formatting, all-target compile,
  and strict clippy pass. Hosted native/hybrid and interactive composition gates
  remain open; no MCP mutation tool was added. See
  [Checkpoint 61](checkpoints/2026-08-04-61-prepared-changeset-local-gate.md).
## 2026-08-04 - Rust-authoritative outcome contract accepted

- Accepted CLI ship lane increment 4A at `be2069a` after Node 22 passed on Windows
  and macOS (Actions run `30922333249`) and the exact Rust-kernel/TypeScript product
  passed on Windows, macOS, and Ubuntu (Actions run `30922337824`).
- The exact hosted Windows release kernel passed local product smoke and all 39
  hybrid tests with zero skips.
- A controlled trusted-workspace VS Code test exposed one adapter ambiguity: raw
  Forge evidence said `verified`, while Copilot reported the top-level mechanical
  `status=completed` as the outcome. The MCP projection now calls that field
  `runStatus`, puts `outcome.status` first, and leaves the internal RunArtifact
  unchanged.
- A fresh retest with exactly seven Forge tools made one summary call, used no
  built-in search or retries, and reported outcome `verified` plus the canonical
  seven-event order.
- Recorded the completed gate in
  [Checkpoint 60](checkpoints/2026-08-04-60-outcome-contract-accepted.md). Increment
  4B bounded edit and verification composition is now the next implementation lane.

## 2026-08-04 - Rust-authoritative outcome contract local gate

- Opened CLI ship lane 4 from merged `develop` at `0441d865` on
  `feature/cli-outcome-verification`.
- Separated mechanical run lifecycle from outcome assessment. RunArtifact v2 now
  always reports `not_evaluated`, `verified`, or `unmet`; `completed` alone no
  longer implies that a developer objective was achieved.
- Added bounded caller-supplied outcome contracts and made Rust their only validator
  and evaluator. The initial checks cover non-empty output, exact expected output,
  and successful correlated capability invocations.
- Bumped the child-process run bridge to `forge.kernel.bridge.v4`, retained the full
  contract in the authoritative artifact, and exposed only the compact assessment
  through MCP presentation.
- The implementation audit caught a missing bridge request projection and a generic
  call-ID correlation hole. Both now fail closed and have Rust/TypeScript parity
  regressions.
- Local validation passes typecheck, 63/63 tests, build, Rust formatting, GNU
  all-target compile, and strict clippy. Native Rust test execution remains hosted
  because this Windows machine lacks both MSVC `link.exe` and GNU `dlltool.exe`.
- Recorded [ADR-0022](ADRs/ADR-0022-rust-authoritative-outcome-contract.md),
  [Checkpoint 59](checkpoints/2026-08-04-59-outcome-contract-local-gate.md), and
  [CLI ship lane 4](../tasks/SLICE-CLI4-developer-capabilities.md). Hosted and
  controlled VS Code gates remain pending before 4A is accepted.

## 2026-08-03 - Credentialed OpenAI multi-turn gate

- A conservative synthetic text call proved the persisted project key and direct
  Responses endpoint without sending Forge repository data.
- One-read passed, but dependent search-to-read stopped early. The audit found that
  the `store: false` adapter did not replay exact OpenAI output items and that
  "one tool in this turn" was ambiguous to GPT-5.6 Sol.
- The adapter now replays bounded provider-private output items, including encrypted
  reasoning state, alongside the next function result. That state remains outside
  the canonical artifact and event contract.
- Planner wording now says one tool per provider response and explicitly permits a
  new tool after Forge returns a result. The runtime one-call-per-response invariant
  is unchanged.
- Full local validation passed typecheck, 58/58 tests, and build. Final synthetic
  search-to-read passed on both GPT-5.6 Sol and Qwen 7B with three inference turns,
  two successful capabilities, and 12 canonical events.
- Earlier terminal responses were mechanically `completed` while failing the
  requested outcome. This is retained as the concrete gate for increment 4's
  explicit outcome-verification state.
- Exact implementation `5b8d226` passed all five hosted jobs: Node on
  Windows/macOS in Actions run `30867433664` and the real Rust-kernel/TypeScript
  product on Windows/macOS/Ubuntu in run `30867433674`.
- Recorded [Checkpoint 58](checkpoints/2026-08-03-58-openai-live-multiturn-gate.md).
  Increment 3 is accepted and ready to merge through draft PR #17.

## 2026-08-03 - Deterministic host-authority replay under concurrency

- A macOS hybrid rerun exposed a time-of-check/time-of-use race in host challenge
  consumption: the losing consumer could see the pending record disappear before
  it observed the winner's consumed evidence.
- A defensive recheck and 32-race regression then exposed the deeper mechanism on
  hosted Ubuntu and macOS: `create_new` made the final filename visible before its
  JSON was fully written.
- Ledger records now synchronize in private same-filesystem staging files and publish
  complete immutable content atomically with no-overwrite hard links. Consumed
  evidence is still cryptographically revalidated; missing or corrupt evidence
  remains fail-closed.
- The atomic boundary passed macOS and Ubuntu, while Windows revealed that copying
  the public colon-bearing challenge ID into a filename had used NTFS alternate data
  streams. Private filenames now encode `:` as `%3A` without changing public IDs.
- The regression requires exactly one success and one exact replay rejection in all
  32 races. The next macOS/Ubuntu core run passed; two integration fixtures that
  hardcoded the retired private path were corrected to locate the ledger record by
  behavior. Local formatting and the 57-test TypeScript gate pass; the next hosted
  Rust/product validation is the acceptance authority.
- Exact implementation `86daa83` passed hosted Node on Windows/macOS and the full
  Rust-kernel/TypeScript product on Windows/macOS/Ubuntu. The bounded correction is
  accepted.
- Recorded [Checkpoint 57](checkpoints/2026-08-03-57-host-authority-replay-race.md).

## 2026-08-03 - Low-compute model floor and provider-context correction

- Exercised qwen2.5-coder 0.5B, 1.5B, 3B, and 7B against bounded text, read,
  semantic, and search-to-read tasks instead of validating only the strongest
  local model.
- Found that provider prompts exposed selected workspace locators without their
  contents. Small models treated that pseudo-context as evidence and selected an
  unrelated file.
- Replaced locator-only provider context with selected/omitted counts plus an
  explicit instruction to obtain workspace facts through Forge tools. Internal
  ContextPlan and RunArtifact contracts are unchanged.
- Measured task floors were 0.5B text-only, 1.5B literal one-read extraction, 3B
  one-read semantic interpretation, and 7B search-to-read composition. These are
  prompt-specific results, not automatic-routing guarantees.
- The corrected 7B one-read task stayed 3/3 grounded while provider input fell
  from 3,785 to 2,670 tokens, about 29.5%.
- The full local gate passed typecheck, 57/57 tests, and build. A controlled VS
  Code Agent run then used exactly one Forge summary call and returned the
  canonical six-event order without recovery calls.
- VS Code's extension host did not inherit a terminal-only kernel override. Forge
  failed closed until the accepted kernel was installed at its normal discovery
  path; the machine cannot rebuild it locally until the MSVC linker is installed.
- Draft PR 17 then passed all five hosted jobs at `5326122`: Node on Windows and
  macOS, plus the real Rust-kernel/TypeScript product on Windows, macOS, and Ubuntu.
- Updated [ADR-0020](ADRs/ADR-0020-explicit-local-context-and-provider-evidence-projection.md)
  and recorded [Checkpoint 56](checkpoints/2026-08-03-56-low-compute-model-floor.md).

## 2026-08-03 - Interactive CLI local gate

- Added a thin plain-forge prompt shell over independent canonical Rust runs.
- Added deterministic local Ollama model discovery, visible effective route and
  workspace state, slash controls, --help, and concise default errors.
- Consolidated one-shot and interactive execution through one provider-task helper;
  no session runtime, policy path, or event contract was added.
- A piped-input smoke exposed lost buffered readline lines. A queued input adapter
  fixed TTY and scripted input through the same path.
- Full validation passed: typecheck, 57 tests, build, one live interactive read
  task, and a two-prompt same-process Qwen session.
- Recorded [ADR-0021](ADRs/ADR-0021-ephemeral-interactive-shell.md) and
  [Checkpoint 55](checkpoints/2026-08-03-55-interactive-cli-local-gate.md).

## 2026-08-03 - Qwen context and outcome hardening

- Declared an 8K Ollama context window, temperature-zero agent turns, and a
  validated FORGE_OLLAMA_CONTEXT_TOKENS override.
- Projected duplicate workspace.read evidence into compact citation-ready provider
  context without changing the internal capability result or RunArtifact.
- Rejected printed tool-protocol envelopes instead of falsely accepting them as
  terminal answers.
- Full validation passed: typecheck, 54 tests, build, live Qwen text and repeated
  one-read runs, JSON isolation, and timeout cleanup.
- A stronger two-tool experiment still exposed early stopping and hallucination.
  Runtime completion is therefore not documented as grounded outcome acceptance;
  an explicit outcome-verification contract remains required.
- Recorded [ADR-0020](ADRs/ADR-0020-explicit-local-context-and-provider-evidence-projection.md)
  and [Checkpoint 54](checkpoints/2026-08-03-54-qwen-context-and-outcome-hardening.md).

## 2026-08-03 - Live CLI local gate

- Implemented ephemeral validated provider streaming and canonical runtime status
  presentation without introducing a second runtime or event log.
- Preserved `--json` as one terminal artifact and unified first-SIGINT/deadline
  cancellation through the existing Rust bridge abort path.
- Passed typecheck, 52 tests, build, exact-kernel probe, live Qwen text,
  one-tool continuation, JSON isolation, and live timeout cleanup locally.
- Draft PR #17 at `d5ac3d7` passed Node on Windows/macOS and the full Rust product
  matrix on Windows/macOS/Ubuntu. Controlled VS Code remains pending because the
  fresh worktree requires a developer-owned Workspace Trust decision; live OpenAI
  remains deliberately paused for credential setup.
- Recorded [Checkpoint 53](checkpoints/2026-08-03-53-live-cli-local-gate.md) and
  updated [CLI ship lane 3](../tasks/SLICE-CLI3-live-loop.md).

## 2026-08-03 - Live CLI presentation boundary opened

- Merged real inference through PR #16 as `e865de5` and opened CLI ship lane 3 on
  `feature/cli-live-loop` from that exact `develop` head.
- Accepted [ADR-0019](ADRs/ADR-0019-ephemeral-live-cli-presentation.md): validated
  provider deltas are ephemeral human presentation, while Rust-streamed run events
  and the terminal artifact remain authoritative.
- Kept `--json` as one terminal JSON document; live human output may stream, but it
  cannot create a second event log, session runtime, or policy path.
- OpenAI live acceptance is deliberately paused until the developer configures a
  project-scoped `OPENAI_API_KEY`; Ollama/Qwen remains the development baseline.
- Recorded [Checkpoint 52](checkpoints/2026-08-03-52-live-cli-start.md) and opened
  [CLI ship lane 3](../tasks/SLICE-CLI3-live-loop.md).


## 2026-08-03 - Real inference hosted, product, and VS Code gate

- Accepted CLI ship lane 2 on `feature/cli-real-inference` at implementation head
  `cf26d85`; draft PR #16 remains the merge boundary.
- Hosted Node run `30848081978` passed Windows and macOS. Hosted hybrid run
  `30848081363` passed Windows, macOS, and Ubuntu, including Rust checks, product
  smoke, release artifacts, hybrid contracts, and the bridge benchmark.
- The exact hosted Windows kernel passed `doctor`, real product inspection, a live
  Ollama text run, and a live bounded one-tool run through the Rust-owned artifact.
- A controlled VS Code Agent run exposed exactly seven selected Forge tools and
  completed one workspace-summary call in four seconds with no built-in call,
  mutation, retry, or artifact externalization.
- OpenAI remains transport-conformant rather than live-accepted because no cloud
  credential was present. Interactive streaming remains CLI ship lane 3; this
  acceptance does not claim an OS sandbox or public MCP mutation.
- Recorded [Checkpoint 51](checkpoints/2026-08-03-51-real-inference-hosted-product-and-vscode-gate.md)
  and updated [CLI ship lane 2](../tasks/SLICE-CLI2-real-inference.md).


## 2026-08-03 - Real inference local gate

- Added bounded Ollama Chat and OpenAI Responses adapters behind the existing
  `TaskPlanner` bridge, plus explicit provider/model routing with no fallback.
- Added Rust-recorded terminal inference evidence and mirrored fail-closed
  validation without creating a second runtime or event hierarchy.
- Bumped the run bridge to `forge.kernel.bridge.v3` so stale kernels cannot silently
  discard the new evidence contract.
- Consolidated the seven evidence capabilities into one reusable pack and one
  service planner/runtime composition path.
- Removed the public legacy candidate commands/exports and replaced fake task
  execution with provider-backed `forge run`; smoke now names `forge inspect`.
- Extracted shared verification configuration so the sovereign change path no
  longer depends on the legacy candidate transaction adapter for its types.
- Local typecheck, 49 tests, build, Rust formatting, live Ollama text, and live
  one-tool gates passed. Native Rust, hosted cross-platform, product CLI, and VS
  Code gates remain open. See [Checkpoint 50](checkpoints/2026-08-03-50-real-inference-local-gate.md).

## 2026-08-03 - Real inference path and debt-retirement gate opened

- Merged kernel convergence through PR #15 at `1fcab25` and opened CLI ship lane 2
  on `feature/cli-real-inference`.
- Accepted [ADR-0018](ADRs/ADR-0018-provider-neutral-inference-and-debt-retirement.md):
  provider adapters reuse the canonical TypeScript planner bridge while Rust keeps
  run, policy, events, budgets, and terminal-artifact authority.
- Made removal of the fake inventory-backed `forge run`, the public legacy
  `forge candidate` command, and public legacy runtime exports part of the slice
  gate. No inference-specific runtime or parallel orchestration layer is allowed.
- Recorded [Checkpoint 49](checkpoints/2026-08-03-49-real-inference-start.md) and
  opened [CLI ship lane 2](../tasks/SLICE-CLI2-real-inference.md).

## 2026-08-03 - Kernel convergence hosted and VS Code gate

- Accepted kernel convergence on feature branch `feature/cli-kernel-convergence`
  at implementation head `ca9809f`; PR #15 subsequently merged as `1fcab25`.
- Hosted Node run `30839933843` passed Windows and macOS. Hosted hybrid run
  `30839933999` passed Windows, macOS, and Ubuntu, including native release builds,
  product smoke, and retained kernel artifacts.
- The exact hosted Windows artifact passed local `doctor` and product smoke. The
  controlled VS Code gate then discovered exactly seven Forge tools and completed
  one bounded workspace-summary call in three seconds without built-ins or
  mutation.
- Kernel convergence does not add model inference, a live multi-turn loop,
  packaging, or Forge-enforced OS containment. `restricted` remains fail-closed.
- Recorded [Checkpoint 48](checkpoints/2026-08-03-48-kernel-convergence-hosted-and-vscode-gate.md)
  and updated [ADR-0017](ADRs/ADR-0017-product-runtime-authority-and-restricted-sequencing.md).

## 2026-08-03 - Kernel convergence local gate

- Removed the implicit TypeScript product fallback: CLI and MCP now require the Rust
  kernel, while Node-only protocol tests select an explicitly named conformance
  fixture.
- Added deterministic kernel discovery and a bounded protocol/version probe used by
  `forge doctor`.
- Local `npm run check` passes 44/44 tests plus production build; Rust formatting
  passes. Native Windows compilation remains hosted-only because this workstation
  lacks the MSVC linker.
- Recorded [Checkpoint 47](checkpoints/2026-08-03-47-kernel-convergence-local-gate.md).
  Hosted Windows/macOS/Ubuntu and controlled VS Code gates remain open, so this
  increment is not yet accepted.

## 2026-08-03 - Kernel convergence and CLI ship lane opened

- Confirmed Slice 2F-2b is accepted on protected `develop` at merge `6bc2bfb`;
  pre-merge and post-merge Windows/macOS/Ubuntu gates are green.
- Accepted [ADR-0017](ADRs/ADR-0017-product-runtime-authority-and-restricted-sequencing.md):
  Rust becomes the unconditional product run authority, while the TypeScript
  coordinator remains an explicitly named conformance fixture.
- Opened [CLI ship lane 1](../tasks/SLICE-CLI1-kernel-convergence.md) and recorded
  [Checkpoint 46](checkpoints/2026-08-03-46-kernel-convergence-start.md).
- Retained native Windows/macOS restricted execution as separately proven
  hardening. `restricted` remains fail-closed; trusted alpha limitations stay
  visible.
- Added the exploratory [Project Sybil working specification](../architecture/project-sybil-working-spec.md).

## 2026-08-02 - Slice 2F-2b VS Code gate

- Passed the controlled Slice 2F-2b VS Code tether gate from the exact feature
  worktree with only seven Forge tools enabled. One bounded workspace-summary call
  completed without retry, fallback, externalization, or mutation and preserved
  the canonical six-event lifecycle. Hosted native acceptance subsequently passed
  before pull request #14 merged. See Checkpoint 45 and the Slice 2F-2b task.

## 2026-07-30 - Slice 2F-2b local implementation audit

- Implemented the Rust-derived capability/policy binding, authenticated host
  provider, one-use execution grant, durable pre-launch evidence revalidation,
  transaction v2 negotiation frames, and TypeScript signer transport.
- The second audit blocked duplicate authorization before challenge consumption,
  bounded the control queue/frame, corrected the corrupt-evidence regression, and
  reaped validated expired pending challenges before capacity enforcement.
- Local Rust check/rustfmt/Clippy and `npm run check` (39/39 Node tests) pass. Native
  execution remains blocked by missing local Windows linkers, so hosted Windows/
  macOS/Ubuntu and controlled VS Code gates remain mandatory.
- Recorded
  [Checkpoint 44](checkpoints/2026-07-30-44-host-provider-bridge-local-audit.md).
  At that local-only checkpoint core completion remained 94% until external acceptance closed.

## 2026-07-30 - Slice 2F-2b host provider/bridge opened

- Accepted
  [ADR-0016](ADRs/ADR-0016-rust-derived-host-execution-grant.md): capability and
  verification-policy identities are derived from exact Rust transaction facts,
  and verified host authority becomes a single-use provider grant.
- Opened
  [Slice 2F-2b](../tasks/SLICE-002F2B-host-provider-bridge.md) with pre-application
  authentication, durable evidence revalidation, bounded host/kernel frames,
  cancellation, and cross-platform gates.
- Recorded
  [Checkpoint 43](checkpoints/2026-07-30-43-host-provider-bridge-design.md).
  This increment authenticates host-attested execution; it does not claim an OS
  sandbox or Forge-enforced restricted controls.
## 2026-07-30 — Slice 2F-2a signed host challenge accepted

- Accepted Slice 2F-2a at `71a3ec6`: Forge issues a short-lived, bound challenge,
  strictly verifies the host's Ed25519 statement, and durably consumes the proof
  before returning authority evidence.
- Restart/concurrent replay, stale/future/altered/wrong-key statements, transcript
  drift, audit tampering, traversal, corruption, and unexpected ledger entries fail
  closed. Forge and Ed25519 share one SHA-2 0.11 stack.
- Hosted cross-platform run
  [30562764333](https://github.com/celestialcactus/forge-engine/actions/runs/30562764333)
  passed Windows/macOS, and hybrid run
  [30562764595](https://github.com/celestialcactus/forge-engine/actions/runs/30562764595)
  passed Windows/macOS/Ubuntu.
- The controlled seven-tool VS Code regression remained one read-only call with no
  mutation. This is tether evidence, not host authentication or containment.
- Recorded
  [Checkpoint 42](checkpoints/2026-07-30-42-signed-host-challenge-hosted-and-vscode-gate.md).
  Host-managed execution remains unavailable until Slice 2F-2b wires Rust-owned
  transaction facts and verified evidence into the provider.

## 2026-07-30 — Slice 2F-2a signed host challenge opened

- Accepted
  [ADR-0015](ADRs/ADR-0015-signed-host-challenge-ledger.md): Forge will verify a
  short-lived, capability/policy-bound Ed25519 host statement and durably consume
  its challenge before returning authority evidence.
- Opened
  [Slice 2F-2a](../tasks/SLICE-002F2A-authenticated-host-challenge-ledger.md) with
  stale, altered, replay, restart, and concurrent-consumer rejection gates.
- Recorded
  [Checkpoint 41](checkpoints/2026-07-30-41-authenticated-host-challenge-design.md).
  This is authentication and replay machinery, not an OS sandbox or an executing
  host-managed provider.

## 2026-07-30 — Slice 2F-1 isolation authority contract accepted

- Accepted Slice 2F-1 at `ef0a125`: providers now advertise bounded capabilities;
  Forge validates request support before execution and returned evidence against
  provider, policy, and request afterward.
- The baseline provider is trusted-only. Raw host-managed and unsupported
  restricted requests fail before verifier launch; failed validation cannot retain
  or promote a candidate.
- Hosted cross-platform run
  [30559452883](https://github.com/celestialcactus/forge-engine/actions/runs/30559452883)
  passed Windows/macOS, and hybrid run
  [30559452477](https://github.com/celestialcactus/forge-engine/actions/runs/30559452477)
  passed Windows/macOS/Ubuntu.
- A fresh controlled VS Code regression remained exactly one read-only Forge call
  with seven selected Forge tools and no mutation. This is a tether regression,
  not a restricted-provider test.
- Recorded
  [Checkpoint 40](checkpoints/2026-07-30-40-isolation-authority-contract-hosted-and-vscode-gate.md).
  Core completion is conservatively 93%; authenticated host negotiation and a
  proven Windows/macOS restricted backend remain.

## 2026-07-30 — Slice 2F-1 isolation authority contract opened

- Accepted
  [ADR-0014](ADRs/ADR-0014-isolation-provider-authority.md): every execution
  provider must advertise bounded capabilities, Forge validates support before
  launch, and returned evidence must match provider, policy, and request.
- Opened
  [Slice 2F-1](../tasks/SLICE-002F1-isolation-authority-contract.md). The baseline
  provider will support trusted execution only; unauthenticated host-managed
  assertions will fail before process launch.
- Recorded
  [Checkpoint 39](checkpoints/2026-07-30-39-isolation-authority-contract-start.md).
  This is a truthfulness and authority correction, not a sandbox or authenticated
  handshake.
## 2026-07-30 — Slice 2E sovereign transaction loop accepted

- Accepted Slice 2E-3b at `16c5569`. The public
  `forge change propose|inspect|accept|discard` workflow now transports one
  Rust-owned ChangeSet v2 service and durable coordinator; TypeScript does not
  decide mutation, verification policy, recovery, or terminal state.
- Hosted cross-platform run
  [30556929564](https://github.com/celestialcactus/forge-engine/actions/runs/30556929564)
  passed Windows/macOS, and hybrid run
  [30556929739](https://github.com/celestialcactus/forge-engine/actions/runs/30556929739)
  passed Windows/macOS/Ubuntu including the sovereign CLI exercise.
- A controlled VS Code regression retained exactly seven Forge tools and used one
  workspace-summary call in four seconds with no mutation. Core completion is now
  conservatively 92%; authenticated host negotiation and minimum proven
  Windows/macOS restricted execution remain Slice 2F. See
  [Checkpoint 38](checkpoints/2026-07-30-38-sovereign-cli-hosted-and-vscode-gate.md).

## 2026-07-30 — Slice 2E-3b sovereign CLI convergence opened

- Accepted [ADR-0013](ADRs/ADR-0013-sovereign-changeset-v2-cli-boundary.md):
  the current CLI will converge on one Rust-owned ChangeSet v2 protocol rather
  than orchestrate the older text transaction and candidate lifecycles in
  TypeScript.
- Opened
  [Slice 2E-3b](../tasks/SLICE-002E3B-sovereign-transaction-cli.md) with explicit
  proposal/policy separation, durable verification evidence, terminal candidate
  cleanup, and Windows/macOS Tier-1 gates.
- Recorded
  [Checkpoint 37](checkpoints/2026-07-30-37-sovereign-cli-convergence-start.md)
  after the Slice 2E-3a post-merge Node and hybrid matrices passed.
## 2026-07-30 — Unix owner-death watchdog accepted

- Accepted [ADR-0012](ADRs/ADR-0012-unix-owner-death-watchdog.md) at implementation
  `c872a81`. The packaged Rust watchdog uses owner-pipe EOF, a bounded startup
  acknowledgement, and one dedicated process group; missing/invalid helper and
  verifier startup fail closed without collapsing startup failure into verifier
  failure.
- Hybrid run `30551820932` passed on Windows/macOS/Ubuntu and Node run
  `30551821183` passed on Windows/macOS. Hosted macOS/Ubuntu owner-`SIGKILL`
  fixtures left no survivor marker; Windows retained its Job Object path.
- The controlled VS Code regression exposed exactly seven Forge tools and completed
  one workspace-summary call in seven seconds with no retry or mutation. Core
  completion is now conservatively 86%; candidate cleanup and the sovereign
  transaction CLI remain Slice 2E-3b. See
  [Checkpoint 36](checkpoints/2026-07-30-36-unix-owner-death-hosted-and-vscode-gate.md).

## 2026-07-30 — Unix owner-death watchdog started

- Opened Slice 2E-3a to close the abrupt Unix/macOS verifier-owner-death gap before
  exposing the sovereign transaction CLI. [ADR-0012](ADRs/ADR-0012-unix-owner-death-watchdog.md)
  selects a small first-party Rust watchdog: Forge owns the only liveness-pipe
  writer, the watchdog inherits the reader and verifier process group, and owner
  EOF terminates the ordinary inherited hierarchy.
- Missing or invalid helper packaging fails before verifier execution. This is
  lifecycle reliability, not a sandbox; deliberate process-group escape and
  permission containment remain separate Slice 2F concerns. See the
  [Slice 2E-3a task](../tasks/SLICE-002E3A-unix-owner-death-watchdog.md) and
  [Checkpoint 35](checkpoints/2026-07-30-35-unix-owner-death-watchdog-start.md).
## 2026-07-30 — Durable ChangeSet v2 coordinator accepted

- Accepted [ADR-0011](ADRs/ADR-0011-durable-changeset-v2-coordinator.md) at
  implementation `8c29037`. The Rust-owned manifest, exact before-images, and
  synchronized transition journal passed promotion/rollback fault injection,
  process-restart reconciliation, corruption, cancellation, and divergent-edit
  fixtures.
- Hosted cross-platform run `30511168395` passed on Windows/macOS; hybrid kernel
  run `30511168400` passed on Windows/macOS/Ubuntu.
- The controlled VS Code 1.130 regression used only the seven checked Forge tools,
  made one workspace-summary call, and completed without retries, built-in tools,
  artifact externalization, or a stall. See
  [Checkpoint 34](checkpoints/2026-07-30-34-durable-coordinator-hosted-and-vscode-gate.md).
- Updated the authoritative build plan to 82% core completion. Abrupt macOS owner
  death, complete candidate cleanup, and the sovereign transaction CLI remain the
  Slice 2E critical path; public MCP mutation and restricted execution remain
  Slice 2F.

## 2026-07-29 — Durable ChangeSet v2 coordinator started

- Opened Slice 2E-2 from protected `develop@5a02194`.
- Proposed [ADR-0011](ADRs/ADR-0011-durable-changeset-v2-coordinator.md):
  reuse the Rust-owned ChangeSet v2 contract with a bounded filesystem manifest,
  exact before-images, append-oriented transitions, fresh per-path conflict checks,
  and restart reconciliation.
- Recorded [Checkpoint 33](checkpoints/2026-07-29-33-durable-coordinator-start.md).
- Kept the guarantee explicit: process-crash recovery is in scope; power-loss
  durability, macOS abrupt verifier-owner cleanup, and restricted execution remain
  separate named gates.
This is a concise navigation log. Detailed reasoning belongs in ADRs, audits, and
checkpoint records.

## 2026-07-10

- Audited the preliminary implementation and classified it as prototype/reference
  material rather than an architectural authority. See `docs/audit/`.
- Began a ground-up V1 reconstruction focused on a host-neutral runtime, sovereign
  local operation, deliberate cloud escalation, and interchangeable standalone,
  master, apprentice, and embedded roles.
- Archived the prototype intact under `docs/archive/prototype/`.
- Adopted strict TypeScript on Node.js 22 and the golden-run protocol for ordered,
  deterministic run artifacts. See ADR-0001 and Checkpoint 06.
- Selected append-oriented events/artifacts with SQLite as a later local projection;
  graph storage remains an optional derived projection rather than a V1 authority.

## 2026-07-20

- Adopted the official MCP TypeScript SDK at the host boundary. See ADR-0002.
- Added deterministic repository evidence using Forge-owned file adapters, the
  TypeScript compiler API, and fixed read-only Git commands. See ADR-0003.
- Reached Developer Test Milestone A with seven read-only MCP tools and a controlled
  VS Code test guide. See Checkpoints 07-09.

## 2026-07-22

- Completed the Slice 1 release-gate audit and corrected the competing runtime,
  task-discarding CLI path, search canonicalization, UTF-8 validation, cache-call
  identity, package export, and stale documentation findings. See
  `docs/audit/slice-1-closure-audit.md`.
- Accepted observed connection-scoped snapshot reuse with invalidation, a bounded
  rescan ceiling, and scan-per-call fallback. See ADR-0004.
- Accepted and closed Slice 1 with a single runtime, seven bounded evidence
  capabilities, CLI/MCP/embedded host paths, and explicit scale limitations. See
  Checkpoint 10.
- Began Slice 2 with a service-only, digest-bound, deterministic change proposal;
  no production write or eighth MCP tool was added. See ADR-0005.
- Validated the first Windows worktree/process experiment: worktree edits isolate
  the original workspace, dirty state and ignored dependencies do not transfer,
  and bounded direct-child verification can distinguish timeout and cancellation.
  Worktree isolation is recoverability, not a security sandbox. See Checkpoint 11.

- Added a locked Node 22 conformance matrix for Windows and macOS plus a controlled
  VS Code Slice 2A record. The VS Code boundary retained exactly seven read-only
  tools, with one residual host-only relative-path rendering exception.
- The first platform matrix caught CRLF-dependent evidence hashes on Windows while
  macOS passed. Added a repository LF checkout contract and reran the same commit
  lineage successfully on hosted Windows and macOS. Slice 2A is accepted; apply,
  verify, accept/recover, and rollback remain later Slice 2 gates.

- Paused Slice 2B and opened SGU-003 to evaluate a Rust machinery kernel behind
  TypeScript integration adapters. Local differential, cancellation, official MCP,
  static Windows packaging, latency, and controlled VS Code gates pass; hosted
  Windows/macOS/Linux remains the closure gate. See ADR-0006 and Checkpoint 12.
- Conditionally accepted Rust as the target authority for run state, events,
  correlation, terminal artifacts, and future durable/process machinery. Retained
  TypeScript for MCP/IDE/compiler/vendor integrations and prohibited a permanent
  Node sidecar for baseline sovereign CLI operation.
- Clarified that Forge is permanently hybrid rather than on a path to an all-Rust
  rewrite: TypeScript owns rapid tool, workflow-definition, provider, MCP, IDE,
  and compiler integration, while Rust owns final policy and authoritative
  execution state. Recorded the one-month demo plan, apprentice-first enterprise
  adoption, bidirectional central-harness compatibility, comparative efficiency
  metrics, and the open-source license gate in Checkpoint 13.
- Closed SGU-003 as an architecture go after the exact pushed commit passed the
  Windows/macOS/Ubuntu hybrid matrix, the Windows/macOS TypeScript matrix, and a
  one-call controlled VS Code apprentice test. Production adoption remains staged;
  the spike process topology is not the production lifecycle. See Checkpoint 14.
- Opened SGU-004 to replace the spike's TypeScript-computed approval decision with
  attributable host/user facts and a final Rust-owned policy result before Slice
  2B mutation work resumes.
- Closed SGU-004 with private bridge protocol v2: TypeScript supplies attributable,
  exact-call host/user facts; Rust validates them, applies deny and consent
  precedence, produces the only final decision, and records structured facts in
  the approval event. Local gates, hosted Windows/macOS/Linux hybrid conformance,
  the Windows/macOS TypeScript matrix, and an exact-commit one-call VS Code test
  pass. Benchmark scripts now have their own TypeScript gate after hosted closure
  caught a stale constructor fixture. See Checkpoint 15.
- Began Slice 2B with a Rust-owned candidate transaction contract. An internal
  application manifest now binds exact replacement content to the Slice 2A
  proposal, snapshot, approved capability subject, and policy-named verification.
  Rust alone assigns verified, recovered, cancelled, or failed status and rejects
  malformed adapter evidence. Eleven focused tests and the complete hybrid gate
  pass; the production worktree/process adapter and final promotion remain
  pending. See ADR-0007 and Checkpoint 16.
- Accepted Slice 2B Increment 2B-1 after the exact pushed commit passed the
  Windows/macOS/Ubuntu hybrid matrix, the Windows/macOS TypeScript matrix, and a
  controlled one-call VS Code apprentice test. The production clean-revision
  worktree/process adapter remains Increment 2B-2.
- Accepted Slice 2B Increment 2B-2 after clean-revision, adversarial recovery,
  and descendant-process fixtures passed on hosted Windows, macOS, and Ubuntu,
  the TypeScript matrix passed on Windows and macOS, and a reloaded VS Code Agent
  completed a one-call seven-tool apprentice regression. Promotion and sandbox
  isolation remain separate gates. See Checkpoint 17.
- Accepted ADR-0008 and SGU-005: verification processes now route through a
  Rust-owned isolation-provider contract. `trusted` records no OS containment,
  `host_managed` requires an allowlisted inherited-boundary attestation satisfying
  policy-required controls, and `restricted` fails closed until a Forge-enforced
  platform backend exists. The first hosted run exposed a macOS parallel test-
  fixture name collision; a test-only atomic sequence fixed it. The accepted
  commit passed Windows/macOS/Ubuntu hybrid and Windows/macOS TypeScript matrices.
  See Checkpoint 18.
- Opened draft PR #1 from the direct master-descended Slice 2 branch to replace
  the archived prototype with the validated reconstruction. Added the exact
  current sandbox, host-attestation, inherited-environment, and read-only public
  surface limitations to the build plan.
- Opened Slice 2C on a separate branch. The private host transaction bridge begins
  with a Rust-owned opaque candidate lease and restart-safe discard contract,
  followed by a separate bounded transaction protocol and embedded TypeScript
  adapter. Trusted mode only; host-managed handshake, restricted isolation,
  promotion, transaction CLI, and MCP mutation remain deferred. See Checkpoint 19.
- Accepted Slice 2C Increment 2C-0 after a Rust-owned opaque candidate lease,
  approved base-revision binding, restart-safe lookup/discard, cleanup-failure
  retry, and replacement-text exclusion passed the complete local gate. The first
  hosted run exposed an Ubuntu advisory-lock release defect; explicit RAII unlock
  corrected it. Exact commit `a985119` passed Windows/macOS TypeScript conformance
  and Windows/macOS/Ubuntu hybrid conformance. See Checkpoint 20.
- Prioritized the honest limitation backlog for the one-month prototype. The
  private transaction bridge is P0; environment minimization, promotion/discard,
  and a thin experimental candidate CLI are P1. Authenticated host handshake and
  high-level MCP mutation are P2; Forge-owned sandboxing, privilege separation,
  and speculative long-lived-kernel work are P3. Generic shell/write tools remain
  architectural non-goals. See Checkpoint 21.
- Implemented the bounded, trusted-only `forge.kernel.transaction.v1` protocol
  and embedded TypeScript transaction adapter without moving policy or terminal
  status out of Rust. Exact implementation `fa9898f` proves verified-candidate
  retention, original-workspace preservation, authority rejection, redacted
  malformed input, and in-flight cancellation with recovery across hosted
  Windows, macOS, and Ubuntu gates. See Checkpoint 22.
- Opened Slice 2D from the accepted Slice 2C checkpoint. Increment 2D-0 clears and
  reconstructs verifier environments from a bounded baseline plus explicit trusted
  policy, records names without values, and proves secret-like variables are absent
  through the real private bridge. Exact implementation `1339f53` passed hosted
  Windows, macOS, and Ubuntu conformance. Candidate promotion remains the next
  Rust-owned gate. See Checkpoint 23.
- Completed the local Slice 2D candidate-loop gate. Rust now owns fresh-subject
  inspection, promotion, exact rollback/restart recovery, and fresh-approved
  discard through `forge.kernel.candidate.v1`; TypeScript is a bounded transport
  and thin `forge candidate` CLI. Windows line-ending tests rejected direct Git
  apply as the byte-authority mechanism, so Git now proves applicability while
  exact verified bytes land through platform atomic replacement with durable
  recovery backups. Two-file partial failure, tamper/extra/missing path, replay,
  divergence, CLI-consent, and seven-tool MCP conformance pass the complete local
  gate. Exact implementation `8693684` passed hosted Windows/macOS/Ubuntu
  conformance. See Checkpoint 24.
## 2026-07-27

- Re-groomed the post-Slice 2D build path around core-runtime reliability. Windows
  and macOS are Tier-1 product/acceptance platforms; Ubuntu remains a compatibility
  gate. Opened Slice 2E for ChangeSet v2, content-addressed staging, transaction
  coordination/recovery, concurrency checks, cancellation, and a complete local
  workflow. See ADR-0009 and Checkpoint 25.
- Assigned previously vague security/integration limits to Slice 2F: authenticated
  host-managed negotiation, policy/audit exchange, a minimum real restricted
  execution backend on Tier-1 platforms, and high-level MCP/VS Code mutation.
  Generic shell and unrestricted write tools remain non-goals.
- Accepted Slice 2E-0 at exact implementation `fd3d9eb`. The Rust-owned ChangeSet
  v2 and bounded content-addressed store use five tagged operation variants to cover
  create, replace, delete, move/rename, mode intent, and binary/text content.
  Adversarial path, identity, bounds, corruption, and concurrent no-overwrite tests
  passed hosted Windows/macOS Tier-1 and Ubuntu compatibility gates. See ADR-0009
  and Checkpoint 26.
- Established `rebuild/master` as the stable reconstruction line and
  `rebuild/develop` as its integration line, both at accepted Slice 2D commit
  `3b2b62f`. Accepted feature checkpoints flow into develop; named stable milestones
  promote develop through a separate PR. The historical default `master` remains
  unchanged. The hybrid workflow now covers feature, fix, and rebuild pushes so
  post-merge integration heads retain the Rust/kernel gate. See Checkpoint 27 and
  the rebuild branch strategy.
- Promoted literal `develop` to the canonical, readily pullable reconstruction
  integration branch from validated commit `8d295b1`. PR #4 merged the transition
  as `b462f335`; that exact `develop` push passed cross-platform conformance on
  Windows/macOS (run `30298569364`) and hybrid kernel conformance on
  Windows/macOS/Ubuntu (run `30298569650`). `rebuild/develop` is frozen at
  `8d295b1` for transition history, while `rebuild/master` remains the stable
  promotion line and historical `master` remains unchanged. See Checkpoint 28.

## 2026-07-28

- Made `develop` the GitHub default and enforced the documented branch model.
  `develop` and `rebuild/master` now require PRs, strict Windows/macOS/Ubuntu
  status checks, and resolved conversations even for administrators; force-pushes
  and deletion are blocked. Historical `master` and transitional
  `rebuild/develop` are locked. Only merge commits are enabled, merged head branches
  are deleted automatically, and CI no longer duplicates topic-push and PR runs.
  See Checkpoint 29.
- Accepted Slice 2E-1a at exact implementation `b930d31`. Rust now derives
  repository-backed path identity and applies the full ChangeSet v2 algebra only in
  an external detached worktree with repeated CAS/base checks, exact per-operation
  evidence, bounded diff evidence, and failure cleanup. Windows/macOS Tier-1 and
  Ubuntu compatibility conformance passed. Active promotion and durable v2
  coordination remain unavailable. The audit also elevated deterministic Windows
  process-tree ownership to a P1 Slice 2E gate after one intermittent `taskkill`
  descendant-cleanup failure. See Checkpoint 30.
- Passed the local deterministic verifier process-ownership gate. Windows now
  creates the verifier suspended, assigns it to a Rust-owned kill-on-close Job
  Object before execution, and confirms the hierarchy is empty after teardown.
  Unix/macOS process-group errors and completion are checked. Five stress passes
  covered 35 nested timeout/cancellation/abrupt-owner hierarchies with no survivor;
  the complete hybrid gate passed. This is lifecycle reliability, not a sandbox.
  Hosted acceptance and abrupt macOS owner-death parity remain open. See ADR-0010,
  the process-ownership task, and Checkpoint 31.
- Accepted deterministic verifier process ownership at exact implementation
  `ff4aedf`. Hosted CI exposed Darwin's distinction between dead zombie descendants
  and an absent process group, plus PID-list/detail races. Forge now uses bounded
  SDK-matched macOS process inspection, accepts only disappeared or kernel-reported
  zombie members, and conservatively retries unknown existing members; live or
  unresolved state still fails closed. Protected Windows/macOS/Ubuntu hybrid run
  `30389805673` and Windows/macOS cross-platform run `30389804363` passed. Abrupt
  Unix/macOS supervisor-death handling remains open. See ADR-0010 and Checkpoint 32.
