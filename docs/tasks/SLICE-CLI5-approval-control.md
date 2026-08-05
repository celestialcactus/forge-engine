# CLI ship lane 5: approval and control

**Status:** active; 5A accepted, 5B implemented locally with hosted/live gates pending, 5C open
**Branch:** `feature/cli-execution-budgets`
**Base:** merged `develop` at `2a5fe3e` (PR #21)

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
3. Read-only product policy is fixed allow and governed entry policy is fixed allow;
   user-selectable policy posture and embedded-host ask callbacks need a separate
   product contract.
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
- [ ] hosted Rust fmt/clippy/test/build and hybrid parity pass on Windows/macOS/Ubuntu;
- [ ] live Qwen normal and tiny-budget gates pass;
- [ ] conservative credentialed OpenAI normal gate passes;
- [ ] controlled VS Code still exposes exactly seven read-only Forge tools.

Local evidence and the missing local MSVC linker are recorded in
[Checkpoint 68](../decisions/checkpoints/2026-08-05-68-execution-budget-local-gate.md).
5B is not accepted until the unchecked gates close.

## Increment 5C: policy posture and host callback conformance

Expose a small, explicit product policy selection over the existing fact contract.
Read-only defaults remain convenient; mutation remains ask. Embedded hosts must
prove allow, ask-grant, ask-decline, deny, cancellation, and timeout behavior without
inventing a second approval state machine.

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
