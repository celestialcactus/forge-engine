# ADR-0028: Product approval profiles over Rust-owned policy

- **Status:** Implemented; local, live-provider, and controlled VS Code gates pass; hosted acceptance pending
- **Date:** 2026-08-05
- **Scope:** CLI ship lane increment 5C, standalone CLI, embedded service, MCP posture

## Context

Forge already sends attributable host-policy and user-consent facts to the Rust
kernel. Rust validates those facts and records the only final `allow`, `ask`, or
`deny` decision. The product still had fixed read-only allow behavior, however,
and embedded hosts had no small public contract for collecting a human decision.

Adding a TypeScript policy evaluator would create a second authority. Reusing the
governed ChangeSet approval prompt for every capability would instead conflate
entry permission with approval of an exact candidate and its promotion.

## Decision

1. Expose exactly three product profiles: `developer`, `review`, and `locked`.
2. TypeScript translates a selected profile into versioned, attributable
   `ApprovalFacts`; it never returns a final Forge approval decision.
3. `developer` supplies host `allow` and `notRequired` user consent for registered
   capabilities. Governed mutation still requires its separate exact-candidate and
   promotion approvals.
4. `review` supplies host `ask` and invokes an optional host consent callback with
   the exact capability call and Rust-authored `CapabilityContext`. A grant or
   decline must include a bounded source and reason.
5. If `review` has no callback, user consent is `unavailable`. Rust therefore
   retains an unresolved `ask` and the capability is not invoked.
6. `locked` supplies host `deny` for every model-requested registered capability;
   user consent cannot override it.
7. The service-level configuration is shared by standalone, embedded, and MCP
   adapters. A per-run override may narrow or change the product posture without
   creating another runtime.
8. Cancellation races the host callback even if the callback does not cooperate.
9. Interactive CLI review uses a visible prompt. `--json` cannot be combined with
   review because human prompt bytes would corrupt terminal JSON.
10. MCP review has no terminal callback over stdio. Until a host approval handshake
    exists, that combination remains unresolved and fail-closed.

## Why this is not a parallel policy runtime

The profile layer selects and collects facts. Rust still validates identity and
provenance, applies precedence, resolves `ask`, emits `approval.decided`, gates
capability invocation, and owns terminal run state. The only TypeScript mapping to
a final decision remains the explicitly named conformance oracle used to compare
traces in tests; product execution does not use it.

## Guarantees

- a host callback sees the exact call and Rust-authored evidence basis;
- unattributed callback results fail closed;
- `locked` cannot invoke a capability;
- unresolved `review` cannot invoke a capability;
- a non-cooperative callback cannot keep a cancelled Rust run alive;
- CLI, embedded service, and MCP construct facts through the same product module;
- explicit evidence commands return a nonzero process status when Rust does not
  complete the run or the requested outcome is unmet.

## Non-guarantees

- This is not OS containment or an organization policy distribution system.
- `developer` is a convenience posture, not a claim that capabilities are safe.
- MCP does not yet provide an interactive approval handshake.
- Approval does not make model output correct; outcome evidence remains separate.
- Outer runs and conversations are not yet crash-resumable.

## Rejected alternatives

- **Implement allow/ask/deny in TypeScript.** That creates a second policy
  authority and lets host behavior diverge from recorded Rust state.
- **Make review the default immediately.** The current CLI lacks persisted policy
  setup and MCP cannot prompt safely over stdio; this would make the alpha appear
  broken rather than controlled.
- **Treat missing review callbacks as deny.** Rust's existing `ask` state precisely
  records that consent was required but unavailable.
- **Reuse exact ChangeSet approval as the capability-entry prompt.** The two
  decisions bind different subjects and must remain independently attributable.
- **Permit review prompts in JSON mode.** Mixed prompt and artifact bytes are not a
  valid machine-readable contract.

## Acceptance gates

- unit tests for parsing, every profile, provenance validation, exact-context
  callbacks, cancellation, and timeout;
- real Rust-kernel parity for developer allow, review grant/decline/unresolved,
  locked deny, and callback cancellation;
- CLI doctor and locked-denial/nonzero product smoke;
- live tiny-model review grant and decline flows;
- full TypeScript check and production build;
- hosted Node Windows/macOS and hybrid Windows/macOS/Ubuntu;
- controlled VS Code regression with exactly seven Forge tools and one read-only
  summary call.

## Deferred

Host-interactive MCP approval, centrally distributed policy, credential brokerage,
OS sandbox integration, durable outer-run recovery, and generalized permission
rules are separate gated work. They must reuse this fact/decision boundary.
