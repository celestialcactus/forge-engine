# Checkpoint 71: product approval profile and host callback local gate

**Date:** 2026-08-05
**Branch:** `feature/cli-policy-profiles`
**Base:** merged `develop` at `74308ca` (PR #22)
**State:** implementation, local, live-provider, and controlled VS Code gates pass; hosted acceptance pending

## Decision

Increment 5C is implemented without adding another policy engine. TypeScript now
selects one of three product postures and collects attributable consent facts;
Rust remains the only component that resolves and records the final approval and
gates invocation. The implementation is ready for exact-head hosted validation,
but is not marked accepted until Windows/macOS Node and Windows/macOS/Ubuntu hybrid
checks pass.

## Implemented boundary

- `developer`: registered capabilities receive attributable allow/not-required
  facts; governed changes retain exact candidate and promotion decisions.
- `review`: every model-requested capability carries ask facts and an optional
  callback bound to the exact call and Rust-authored context.
- `locked`: every model-requested capability carries deny facts.
- missing review callback: consent is unavailable, Rust records `ask`, and no
  capability is invoked.
- cancellation: Forge races a non-cooperative host callback and terminates through
  the canonical Rust cancellation path.
- CLI: flag/environment selection, visible review prompt, `/permissions`, status,
  help, and `doctor` effective posture.
- MCP: shares the profile layer, but deliberately does not print terminal prompts
  over stdio. Review without a host callback is fail-closed.
- product evidence commands now exit nonzero for a non-completed run or unmet
  outcome; this corrected a real locked-profile smoke that previously emitted the
  correct denial artifact with process exit zero.

The prior fixed product policy mappings were removed from the workspace service.
The remaining TypeScript final-decision mapper is explicitly test-only and exists
solely as the conformance oracle for Rust trace comparison.

## Local and exact-kernel validation

- TypeScript typecheck passed.
- Full Node suite passed: 91/91.
- Production build passed.
- Exact retained hosted Windows kernel:
  `C:\tmp\forge-engine-artifacts\3f2774b\forge-kernel.exe`.
- Kernel SHA-256:
  `506B0C7ACC1EB37CC40157E087E08272DB04AF3538F2B5512D9622AAA4D4FAD8`.
- Focused real-kernel profile parity passed: 38/38, including developer allow,
  review grant, review decline, unresolved review ask/no-invoke, locked
  deny/no-invoke, and cancellation of a non-cooperative callback.
- Focused hybrid MCP/CLI product smoke passed: 2/2, including locked denial with
  nonzero exit and effective doctor output.
- After the final callback-shape hardening, the complete retained-kernel hybrid
  suite passed: 54/54 in 22 seconds.

## Live Qwen evidence

Qwen 1.5B review grant passed with exactly one visible prompt, one Rust allow, one
bounded read, the correct `# Slice 1 fixture` evidence, and completed run
`run:8b7dd242-fa97-4a26-a415-889d0647d18d`.

Qwen 1.5B review decline produced a Rust deny and no successful capability for
run `run:2c87c54a-2397-4501-a570-7a18de4ce42b`. The model retried the denied tool;
the independent Rust capability budget stopped the retry and the process returned
nonzero with `execution_budget_exhausted`. This is safe behavior, not a successful
task outcome.

Qwen 0.5B reached the capability, received approval, and completed one read, but
its continuation changed the streamed tool-call name. Forge rejected the malformed
continuation rather than weakening protocol identity. Run:
`run:4c6d8aea-a078-4c7a-850d-8eb9882a31e8`. Small-model continuation recovery is
therefore an open capability gap; 0.5B is not claimed as generally usable for
tool-driven tasks.

## Controlled VS Code gate

The trusted `C:\tmp\forge-engine-cli-execution-budgets` workspace rebuilt and
restarted its workspace MCP server. Configure Tools showed exactly seven selected
Forge tools. A fresh Agent chat requested exactly one `Forge Workspace Summary`
call with `maxFiles: 20` and prohibited built-in tools or mutation.

Observed result:

- exactly one Forge call, no retry, built-in tool, or mutation;
- elapsed host time: four seconds;
- run: `run:3a5bc81a-7f2a-49cc-b63f-9c2a7a13e0a5`;
- snapshot: `workspace:ca011338e3106f87`;
- `totalFiles=345`, `truncated=true`;
- `outcome.status=verified`, `runStatus=completed`;
- ordered events: `run.started`, `context.planned`, `capability.requested`,
  `approval.decided`, `capability.completed`, `outcome.assessed`,
  `run.completed`.

This proves the default developer posture did not regress the existing read-only
MCP tether. It does not prove an MCP review UI; that handshake remains deferred.

## Remaining gate and next core work

5C still requires exact-head hosted Node Windows/macOS and real-kernel hybrid
Windows/macOS/Ubuntu results before acceptance. After that, the next core gate is
minimum outer-run recovery: append canonical events/artifacts and resume without
replaying completed non-idempotent work. Native packaging, root licensing, and the
developer alpha kit remain necessary for an externally shareable alpha. OS
containment remains honestly absent from the trusted-alpha scope.
