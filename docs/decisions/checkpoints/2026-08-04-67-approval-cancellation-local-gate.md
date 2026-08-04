# Checkpoint 67 - approval cancellation accepted

**Date:** 2026-08-04
**Branch:** `feature/cli-approval-control`
**Base:** merged `develop` at `2ff5669` (PR #20)
**Implementation:** `ae746ffe117de1b98a0f780af00cb6171bb63c4d`
**Status:** CLI ship lane increment 5A accepted; 5B and 5C remain open

## Result

The accepted governed edit lifecycle now settles when the run is cancelled while
waiting for either developer decision.

- Before candidate execution, cancellation returns `cancelled` after read-only
  preparation and before `workspace.change.propose`.
- After successful candidate verification, Forge prints the durable transaction ID
  before asking for promotion. Cancellation retains that candidate and performs no
  accept/discard call.
- The Node readline adapter removes the pending waiter and abort listener on answer,
  EOF, close, or cancellation.
- The governed executor also races cancellation itself, so a non-conforming embedded
  question adapter cannot keep the capability promise pending.
- Ordinary decline/accept/discard and Rust transaction authority are unchanged.

No Rust schema, bridge protocol, mutation engine, or MCP surface was added. This is
an integration-boundary correction over the existing canonical run signal.

## Acceptance evidence

### Local deterministic gate

- `npm run typecheck`: passed.
- Focused approval/interactive/live CLI tests: 14/14 passed.
- `npm run check`: typecheck, 81/81 tests, and production build passed.
- `git diff --check`: passed.
- `cargo fmt --all -- --check`: passed using the pinned local Cargo binary.
- New regressions deliberately use a question adapter that ignores AbortSignal;
  the executor still settles and calls no later mutation operation.

The first focused runner attempt failed before test execution with Windows sandbox
`spawn EPERM`. The identical command passed outside the restricted process sandbox;
this is test-runner containment evidence, not a product failure.

### Exact-head hosted gate

- Node 22 passed on Windows and macOS in Actions run `30957571675`.
- The real Rust-kernel/TypeScript product passed on Windows, macOS, and Ubuntu in
  Actions run `30957571639`.

### Live Qwen cancellation gates

Both tests used `qwen2.5-coder:7b`, the exact unchanged Windows Rust kernel for this
implementation, disposable workspaces, and byte comparisons of the source file.

- First-decision timeout: run
  `run:07521128-25c7-4c28-8071-def5ba4a11a7` reached the candidate approval prompt,
  returned `cancelled`, called preparation only, displayed no promotion prompt, and
  left source bytes unchanged.
- Promotion-decision timeout: run
  `run:ece6c1dc-a27f-45d3-994a-8095390a5f98` completed candidate verification,
  displayed transaction
  `transaction:sha256:3e9555ae7f78a3d8d63c3bc848fd83947c63fb8b6fb9731347e8b8ff08d40cdc`,
  returned `cancelled`, retained the transaction, called neither accept nor discard,
  and left source bytes unchanged.

### Controlled VS Code tether

A fresh trusted VS Code Agent chat on this exact worktree selected exactly the seven
Forge MCP tools and no built-ins. The unchanged acceptance prompt requested one
`forge_workspace_summary` call with `maxFiles: 20`.

- exactly one Forge call and no retry, built-in, or mutation call;
- host-reported completion time: 3 seconds on `MAI-Code-1-Flash` Auto routing;
- run: `run:24afdcc4-c994-478d-9082-6bde3fd54f32`;
- snapshot: `workspace:a71a0b056f471139`;
- total files: 336; truncated: true;
- outcome: `verified`; run status: `completed`;
- ordered events: `run.started`, `context.planned`, `capability.requested`,
  `approval.decided`, `capability.completed`, `outcome.assessed`, `run.completed`.

This proves the read-only apprentice tether did not regress. It does not prove a VS
Code mutation or approval UI because Forge intentionally exposes no MCP mutation
tool.

## Capability truth at this checkpoint

Proven in 5A:

- both human governed-change waits settle on the canonical timeout/SIGINT signal;
- cancellation before proposal requests no candidate mutation;
- cancellation before promotion retains an identifiable verified candidate and
  performs no source promotion;
- the existing seven-tool read-only MCP surface remains bounded and usable.

Not yet proven or implemented:

- independent Rust-owned capability-call and inference/token budgets (5B);
- user-selectable policy posture and embedded-host callback conformance (5C);
- crash-resumable outer RunArtifact/conversation recovery (ship lane 6), although
  ChangeSet promotion and transaction recovery already exist;
- a Forge-enforced Windows/macOS OS sandbox or independently verified host
  containment;
- MCP mutation, public raw write/shell powers, or IDE approval composition;
- final native-binary packaging, clean install/update, signing, or a root license;
- live Qwen behavior on macOS. Cross-platform code passed hosted tests, but the live
  provider cancellation runs in this checkpoint were Windows-only.

The OpenAI transport was not retested because 5A did not change provider code. Its
earlier live acceptance remains separate evidence, not evidence from this increment.

## Decision and next gate

Accept increment 5A and merge PR #21 after the documentation-only exact head passes
the same hosted matrices. Proceed to 5B with one versioned Rust-owned execution
budget contract. Do not add CLI-only counters or claim recovery, containment, or
IDE mutation that the current product does not provide.
