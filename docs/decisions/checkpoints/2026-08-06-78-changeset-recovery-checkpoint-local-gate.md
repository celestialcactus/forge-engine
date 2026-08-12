# Checkpoint 78: pending ChangeSet recovery cross-link local gate

**Date:** 2026-08-06
**Branch:** `feature/cli-safe-continuation`
**Decision:** accept the bridge-v10 outer-run-to-ChangeSet cross-link locally and in controlled VS Code; retain hosted Windows/macOS/Ubuntu acceptance

## Objective

Close the remaining discoverability gap between an interrupted outer
`workspace.change` capability and the durable Rust ChangeSet transaction that
already owns the candidate workspace. The fix must preserve one outer runtime,
must not copy the ChangeSet state machine into the run ledger, and must never make a
non-idempotent mutation replayable.

## Implemented contract

- The private bridge advances to `forge.kernel.bridge.v10`.
- The canonical capability contract exposes one typed
  `change_set_transaction` recovery checkpoint containing digest-shaped
  ChangeSet and transaction identities plus the registered phase.
- The interactive change workflow emits that checkpoint only after the separate
  Rust ChangeSet service returns a validated registered transaction and before the
  promotion/retain/discard decision is requested.
- The TypeScript bridge forwards the checkpoint for the currently active call and
  waits for Rust's durable acknowledgement.
- Rust accepts exactly one checkpoint for the pending non-idempotent capability,
  appends and synchronizes it in the interaction transcript, and replies with
  `capability.progress.recorded`. Wrong-call, malformed, duplicate, or
  misclassified input is rejected.
- Continuation schema 2 projects `pendingRecoveryCheckpoint` during inspection.
  Schema 1 records remain inspectable and cannot contain checkpoint evidence.
- Resume behavior does not change: the outer capability remains non-idempotent and
  is never replayed. Operators follow the retained identities to the authoritative
  ChangeSet journal for inspection or explicit recovery.
- The bridge supervisor permits one bounded in-flight capability task so its stdout
  loop can receive the acknowledgement while the capability awaits it. Planner and
  approval callbacks remain sequential, and a premature kernel exit rejects the
  waiter instead of hanging.

## Exact validation

The final `npm run check:hybrid` passed in **107.6 seconds**:

- Rust formatting and full-workspace clippy passed with warnings denied;
- the full Rust workspace passed, including the `forge-core` suite with **72
  passed / 5 helper tests ignored**, all integration suites, and `forge-kernel`
  **8/8**;
- TypeScript typecheck, **93/93 Node tests**, and production build passed;
- the hybrid suite reported **62 total: 56 passed, 6 explicitly skipped** because
  those scenarios require a separately supplied `FORGE_KERNEL_BINARY`.

Focused evidence also proves:

- a checkpoint survives a raw child-process crash and inspection exposes the exact
  ChangeSet and transaction identities;
- resuming that pending run invokes the outer capability zero times;
- a wrong call ID is rejected and is not persisted;
- invalid or incorrectly classified checkpoints fail closed;
- the interactive workflow waits for durable acknowledgement between the initial
  apply decision and the later promotion/retain/discard decision;
- the TypeScript bridge receives the acknowledgement without deadlock.

Packaged CLI smoke passed with a disposable `FORGE_ENGINE_ROOT`. `doctor`
reported the Rust kernel ready on `forge.kernel.bridge.v10` and retained the honest
no-sandbox posture. A real-workspace inspection produced verified completed run
`run:bce9db25-aad1-4309-8306-7ff6661bed26`, snapshot
`workspace:f4e94b0c6194d268`, with 359 files and bounded truncation.

After rebuilding and explicitly restarting the workspace MCP server, VS Code
reported the server running with seven Forge tools discovered. A fresh controlled
chat made exactly one `Forge Workspace Summary` call and completed in **5
seconds**: run `run:b3ca2e53-4ac1-4430-8e3c-a79651af807c`, snapshot
`workspace:f4e94b0c6194d268`, 359 files, truncated true,
`outcome.status=verified`, `runStatus=completed`, and the seven canonical ordered
events. It used no built-in tool and made no repository change.

## Complications found and corrected

1. Awaiting a durability acknowledgement inside the capability while the original
   bridge loop also waited synchronously for that capability would deadlock. The
   bounded supervisor now keeps reading kernel output while exactly one capability
   task is active; this is not a general concurrent runtime.
2. The full gate caught an older hybrid fixture that used friendly placeholder
   transaction IDs. The new strict recovery boundary correctly rejected them, so
   the test now uses deterministic digest-shaped identities matching production.
3. A test-only PowerShell replacement interpolated TypeScript template markers in
   two fixture constants. The corruption was detected immediately, corrected with
   literal assertion-guarded replacements, and never affected product source.
4. Restricted Windows validation initially hit toolchain permissions and one
   `dist` cleanup `EPERM`. Escalated reruns with the pinned gnullvm/`rust-lld`
   environment passed; these were environment failures rather than product
   retries.

## Honest limits

1. Hosted Windows/macOS/Ubuntu has not run against this exact bridge-v10 head.
2. The checkpoint is a durable, call-bound reference, not a second transaction
   journal. The outer kernel validates identity shape, active-call binding, phase,
   and transcript ordering; it does not reopen the ChangeSet journal while
   appending the checkpoint.
3. The reference is forwarded by the trusted TypeScript integration only after it
   validates the separately returned Rust ChangeSet artifact. A compromised host
   remains outside this local process trust claim.
4. A crash before ChangeSet registration is acknowledged has no transaction
   identity to expose. The pending outer non-idempotent capability still blocks
   safely, but recovery may require bounded orphan discovery/doctor support.
5. Registered-but-never-finalized ChangeSet transactions need age-bounded
   reporting and explicit operator cleanup policy. Automatic recovery or deletion
   was not added.
6. This remains process-crash recovery at the tested synchronization boundary, not
   a general power-loss, distributed, or cross-device guarantee.
7. Forge still has no OS-enforced sandbox. The baseline child inherits the Forge
   process environment and permissions, and host-managed isolation remains an
   attributable assertion rather than independently verified containment.

## Next gate

Run the exact bridge-v10 head through hosted Node Windows/macOS and hybrid
Windows/macOS/Ubuntu. Then add bounded `doctor` reporting and explicit cleanup
policy for abandoned staging and registered-but-never-finalized ChangeSet
transactions before clean native packaging and the developer alpha test kit.