# ADR-0024: Model plan and Rust change composition

- **Status:** Accepted for increment 4B-2; lifecycle convergence remains 4B-3
- **Date:** 2026-08-04
- **Scope:** Interactive CLI edit planning, review, verification, and promotion

## Context

Forge already had an accepted Rust transaction authority, but the interactive CLI
could only inspect a workspace. A useful alpha needs to let an inference provider
suggest an edit without giving the provider raw write, shell, approval, verification,
or promotion authority.

Initial live Qwen tests also exposed two poor model-facing assumptions. Requiring a
model to copy a 64-character SHA-256 was unreliable below 7B, and the internal name
`replacementText` was less reliably emitted than the conventional `content`. Those
are harness integration concerns, not security decisions that should be delegated
to the model.

## Decision

1. The seven evidence tools remain the ordinary CLI/MCP surface. An eighth
   `forge_workspace_change_plan` tool exists only for an interactive CLI session
   started with a valid trusted verification policy.
2. The model-facing tool accepts only bounded `{path, content}` replacements. The
   model cannot choose a digest, diff budget, verifier, approval result, candidate,
   or promotion decision.
3. Before a plan may reach approval, the same planning RunArtifact must contain
   successful prior read evidence that covers every line of every target at the
   exact digest used by the non-mutating plan. Partial, stale, post-plan, missing,
   repeated, ambiguous, or truncated evidence fails closed.
4. TypeScript renders the review diff and retains the requested content. Rust then
   independently prepares ChangeSet v2. Every path, before digest, after digest,
   byte count, and content kind must agree before the developer sees an execution
   approval prompt.
5. The first visible approval authorizes only the exact prepared ChangeSet and
   selected verifier IDs. Rust applies it to an isolated candidate, runs the trusted
   bounded verifiers, and authors the outcome. Only a verified candidate receives a
   second explicit accept/discard/retain prompt.
6. The sovereign v3 bridge projects prepared operation fields to a consistent
   camelCase host contract. It does not change the durable/core ChangeSet v2
   serialization.
7. Capability failures show a bounded single-line reason. A provider that prints a
   registered tool call as terminal JSON fails the run instead of receiving a false
   completed status.
8. Verification-policy parsing is strict and trusted-only. Unsupported isolation
   fields, malformed bounds, duplicate checks, and unknown selections fail before
   approval. This path does not claim an OS sandbox.
9. A change-planning session does not stream provider prose directly to the human.
   If no valid plan is produced, Forge prints the completed buffered answer. If a
   valid plan is produced, the Forge-rendered diff, approval state, verifier result,
   and Rust terminal transaction state are the human-facing authority. This prevents
   model wording from claiming that a reviewed change was already applied.

## Why this preserves the hybrid boundary

TypeScript owns provider schemas, prompts, interactive presentation, and translation
of a model suggestion into a reviewable plan. Rust owns canonical ChangeSet identity,
approval binding, candidate mutation, process lifecycle, verification evidence,
outcome, recovery, and promotion. Neither side introduces a competing runtime.

## Honest limitations

- Current provider planning and Rust transaction artifacts are attributable to the
  same interaction but are not yet one durable aggregate RunArtifact. That is the
  remaining 4B lifecycle-convergence gate.
- Full-file replacement is intentionally the first interactive operation. Larger
  files may require multiple bounded reads and enough provider context to retain the
  complete content.
- Qwen 0.5B and 1.5B did not reliably select read before plan. Qwen 3B read correctly
  but leaked a tool call as text. Qwen 7B produced one read and one valid plan for an
  unambiguous replacement. These observations are a local model floor, not a general
  benchmark.
- Verifiers run in the explicit trusted posture. Forge owns lifecycle and transaction
  recovery, not OS permission containment.
- MCP remains seven read-only tools; this decision does not authorize host mutation.

## Rejected alternatives

- **Let the model echo security digests.** This wastes tokens and makes correctness
  depend on copying opaque text. Forge can bind the digest deterministically.
- **Accept a plan without complete prior reads.** A partial read plus full replacement
  can silently truncate a file.
- **Let the model set verification commands or diff limits.** Those are policy and
  presentation controls, not inferred intent.
- **Normalize arbitrary malformed model arguments.** Only the explicit model-facing
  adapter maps `content`; ambiguous or unknown plan content remains an error.
- **Expose a write tool through MCP now.** That would bypass the local acceptance and
  host-approval work still required.
