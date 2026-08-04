# CLI ship lane 4: developer capability pack

**Status:** active; increments 4A and 4B-1 accepted; 4B-2 local implementation awaiting hosted/product acceptance
**Branch:** `feature/cli-edit-verification-composition`
**Base:** merged outcome-contract `develop` at `742b8c8` (PR #18)

## Objective

Expose a useful developer change workflow over the accepted Rust kernel without
adding raw write or shell powers, a parallel runtime, or a model-defined meaning of
success.

The representative alpha flow is:

```text
developer objective
  -> bounded workspace evidence
  -> digest-bound change proposal
  -> visible allow / ask / deny decision
  -> isolated apply to a candidate boundary
  -> bounded verifier process
  -> Rust-authored outcome assessment
  -> reviewable accept or discard
  -> one attributable RunArtifact
```

## Increment 4A: outcome authority

See [ADR-0022](../decisions/ADRs/ADR-0022-rust-authoritative-outcome-contract.md).

Implemented:

- RunArtifact v2 and `forge.kernel.bridge.v4`;
- separate lifecycle and outcome states;
- bounded caller-supplied outcome contracts validated and evaluated by Rust;
- explicit `outcome.assessed` event before `run.completed`;
- `not_evaluated` when no contract exists and `unmet` for failed requirements;
- call-ID correlation before capability success can satisfy a requirement;
- full contract retention in authoritative artifacts and compact assessment-only
  MCP projection;
- human CLI, interactive status, JSON artifact, and MCP outcome visibility;
- nonzero one-shot CLI exit for an unmet contract;
- Rust/TypeScript parity cases for verified, unmet, invalid, absent, and mismatched
  result states.

### 4A exit gate

- [x] TypeScript typecheck, 63 tests, and production build pass locally.
- [x] Rust formatting, all-target GNU compile, and strict clippy pass locally.
- [x] Native Rust tests and Rust/TypeScript hybrid parity pass on hosted Windows,
      macOS, and Ubuntu.
- [x] Exact hosted Windows kernel passes product smoke and a controlled VS Code MCP
      call exposing `verified` plus the seven-event order.
- [x] Exact accepted implementation and validation evidence are committed in
      `be2069a` and recorded in
      [Checkpoint 60](../decisions/checkpoints/2026-08-04-60-outcome-contract-accepted.md).

## Increment 4B: bounded edit and verification composition

Reuse accepted machinery instead of adding generic powers:

1. map a provider proposal into the existing content-addressed ChangeSet v2
   transaction contract;
2. require visible developer approval before mutation;
3. apply only inside the accepted candidate/worktree boundary;
4. invoke the existing bounded verification runner with explicit checks, timeout,
   cancellation, and output limits;
5. construct an outcome contract from the requested change and verifier plan;
6. present diff, verification evidence, outcome, and accept/discard choices through
   the CLI;
7. keep MCP mutation disabled until the local CLI flow is accepted.

### Increment 4B-1: prepared identity and approval binding

[ADR-0023](../decisions/ADRs/ADR-0023-prepared-changeset-approval-binding.md)
requires Rust to prepare the exact ChangeSet before consent, bind approval to that
identity and the selected verifier set, reject a changed identity before candidate
mutation, and retain the approved call, attributable facts, final decision, outcome
contract, and assessment. Protocol v3 and artifact schema 2 implement that bounded
primitive. [Checkpoint 61](../decisions/checkpoints/2026-08-04-61-prepared-changeset-local-gate.md)
records the local gate. [Checkpoint 62](../decisions/checkpoints/2026-08-04-62-prepared-changeset-accepted.md)
records exact-head hosted Windows/macOS/Ubuntu, 41/41 exact Windows-kernel hybrid,
and product-smoke acceptance.

This is machinery, not the finished developer UX. The following increment must
compose the existing TypeScript digest-bound plan/diff, a visible interactive
approval callback, Rust candidate verification, and explicit accept/discard without
adding a second runtime or an MCP mutation tool.

### Increment 4B-2: interactive edit composition

[ADR-0024](../decisions/ADRs/ADR-0024-model-plan-and-rust-change-composition.md)
keeps the model on a CLI-only, non-mutating `{path, content}` adapter while Forge
owns complete-read coverage, digest/diff bounds, and exact TypeScript/Rust identity
comparison. The first prompt authorizes only the prepared ChangeSet plus verifier
IDs; Rust owns candidate execution and outcome; a second prompt accepts, discards,
or retains the verified transaction. Policy parsing is strict and trusted-only, and
MCP remains seven read-only tools.

[Checkpoint 63](../decisions/checkpoints/2026-08-04-63-interactive-edit-local-gate.md)
records the local implementation, Qwen 0.5B/1.5B/3B failure modes, the 7B one-read/
one-plan result, and the Rust prepared-operation projection defect caught before
candidate creation. Hosted native/product acceptance and exact-kernel CLI/VS Code
tests remain open. The planning RunArtifact and Rust transaction artifact are not
yet one durable aggregate lifecycle record.

### 4B exit gate

- one representative TypeScript change is proposed from a digest-bound base;
- denial and cancellation make no source change;
- an approved candidate is changed without mutating the source workspace early;
- failing verification cannot be presented as accepted;
- passing verification produces a Rust-authoritative `verified` assessment whose
  exact requirements are retained in the artifact;
- accept/discard is explicit, restart-safe under the already accepted transaction
  coordinator, and attributable;
- Windows and macOS product gates pass with the same contract and no platform shell
  assumptions;
- controlled VS Code can inspect the final evidence through the existing seven
  read-only Forge tools without receiving a raw mutation tool.

## Explicit non-goals for this lane

- arbitrary shell execution;
- arbitrary file-write MCP tools;
- model-authored policy or self-certification;
- automatic semantic scoring of free-form answers;
- durable cross-prompt memory or restart resume for inference conversations;
- native OS sandbox claims beyond the already documented trusted/restricted
  execution profiles;
- skills, compression, connectors, automation, or multi-agent scheduling.

## Honest limitations

- Free-form provider runs remain `not_evaluated` until their workflow supplies an
  explicit deterministic contract.
- `capability_succeeded` proves the named adapter reported success for the exact
  call; it does not independently prove semantic correctness of its content.
- `output_non_empty` proves only that non-whitespace output exists.
- Local Windows cannot currently link a new Rust binary because the installed GNU
  toolchain lacks `dlltool` and MSVC `link.exe` is absent. The exact hosted Windows
  kernel nevertheless passed 39/39 hybrid tests and product smoke locally. Hosted
  CI remains the native cross-platform build authority.
- No new OS sandbox is introduced by 4A. Restricted execution remains fail-closed
  unless an accepted provider proves containment.
