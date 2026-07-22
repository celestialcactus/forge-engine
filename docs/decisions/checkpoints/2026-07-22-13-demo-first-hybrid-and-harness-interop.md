# Checkpoint 2026-07-22-13: Demo-first hybrid and harness interoperability

- **Status:** accepted planning checkpoint; hosted SGU-003 validation pending
- **Date:** 2026-07-22
- **Related ADRs:** ADR-0006
- **Scope:** next-month prototype sequencing, apprentice-first enterprise adoption,
  external harness compatibility, and open-source readiness

## Objective

Turn the hybrid runtime decision into a delivery plan that can produce a useful
engineering demonstration without either postponing the Rust authority boundary
or porting fast-moving integrations away from TypeScript.

## Architecture at this checkpoint

```text
VS Code / MCP / central harness / provider SDK / compiler
                         |
        TypeScript tools, workflows, and host adapters
                         |
           versioned capability/evidence protocol
                         |
      Rust policy, execution state, scheduling, and artifacts
```

Enterprise adoption is expected to begin mainly with Forge as an apprentice: an
existing host delegates bounded evidence, local-compute, context, or verification
work to Forge. Standalone and master use the same kernel and remain first-class
product destinations.

## Changes since the previous checkpoint

- Made the permanently hybrid target explicit; there is no planned all-Rust
  rewrite.
- Assigned rapid tool, workflow-definition, provider, MCP, compiler, and IDE work
  to TypeScript while retaining authoritative execution and policy in Rust.
- Corrected the target policy boundary: adapters return consent and host facts;
  Rust produces the final Forge decision.
- Added a one-month coherent-demo sequence and measurable harness comparison.
- Added bidirectional existing-harness compatibility and delegation-loop controls.
- Added a root-license and contribution-governance gate before public promotion.

## Decisions proposed or adopted

| Decision | Status | Rationale | ADR |
| --- | --- | --- | --- |
| Keep Forge permanently hybrid | Accepted | Native authority and high-velocity integrations serve different product needs | ADR-0006 |
| Prioritize apprentice utility for enterprise adoption | Accepted | Existing IDE and central harness users can gain local compute and evidence without replacing their host | ADR-0006 |
| Keep MCP as the default public harness surface | Accepted | It is already validated and avoids proprietary kernel semantics | ADR-0002, ADR-0006 |
| Inspect the organization "agents" harness before designing an adapter | Accepted | Its actual tool, cancellation, approval, and trace contracts are not yet known | Follow-on spike |
| Decide and commit a complete permissive license before public promotion | Accepted gate | Manifest metadata alone is not sufficient licensing for a forkable project | Owner/legal decision pending |

## Validation performed

| Command or experiment | Result | Evidence |
| --- | --- | --- |
| `npm run check:hybrid` with the pinned gnullvm toolchain | Passed | Rust format/lint/build, 8 Rust tests, 37 TypeScript tests, 15 hybrid/MCP tests, and production build |
| Prior controlled VS Code run | Passed locally | Checkpoint 12 and ADR-0006 |
| Architecture reconciliation against product and delivery intent | Passed | Demo/interoperability plan and amended ownership tables |
| Hosted Windows/macOS/Linux SGU-003 matrix | Pending | Requires pushed evaluation branch |

## Failures and surprises

- The manifests declare MIT but the repository has no root `LICENSE` file. The
  project must not claim completed open-source licensing until an explicit license
  decision and complete license text are committed.
- The current spike returns a complete TypeScript `ApprovalDecision`. This remains
  acceptable as differential spike scaffolding but must become consent/fact input
  to a Rust policy result before production cutover.

## Known limitations

- The organization-specific "agents" harness contract has not been inspected.
- Hosted cross-platform validation and native release packaging remain pending.
- The one-child-process-per-run bridge is not the production lifecycle.
- The demo schedule will be reduced in breadth rather than bypassing a failed
  architecture or conformance gate.

## Framework and service inventory

| Dependency/service | Purpose | Why selected | Lock-in/migration risk |
| --- | --- | --- | --- |
| Rust kernel | Authoritative policy, execution, and artifact machinery | Native standalone foundation with tested behavioral parity | Cross-platform build and lifecycle complexity |
| Node.js/TypeScript adapters | Tools, workflows, providers, MCP, VS Code, and compiler integration | Fast iteration and strong host ecosystems | Must remain optional for baseline sovereign operation |
| MCP | Default public apprentice/master tool surface | Open, already validated in VS Code | Host implementations differ in orchestration quality |
| Organization central harness | Candidate enterprise host and tool source | Meets developers in an existing workflow | Contract unknown; no kernel dependency is permitted |

## Repository state

- Branch: `spike/SGU-003-rust-kernel-hybrid-evaluation`
- Baseline spike implementation: `7935cf4`; this checkpoint records the planning
  amendment applied before hosted validation
- Files changed: architecture plan, ADR, checkpoint, and changelog only
- Production behavior available: unchanged; this checkpoint changes delivery and
  ownership decisions, not runtime behavior

## Next checkpoint

Push SGU-003, run the same commit on hosted Windows/macOS/Linux, and close or
redesign the spike based on executable evidence. Before Slice 2B, record the
long-lived-kernel and approval-fact protocol follow-on boundaries.
