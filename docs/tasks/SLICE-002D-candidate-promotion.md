# Slice 2D: credible candidate completion loop

- **Status:** Increment 2D-0 accepted at `1339f53`; candidate inspection/promotion increments pending
- **Opened:** 2026-07-23
- **Branch:** feature/slice-2d-candidate-promotion
- **Predecessor:** Slice 2C accepted at `fa9898f`; checkpoint consolidation at `e5d4698`
- **Does not add:** MCP mutation, generic shell/write tools, host-managed authentication, or a Forge-enforced OS sandbox

## Objective

Complete the first credible local developer change loop on top of the accepted
candidate transaction. A developer or controlled host can inspect a restart-safe
verified candidate, explicitly discard it, or explicitly promote exactly that
candidate after fresh Rust-owned approval, repository revision, path, and digest
checks. Failure must leave the active workspace unchanged rather than partially
applying a candidate.

Before real repository verification is encouraged, the verifier environment must
stop blindly inheriting every Forge credential and variable.

## Authority boundary

Rust owns environment construction, candidate identity and state, fresh approval
resolution, repository/revision/path/digest validation, promotion sequencing,
recovery, terminal evidence, and lifecycle transitions.

TypeScript owns bounded private transport and the thin local user interaction. It
may collect approval facts and present artifacts; it may not decide whether a
candidate is valid, promoted, discarded, stale, or recoverable.

## Increment 2D-0: verifier environment minimization

1. Clear the verification child environment before spawn.
2. Restore only a small cross-platform toolchain baseline, fixed policy values,
   and explicitly named inherited values.
3. Reject duplicate, malformed, missing, or oversized environment policy entries.
4. Record only inherited/fixed variable names in verification evidence; never
   record values.
5. Prove a representative secret-like kernel variable is absent while PATH,
   fixed values, and explicitly allowlisted values remain usable on Windows,
   macOS, and Linux.

This reduces accidental credential exposure. It does not reduce filesystem,
network, subprocess, or operating-system permissions and is not a sandbox.

## Increment 2D-1: inspection and promotion contract

1. Load and validate a candidate by opaque ID through the Rust lease store.
2. Produce bounded inspection evidence without exposing an arbitrary path-based
   mutation primitive.
3. Require a fresh approval subject bound to candidate ID, repository identity,
   base revision, proposal/snapshot identity, and exact changed-path/digest set.
4. Recheck the active repository is clean and still at the approved base revision.
5. Recheck the retained candidate exists, belongs to the governed repository,
   has no extra changes, and matches every retained digest and final-diff digest.
6. Promote without partial active-workspace mutation. A failure before commit must
   leave the original untouched; an interrupted apply must recover or return an
   explicit terminal recovery failure.
7. Append an immutable promoted lifecycle transition only after the active
   workspace and repository state prove the exact candidate landed.
8. Preserve restart-safe, idempotent discard.

## Increment 2D-2: private transport and controlled local surface

1. Add bounded private inspect/promote/discard protocol operations without
   changing the seven read-only MCP tools.
2. Add a TypeScript adapter that transports facts and presents the exact Rust
   artifact without recomputing decisions.
3. Add a thin experimental local candidate surface only after Rust contract tests
   pass. It exposes high-level inspect, accept, and discard operations; it does not
   accept a shell command or arbitrary file contents.
4. Validate a full propose -> transaction -> inspect -> accept/discard loop in a
   disposable repository on Windows, macOS, and Ubuntu.

## Acceptance

- secret-like environment variables are absent unless explicitly inherited;
- required baseline tools still launch on Windows, macOS, and Linux;
- retained candidates remain inspectable/discardable after process restart;
- approval for one candidate cannot promote another;
- stale, dirty, tampered, extra-path, missing-path, digest, and repository identity
  failures stop before active-workspace mutation;
- injected failure cannot leave a partial promoted path set;
- success promotes every and only approved change and records immutable evidence;
- repeated accept/discard operations are deterministic and safe;
- the current MCP surface remains exactly seven read-only tools;
- complete local and hosted Rust/TypeScript/hybrid gates pass.

## Rollback rule

If promotion cannot be made all-or-nothing for the bounded text-change set, if
TypeScript must decide validity/status, or if a stale/tampered candidate can reach
the active workspace, remove the promotion surface and retain verified candidates
as inspect/discard-only. Do not replace the gate with direct writes.