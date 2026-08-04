# CLI ship lane 5: approval and control

**Status:** active; increment 5A accepted at `ae746ff`, increments 5B and 5C open
**Branch:** `feature/cli-approval-control`
**Base:** merged `develop` at `2ff5669` (PR #20)

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

Add a versioned control contract rather than more CLI-only flags. Rust must own an
independent capability-call budget and bounded reported inference usage. Exhaustion
must have a deterministic terminal status/event, exact counters, and Rust/TypeScript
parity. Context byte exhaustion remains distinct from execution-control exhaustion.

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
