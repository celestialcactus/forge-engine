# ADR-0031: Transaction retention and native sandbox sequencing

- **Status:** Transaction local gate accepted; native backends and hosted acceptance open
- **Date:** 2026-08-10
- **Scope:** CLI ship-lane release hardening, ChangeSet v2 retention, Tier-1 restricted execution

## Context

The ChangeSet v2 coordinator recovers interrupted promotion and retains a prepared
candidate until an exact accept or discard decision. Its startup path also removed
every `.transaction-*.tmp` directory before acquiring the repository lock. A second
Forge process could therefore delete staging that another process was actively
publishing. Registered-but-never-finalized transactions also had no bounded inventory
or review policy.

Forge separately owns verifier process lifecycle on Windows and macOS, but it does
not own a permission boundary. Windows Job Objects group, limit, and terminate
processes; Microsoft documents AppContainer as the boundary for filesystem, network,
credential, and process isolation. Apple's supported App Sandbox path requires an
entitled, code-signed app/helper relationship. A worktree, cleared environment,
process group, Job Object, or authenticated host assertion is not that boundary.

## Decision

1. Unpublished transaction staging is cleaned only while holding the same
   non-blocking repository lock used for publication. Cleanup accepts only the exact
   Forge staging grammar and fails closed on lookalikes or non-directory paths.
2. A published `prepared` transaction is never deleted or discarded because it is
   old. After 24 hours it becomes `reviewDue`; the only destructive cleanup remains
   an exact, approved `discard <transaction-id>` operation. Terminal journals remain
   durable evidence.
3. Rust exposes a bounded read-only transaction audit. It scans at most 4,096 state
   entries, returns at most 256 transactions, prioritizes repair-required and old
   prepared work, reports truncation, and records how many unpublished orphan staging
   directories the current coordinator removed.
4. The TypeScript CLI adds only `forge change audit`; it projects the Rust artifact
   and does not implement retention, recovery, or deletion semantics. The private
   sovereign change protocol advances to `forge.kernel.changeset.v4`.
5. Kernel probe and `forge doctor` report the capabilities of the isolation provider
   actually selected by Rust. `restrictedReady` is true only when that provider
   advertises the restricted profile and all five controls: filesystem, process,
   network, credentials, and resources. The baseline provider must report trusted
   only, no controls, and `restrictedReady=false`. Because this adds required probe
   output, the kernel probe protocol advances to `forge.kernel.probe.v2`.
6. Windows restricted execution will use an AppContainer-derived boundary with
   explicit workspace access, network default-deny, reduced credential access, and
   existing Job Object lifecycle/resource ownership. Microsoft's new composable
   sandbox process API is not a V1 dependency while it remains experimental and its
   public header is unavailable.
7. macOS restricted execution will use Apple's supported signed App Sandbox helper
   model with explicit entitlements. Forge will not build a durable product claim on
   deprecated or private `sandbox-exec`/Seatbelt behavior.
8. Windows and macOS providers are separate acceptance increments behind the same
   `IsolationProvider` contract. Unsupported platforms and controls continue to fail
   before launch. Neither provider is considered complete from compilation or
   configuration alone; adversarial filesystem, network, credential, descendant,
   resource, cancellation, and cleanup tests must pass on the native OS.

## Why the sandbox is not implemented as one cross-platform wrapper

The operating systems expose different authority models. AppContainer identity and
Windows ACL/capability grants do not map to macOS code-signing entitlements, and a
container runtime is neither installed by default nor equivalent to native developer
tool execution. Hiding those differences behind an unproven command wrapper would
produce a portable API with non-portable security claims.

## Consequences

- Concurrent coordinator startup fails closed instead of deleting in-flight staging.
- Operators can find retained and repair-required transactions without filesystem
  archaeology; Forge still cannot silently decide whether an old candidate is wanted.
- Doctor output becomes executable evidence of the current sandbox gap rather than a
  hard-coded product promise.
- The trusted alpha remains usable while native containment proceeds, but it must not
  be marketed as restricted or enterprise-contained.
- Release packaging must eventually include the Windows identity/profile lifecycle
  and the signed macOS helper; those are product machinery, not deployment notes.

## Rejected alternatives

- **Age-delete prepared transactions:** destroys verified developer work without an
  exact decision and breaks the recovery authority.
- **Treat Job Objects/process groups as sandboxes:** they establish lifecycle and some
  resource control, not filesystem/network/credential containment.
- **Trust host-managed evidence as Forge enforcement:** signed attribution proves who
  asserted a boundary, not whether the OS applied it.
- **Adopt the experimental Windows composable sandbox API immediately:** its documented
  minimum is Windows 11, the API is explicitly subject to change, and the header is not
  public; that is not an adequate Tier-1 compatibility contract yet.
- **Use `sandbox-exec` on macOS:** it is not Apple's supported durable product path for
  a new signed CLI/helper architecture.

## Acceptance gates

### Transaction retention

- concurrent startup cannot remove staging owned under the publication lock;
- exact orphan staging is removed after lock release and reported;
- malformed lookalikes are preserved and fail closed;
- old prepared transactions are reported as review-due and remain inspectable;
- the CLI audit is bounded, read-only, and round-trips through the Rust protocol;
- Windows/macOS/Ubuntu hosted transaction gates pass.

### Restricted execution

- doctor derives readiness from the selected Rust provider and reports the baseline
  as unavailable;
- each native provider proves every advertised control independently and in
  combination on its OS;
- failure to establish any requested control prevents child launch;
- no secret-bearing environment or credential channel is inherited unless policy
  explicitly grants it;
- cancellation and owner death leave no process or permission/profile residue;
- trusted and host-managed behavior remains explicit and unchanged.

## Primary platform references

- [Microsoft: AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)
- [Microsoft: Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)
- [Microsoft: Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Microsoft: experimental Create Process in Sandbox APIs](https://learn.microsoft.com/en-us/windows/win32/secauthz/createprocessinsandbox)
- [Apple: App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)
- [Apple: Embedding a command-line tool in a sandboxed app](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app)
