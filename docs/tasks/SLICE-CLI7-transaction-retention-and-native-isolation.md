# CLI ship lane 7: transaction retention and native isolation

## Objective

Close the transaction-orphan policy gap now and turn OS containment into two
testable Tier-1 provider increments. This task must improve the trusted alpha without
claiming a sandbox before Windows and macOS enforcement tests pass.

Authority: [ADR-0031](../decisions/ADRs/ADR-0031-transaction-retention-and-native-sandbox-sequencing.md).

## Increment 7A: bounded transaction retention

- move unpublished staging cleanup under the repository publication lock;
- validate the exact staging grammar and bound state-root scans;
- retain all published prepared transactions until exact accept/discard;
- mark prepared work review-due after 24 hours without mutating it;
- add the Rust-owned bounded audit artifact and `forge change audit` projection;
- advance the private sovereign change protocol to v4;
- validate local, packaged CLI, hosted Windows/macOS/Ubuntu, and controlled VS Code.

### 7A exit gate

- [x] cleanup and audit policy are specified in ADR-0031;
- [x] concurrent startup, lookalike, orphan cleanup, and old-prepared regressions exist;
- [x] focused local coordinator tests pass;
- [x] full Rust/Node/hybrid and source-built CLI smoke gates pass;
- [ ] clean-install package includes and discovers the correct native kernel/watchdog;
- [ ] hosted Windows/macOS/Ubuntu gates pass;
- [ ] controlled VS Code read-only regression passes.

## Increment 7B-Windows: AppContainer restricted provider

- stable AppContainer profile/SID lifecycle;
- explicit candidate/workspace read-write grant and minimum executable/dependency
  read grants;
- network default-deny with named capability opt-in;
- credential/registry default-deny evidence;
- suspended launch, Job Object descendant/resource ownership, cancellation, and
  bounded output reuse;
- profile/ACL cleanup that is idempotent and auditable.

### Windows exit gate

- [ ] denied reads/writes outside grants fail from the child;
- [ ] allowed workspace operations succeed;
- [ ] network and credential probes match policy;
- [ ] descendant escape, timeout, cancellation, owner death, and resource ceilings
      leave no survivor;
- [ ] a missing or partial boundary fails before verifier code executes;
- [ ] packaged Windows install and `doctor` report the exact provider/controls.

## Increment 7B-macOS: signed App Sandbox helper

- signed helper packaging with App Sandbox and inheritance entitlements;
- explicit file access grants suitable for the disposable candidate workflow;
- network default-deny with entitlement-controlled opt-in;
- environment/credential minimization and resource/process supervision;
- cancellation and helper cleanup integrated with the existing watchdog contract.

### macOS exit gate

- [ ] `codesign` and OS process evidence prove the sandbox is active;
- [ ] denied/allowed filesystem and network probes match policy;
- [ ] child/grandchild, cancellation, timeout, and owner-death cases leave no survivor;
- [ ] unsigned, wrongly entitled, or missing helpers fail before verifier execution;
- [ ] packaged Intel/Apple-silicon gates report the exact provider/controls.

## Deferred from this task

- Linux namespace/seccomp/cgroup backend;
- organization policy distribution and credential brokers;
- high-level MCP mutation;
- generic shell or unrestricted write capabilities;
- treating containers or host attestations as native Forge enforcement.
