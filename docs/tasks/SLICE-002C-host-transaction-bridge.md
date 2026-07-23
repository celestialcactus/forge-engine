# Slice 2C: private host transaction bridge

- **Status:** Increment 2C-0 accepted at `a985119`; 2C-1/2C-2 pass the local Windows gate; hosted cross-platform gate pending
- **Opened:** 2026-07-23
- **Branch:** feature/slice-2c-host-transaction-bridge
- **Predecessor:** Slice 2 draft PR #1 at `bfb670a`
- **Does not add:** public workspace writes, MCP mutation, promotion, or a Forge-enforced OS sandbox

## Objective

Allow a trusted embedded TypeScript host to invoke the accepted Rust-owned candidate transaction without recreating policy, transaction state, verification, or recovery logic in TypeScript. The proof is a disposable repository task that crosses the real TypeScript-to-Rust boundary, creates and verifies an isolated candidate, returns the authoritative artifact and an opaque candidate identity, and leaves the developer workspace unchanged.

## Why this is separate

Slice 2B proves the machinery inside Rust but does not provide a host-facing path. The bridge changes three contracts: complete replacement content crosses a private process boundary; trusted verification configuration must remain distinct from model input; and a retained candidate must remain discoverable after the one-transaction child exits.

Treating this as serialization alone would lose candidate lifecycle state and create orphaned Git worktrees. Candidate identity and recovery belong in this increment.

## Authority boundary

Rust continues to own manifest and proposal validation, final approval and isolation policy, clean-revision and digest checks, candidate creation/apply/verification/retention/cleanup, cancellation interpretation, terminal status, and candidate lifecycle state.

TypeScript owns the embedded integration API, child lifecycle, schema-valid transport, attributable constructor-time host configuration, cancellation requests, and presentation. It must not compute transaction success, choose an executable from model text, synthesize recovery evidence, or edit the active workspace.

## Private protocol

Use a separate bounded protocol named `forge.kernel.transaction.v1`, leaving accepted run protocol `forge.kernel.bridge.v2` unchanged. A `transaction.start` frame carries a request ID, internal manifest, expected base revision, and references to host-configured verification and isolation policy. A terminal frame returns the Rust artifact plus candidate identity or a structured protocol failure.

Requirements:

- cap an NDJSON frame before allocation and parsing;
- never echo replacement text into compact logs, MCP output, or errors;
- validate request ID, protocol version, check ID, base revision, and transaction bounds in Rust;
- observe cancellation while verification is running;
- retain one child per transaction for this conformance increment, while a long-lived kernel remains the production target.

## Trusted host configuration

Verification executables and arguments are constructor-time host configuration, never transaction/model arguments. TypeScript may transport that configuration to the child, but Rust validates and applies it.

This increment supports `trusted` only. It fails closed for `host_managed` until an authenticated handshake can prove the host and inherited controls, and for `restricted` until Forge owns an OS isolation backend.

## Candidate lifecycle contract

A successful transaction cannot exist only as an in-memory worktree path. Slice 2C adds a Rust-owned candidate lease:

- bridge evidence exposes an opaque candidate ID, not a mutation primitive;
- a minimal atomic local record maps the ID to canonical candidate path, governed repository identity, base revision, proposal/snapshot IDs, digests, creation time, and lifecycle state;
- the record lives outside the governed workspace and never contains replacement text;
- cleanup resolves the ID through Rust and changes lifecycle state only after removal is proven;
- startup or explicit reconciliation can identify abandoned records after a crash;
- promotion requires a later policy decision and is never implied by the ID.

This is a narrow lifecycle registry, not Forge's general event store.

## Increment plan

### 2C-0: lifecycle proof

1. Add candidate lease schema, atomic file implementation, and recovery tests in Rust.
2. Bind expected base revision to the approved transaction subject.
3. Prove restart-safe lookup and discard by opaque ID.
4. Prove records never contain replacement content.

### 2C-1: Rust protocol

1. Add `forge.kernel.transaction.v1` without changing run protocol v2.
2. Add bounded parsing and structured terminal failures.
3. Add independent cancellation reading during apply/verification.
4. Return the exact Rust artifact and candidate ID.

### 2C-2: TypeScript adapter

1. Add a private `RustCandidateTransactionRuntime`.
2. Separate constructor-time policy from per-transaction task data.
3. Validate protocol shape without recomputing policy/status.
4. Run disposable-repository conformance on Windows, macOS, and Linux.

## Acceptance

- a clean fixture verifies through TypeScript and Rust, returns one authoritative artifact/candidate ID, and leaves the governed workspace unchanged;
- denial, stale base, invalid manifest, failed verification, timeout, cancellation, malformed protocol, and cleanup failure remain explicit;
- the candidate can be found and discarded by ID after its child exits;
- a simulated crash leaves recoverable lifecycle evidence;
- `host_managed` and `restricted` fail closed;
- no generic shell, transaction CLI, MCP mutation, promotion, or public write exists;
- Rust formatting, Clippy/tests, TypeScript checks, hybrid/build, and hosted Windows/macOS/Linux gates pass.

## Rollback rule

If TypeScript must decide policy or status, retained candidates cannot be recovered after process exit, or the governed workspace can change before promotion, remove the bridge and retain Slice 2B as private Rust machinery. Do not add a direct file-write tool as a shortcut.
