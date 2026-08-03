# ADR-0017: Rust product runtime authority and restricted-execution sequencing

- **Status:** accepted and implemented on the feature branch; merge pending
- **Date:** 2026-08-03
- **Owners:** ForgeEngine project
- **Implementation:** `ca9809f` on PR #15
- **Checkpoint:** 2026-08-03-48
- **Refines:** ADR-0008, ADR-0014, and the V1 validated build plan

## Context

Slice 2F-2b is accepted on `develop`, including hosted Windows, macOS, and Ubuntu
conformance plus the controlled VS Code read-only regression. Rust owns the
authoritative run, policy, transaction, and evidence state machines, but the public
CLI and MCP entry points still silently select the TypeScript Slice 0 coordinator
when `FORGE_KERNEL_BINARY` is absent. That makes the product authority conditional
and makes an installation appear healthy when its Rust kernel is unavailable.

The next planned security increment was a minimum native Windows/macOS restricted
provider. A fresh implementation audit found that this is not a small process
wrapper. A credible Windows boundary needs restricted-token/AppContainer-style
identity, workspace access-control provisioning, network enforcement, child-process
ownership, credential handling, resource limits, and cleanup. macOS offers a
different Seatbelt/App Sandbox model with different packaging and child-tooling
constraints. Process groups, Job Objects, environment clearing, or a disposable
worktree alone are not a sandbox.

Forge needs a shareable developer alpha soon. A weak sandbox claim would damage the
software-evidence promise, while leaving the silent dual-runtime behavior in place
would preserve a real core ambiguity.

## Decision

1. Rust is the only product run coordinator. CLI, MCP, and future provider loops
   must use the Rust kernel and fail with an actionable diagnostic when it is not
   available.
2. The TypeScript Slice 0 coordinator is retained only as an explicitly named
   conformance fixture. It is not a production fallback and is not exported as the
   Forge product runtime.
3. Kernel discovery may use an explicit environment/configured path or a verified
   packaged/source-build location. Discovery never changes authority.
4. `restricted` remains fail-closed. Forge will not advertise a control until a
   platform provider and adversarial tests prove it.
5. The native Windows/macOS restricted-provider program is retained as release and
   enterprise-pilot hardening, but it no longer blocks a clearly labeled trusted
   developer alpha or the immediate CLI ship lane.
6. Authenticated `host_managed` remains the enterprise apprentice path when an
   enclosing host supplies the boundary. Its evidence continues to state that
   Forge did not independently enforce containment.

## Consequences

### Positive

- Product behavior matches the documented Rust/TypeScript ownership split.
- Missing machinery is visible during `doctor`, CLI, and MCP startup instead of
  silently selecting different semantics.
- The next inference and live-loop slices build on one event, policy, and artifact
  authority.
- Restricted execution remains an honest, separately measurable platform program.

### Negative

- Source users must build or install a matching Rust kernel before using product
  commands.
- Clean binary packaging is not solved by this increment; it becomes an explicit
  release gate.
- A trusted alpha still runs verification with the developer's OS permissions.
- Native Windows/macOS containment remains substantial work.

## Acceptance

- CLI and MCP resolve and use the Rust kernel without a manual environment variable
  in a normal source checkout.
- CLI and MCP fail before serving product capabilities when no kernel is available.
- `doctor` reports the selected kernel path, discovery source, and honest isolation
  posture.
- TypeScript runtime use requires an explicit conformance-fixture selection.
- Rust/TypeScript parity tests remain green, but product smoke tests exercise Rust.
- Hosted Windows/macOS gates and a controlled VS Code MCP regression pass.

## Acceptance evidence

- Hosted Node run `30839933843` passed Windows and macOS.
- Hosted hybrid run `30839933999` passed Windows, macOS, and Ubuntu and retained
  the exact native artifacts used by each job.
- The hosted Windows artifact passed local `doctor` and product smoke without an
  explicit kernel path.
- VS Code discovered the exact seven Forge tools from the feature worktree and
  completed the bounded one-call workspace-summary regression in three seconds.
- No acceptance result implies Forge-enforced containment: trusted execution still
  inherits the developer process permissions, and `restricted` remains fail-closed.

See [Checkpoint 48](../checkpoints/2026-08-03-48-kernel-convergence-hosted-and-vscode-gate.md).
