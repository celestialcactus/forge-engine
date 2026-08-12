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

- [x] local preview child denies outside/protected writes and permits the bounded
      candidate write fixture;
- [x] explicit environment, requested working directory, direct loopback deny,
      timeout, and cancellation probes pass locally;
- [ ] general workspace/toolchain operations succeed without mutating external
      executable or active-repository ACLs;
- [ ] credential probes cover Windows channels beyond inherited environment;
- [ ] descendant escape, timeout, cancellation, owner death, and resource ceilings
      leave no survivor (timeout/cancellation pass; separate-process owner death and
      explicit ceiling probes remain);
- [ ] a missing or partial boundary fails before verifier code executes;
- [ ] packaged Windows install and `doctor` report the exact provider/controls.

### 2026-08-11 preview checkpoint and debt

The disposable AppContainer/Job/ACL prototype passes nine local conformance tests,
including crash-recovery simulation, but remains `setup_required` and unavailable to
production transactions. Its candidate root grant is deliberately non-inheriting;
only existing non-protected top-level entries receive recursive grants. This avoids
moving protected metadata, restoring whole DACLs, or changing tool executable ACLs.

Before promotion, implement a policy-owned toolchain/helper projection, define
durable new-root-path behavior, expand credential probes, run forced owner-death and
resource-limit fixtures, and pass packaged/hosted Windows plus `doctor` gates. ADR-0033
tracks the full priority-ordered debt list and preserves the managed Windows provider
as an architectural improvement path rather than letting this preview become an
accidental permanent design.

The exact local head passes the full strict Rust/Node/hybrid gate, RustSec audit, and
staged Windows x64 package smoke. This validates regression safety and packaging; it
does not promote the conformance-only AppContainer launcher or satisfy the hosted/
VS Code restricted-provider gates.

### 2026-08-12 commodity-provider conformance spike

- [x] temporary provider-neutral harness added; it accepts exact Rust plan case
      records and covers filesystem, sensitive reads, network, credentials,
      descendants, termination, residue, and Node/npm, Git, Cargo/Rust, and shell
      compatibility case IDs;
- [x] after explicit approval, SRT `0.0.71` setup provisioned the local test
      account/WFP state; the adapter uses published status, initialization,
      wrapping/CLI environment, and reset surfaces;
- [x] dependency/license/transitive/platform surface and setup instructions audited;
- [x] the schema-v4 Rust corpus executed 17/17 cases with clean ACL, recovery,
      process, descendant, and pre/post provider-state evidence;
- [x] native baselines pass: AppContainer 9/9, Windows Job lifecycle 3/3,
      isolation authority 11/11, full Rust workspace 174 passed/0 failed, and exact
      hybrid product gate 63/63;
- [x] the temporary SRT dependency was removed from Forge's root application
      manifest/lock; the disposable lab installs an exact separately locked
      evaluation payload offline with scripts disabled;
- [ ] production promotion remains open: the published SRT surface cannot express
      Forge resource ceilings, AppContainer has not consumed the same toolchain
      corpus, and VM/hosted/package/uninstall gates remain.

The bounded result is `adapt`: retain the provider-neutral Rust contract and compose
the dedicated-identity/WFP/broker machinery under Rust and Forge's Job/resource
authority in a later implementation slice. No provider status changed. See
[Checkpoint 82](../decisions/checkpoints/2026-08-12-82-commodity-sandbox-conformance-completion.md).

### 2026-08-12 Rust-owned managed Windows adapter slice

- [x] the managed Windows, AppContainer, and shared conformance paths are documented
      as evaluation modules: they independently reproduce useful architecture and
      obvious composition patterns for Forge, use published APIs/platform contracts,
      and contain no verbatim external implementation source;
- [x] Rust consumes and validates the full five-control schema-v4 plan, launches
      provider-prepared machinery inside Forge's process-count/memory-limited Job,
      and owns timeout, cancellation, descendants, cleanup, and evidence;
- [x] the temporary adapter uses published `0.0.71` initialize/wrap/reset APIs and
      rejects another provider, incomplete restrictions, inherited environment,
      plan/process mismatch, package escape, or malformed prepared state;
- [x] a fresh exact corpus passed 17/17 on managed Windows and 17/17 on
      AppContainer, including toolchains, separate owner death, and clean ACL,
      process, recovery, descendant, and marker evidence;
- [x] kernel probe v4 and `forge doctor` report the selected baseline separately
      from both Windows candidates, with both candidates still `setup_required`
      and `restrictedReady=false`; doctor executes no adapter code;
- [x] the root application dependency remains absent; the temporary exact package
      is outside the checkout and measured only as evaluation infrastructure;
- [ ] production promotion remains open pending disposable-VM install/reboot/
      upgrade/uninstall, separately packaged payload/hash/licenses/NOTICE, hosted
      Windows, broader credential-channel, and Tier-1 macOS gates.

Measured cold means were 8,940.12 ms/case for managed Windows and 1,972.14 ms/case
for AppContainer. The next smallest production slice is the disposable-lab packaged
provider lifecycle gate, not runtime selection. See
[Checkpoint 83](../decisions/checkpoints/2026-08-12-83-managed-windows-provider-adapter-local-gate.md).

### 2026-08-12 packaged provider lifecycle gate preparation

- [x] an immutable evaluation payload records exact cached published archives,
      exact package/version/license identities, license texts, third-party notices,
      adapter hash, and evaluation-only/no-verbatim-source provenance;
- [x] schema-2 bundles bind that payload separately from the Forge root graph and
      reject changed, missing, reparse-point, duplicate, or unmanifested files;
- [x] the guest lifecycle runner uses write-once payload/install/reboot/corpus/
      uninstall/reboot/finalization phases and runs one Rust-owned corpus against
      managed Windows and AppContainer without TypeScript policy authority;
- [x] the host driver records a chained lifecycle including both hard resets and
      clone destruction; the read-only finalizer requires exact guest hashes,
      canary cardinality, both corpus reports, measurements, upgrade, uninstall,
      residue, and ordered host lifecycle evidence;
- [x] local non-elevated packaging/guest verification passes with all five exact
      package identities and the root application manifest/lock unchanged;
- [ ] real VM install/setup, both reboot probes, same-corpus execution, uninstall,
      export, and clone destruction have not run;
- [ ] a real upgrade is blocked on selecting and auditing a second exact provider
      pin and adding a two-payload upgrade phase; the finalizers fail while absent;
- [ ] production/hosted readiness remains false; no provider or dependency is
      promoted by this preparation.

See
[Checkpoint 84](../decisions/checkpoints/2026-08-12-84-packaged-provider-lifecycle-gate-preparation.md).

### 2026-08-12 consolidated publication gate

- [x] the complete Rust/TypeScript/hybrid/product gate passes on the consolidated
      branch;
- [x] clean-install native-package discovery and the optimized bridge budget pass;
- [x] npm and RustSec audits report no findings;
- [x] a fresh explicit five-control corpus passes 17/17 against both Windows
      evaluation providers;
- [ ] hosted Windows/macOS/Ubuntu, exact-head controlled VS Code, clean-VM provider
      lifecycle, and production promotion remain separate acceptance gates.

See
[Checkpoint 85](../decisions/checkpoints/2026-08-12-85-consolidated-transaction-sandbox-local-gate.md).

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
