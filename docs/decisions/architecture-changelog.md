# Architecture Changelog

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
- Recorded [Checkpoint 58](checkpoints/2026-08-03-58-openai-live-multiturn-gate.md).
  Exact-head hosted cross-platform revalidation remains before merge.

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
