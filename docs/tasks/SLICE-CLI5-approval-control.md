# CLI ship lane 5: approval and control

**Status:** active; 5A and 5B accepted, 5C implemented with hosted acceptance pending
**Branch:** `feature/cli-policy-profiles`
**Base:** merged `develop` at `74308ca` (PR #22)

## Objective

Make the accepted Forge run and change machinery stop predictably under developer
denial, cancellation, deadlines, and bounded resource exhaustion. Controls must be
visible and attributable, and they must terminate at the same Rust lifecycle rather
than being simulated by CLI prose.

## Existing accepted foundation

- Rust resolves versioned host-policy and user-consent facts to allow/ask/deny.
- The bridge requests approval facts with the Rust-authored capability context.
- Governed edits require exact candidate approval and a second promotion decision.
- The CLI supplies one AbortSignal for SIGINT and run timeout.
- Provider, bridge, verifier process tree, and ChangeSet coordinator cancellation
  paths are tested.
- `maxTurns` is Rust-authoritative and bounded from 1 through 32.

## Gap audit

1. Human approval waits were not abortable. Timeout or Ctrl+C could leave the CLI
   waiting for another line even though the run signal was cancelled.
2. `maxTurns` indirectly limits tool calls but does not express an independent
   capability-call budget or token/usage ceiling.
3. The former fixed product allow mappings are removed. The new product contract
   exposes developer/review/locked postures as facts while Rust remains the only
   decision authority.
4. Cancellation after a verified candidate is durable, but the outer RunArtifact is
   not yet crash-resumable. The CLI must expose the retained transaction ID while
   recovery work remains deferred.

## Increment 5A: cancellation-safe approval callbacks

[ADR-0026](../decisions/ADRs/ADR-0026-cancellation-safe-approval-callbacks.md)
requires approval questions to accept the run AbortSignal and requires the governed
executor to race cancellation independently. Before candidate execution,
cancellation returns without a mutation request. At the promotion prompt, Forge
prints and retains the verified transaction ID and does not call accept or discard.

### 5A exit gate

- [x] first-prompt cancellation calls only prepare and returns cancelled;
- [x] second-prompt cancellation calls prepare/propose only and returns the durable
      transaction ID without promotion;
- [x] decline, accept, discard, verification failure, and Rust terminal-state tests
      remain green;
- [x] local typecheck, 81 tests, production build, and diff hygiene pass;
- [x] exact-head hosted Node Windows/macOS and hybrid Windows/macOS/Ubuntu pass;
- [x] live CLI timeout gates prove no early mutation at both prompts;
- [x] controlled VS Code still exposes exactly seven read-only Forge tools.

Acceptance evidence is recorded in
[Checkpoint 67](../decisions/checkpoints/2026-08-04-67-approval-cancellation-local-gate.md).
The VS Code gate is deliberately read-only: it proves tether compatibility, not an
IDE mutation or approval surface.

## Increment 5B: Rust-owned execution budgets

[ADR-0027](../decisions/ADRs/ADR-0027-rust-owned-execution-budgets.md)
defines a versioned budget and usage contract in the canonical run. `RunArtifact`
v4 and bridge v6 carry exact admitted call and reported token counters. Rust checks
capability admission before approval/invocation and stops continuation after an
inference response crosses a reported-usage ceiling. Missing usage fails closed.
Context byte exhaustion remains a separate status/event.

The product defaults require no extra setup: six capability calls, 262,144
cumulative reported input tokens, 32,768 cumulative reported output tokens, and the
existing eight-turn default. Optional CLI overrides are explicit. Token ceilings
are documented as post-response continuation controls; transport-level output caps
remain separate.

### 5B exit gate

- [x] RunArtifact v4 and `forge.kernel.bridge.v6` carry the exact budget/usage;
- [x] capability over-limit stops before policy and capability adapters;
- [x] exact token equality completes and crossing usage terminates distinctly;
- [x] missing provider usage fails closed instead of being estimated as zero;
- [x] Rust validates the existing 1–32 turn bound for direct bridge callers;
- [x] TypeScript typecheck, 86/86 tests, build, fmt, and audit pass locally;
- [x] Rust/TypeScript hybrid parity fixtures cover the new terminal paths;
- [x] hosted Rust fmt/clippy/test/build and hybrid parity pass on Windows/macOS/Ubuntu at `3f2774b`;
- [x] live Qwen 7B normal and Qwen 0.5B tiny-budget gates pass against the exact hosted Windows kernel;
- [x] conservative credentialed OpenAI normal gate passes;
- [x] controlled VS Code still exposes exactly seven read-only Forge tools and
      completes the one-call summary regression without a built-in tool.

Local evidence and the missing local MSVC linker are recorded in
[Checkpoint 68](../decisions/checkpoints/2026-08-05-68-execution-budget-local-gate.md).
Hosted and live Qwen evidence is recorded in
[Checkpoint 69](../decisions/checkpoints/2026-08-05-69-execution-budget-hosted-and-live-qwen-gate.md).
Credentialed OpenAI and controlled VS Code acceptance is recorded in
[Checkpoint 70](../decisions/checkpoints/2026-08-05-70-execution-budget-openai-and-vscode-acceptance.md).
All 5B gates are closed. 5C is implemented and remains at its exact-head hosted acceptance gate.

## Increment 5C: policy posture and host callback conformance

Expose a small, explicit product policy selection over the existing fact contract.
Read-only defaults remain convenient; mutation remains ask. Embedded hosts must
prove allow, ask-grant, ask-decline, deny, cancellation, and timeout behavior without
inventing a second approval state machine.

[ADR-0028](../decisions/ADRs/ADR-0028-product-approval-profiles.md) defines three
explicit profiles over the existing fact boundary. `developer` supplies
attributable allow/not-required facts, `review` requests a callback bound to the
exact call and Rust-authored capability context, and `locked` supplies deny facts.
An unresolved review remains `ask` and cannot invoke the capability. Governed
changes keep their separate exact-candidate and promotion approvals.

The CLI exposes the effective profile through a flag/environment setting,
interactive startup/status, `/permissions`, help, and `doctor`. Review prompts are
human-mode only. MCP deliberately has no terminal callback over stdio, so review
without a future host handshake fails closed instead of corrupting transport bytes.

### 5C exit gate

- [x] profile parsing and developer/review/locked fact projections are bounded and
      attributable;
- [x] the review callback receives the exact call plus Rust-authored capability
      context and fails closed on invalid provenance;
- [x] cancellation settles a non-cooperative host callback;
- [x] real-kernel parity covers allow, grant, decline, unresolved ask, deny, and
      cancellation without a second policy evaluator;
- [x] CLI locked denial exits nonzero and `doctor` reports effective authority;
- [x] 91/91 Node tests, typecheck, production build, and the full 54/54 retained-
      kernel hybrid suite pass locally;
- [x] live Qwen 1.5B review grant and decline behavior is recorded;
- [x] controlled VS Code retains exactly seven Forge tools and completes one
      summary call without a built-in tool or mutation;
- [ ] exact-head hosted Node Windows/macOS and hybrid Windows/macOS/Ubuntu pass.

The local/live/VS Code evidence and the Qwen 0.5B continuation gap are recorded in
[Checkpoint 71](../decisions/checkpoints/2026-08-05-71-policy-profile-and-host-callback-local-gate.md).

## Whole-lane exit

- visible allow/ask/deny decisions retain their facts and evidence basis;
- cancellation and deadline behavior settle every provider, policy, prompt,
  capability, verifier, and transaction wait;
- independent turn, capability, and inference-usage budgets are Rust-authoritative;
- CLI and embedded-host fixtures report denial, cancellation, timeout, and
  exhaustion distinctly and recoverably;
- MCP remains read-only until a later high-level mutation gate reuses these exact
  contracts.

## Honest non-goals

- OS sandboxing or stronger containment;
- crash-resumable inference conversations;
- raw shell/file-write MCP tools;
- organization-wide policy distribution;
- learned policy, memory, skills, compression, connectors, or automation.
