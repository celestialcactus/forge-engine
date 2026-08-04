# ADR-0020: Explicit local context and provider evidence projection

- **Status:** Accepted
- **Date:** 2026-08-03
- **Scope:** CLI ship lane 3 local inference reliability

## Context

A live qwen2.5-coder:7b one-read run executed the correct Forge capability but
returned a refusal on its second inference turn. Ollama reported exactly 2,048 input
tokens on that turn. The provider request had not declared a context window, and
the raw internal workspace.read result repeated the same source as both a text
field and line records.

A separate live run showed a second failure mode: Qwen printed a tool_response
envelope as ordinary terminal text. Forge previously treated any non-empty stopped
text as a completed planner turn, even when it was plainly a malformed attempt to
call a tool.

## Decision

1. The Ollama adapter declares an 8,192-token context window by default. A validated
   FORGE_OLLAMA_CONTEXT_TOKENS override may select 2,048 through 262,144.
2. Agentic Ollama turns use temperature zero. This is an adapter default for the
   measured local family, not a claim that sampling alone guarantees correctness.
3. Provider-facing tool evidence is a projection boundary. workspace.read becomes
   compact, citation-ready line evidence before it is sent back to a provider. The
   internal CapabilityResult, RunArtifact, digests, and Rust event authority remain
   unchanged.
4. A terminal response consisting of a tool_call or tool_response envelope is
   rejected as a runtime error. Forge never guesses the intended capability or
   executes markup as a tool call, because that would bypass the typed tool and
   policy boundary.
5. completed continues to mean that the runtime reached a valid terminal planner
   turn. It does not certify that every natural-language claim is grounded. A
   separate outcome-verification contract must represent that stronger state.
6. A provider context manifest never presents workspace locators as though they
   were source evidence. Until selected files have an explicit provider-facing
   content projection, the planner sends only selected/omitted counts and tells the
   model to use Forge tools for workspace facts and paths. The full internal
   ContextPlan remains authoritative and unchanged.

## Consequences

- The measured one-read Qwen flow no longer clips at 2,048 tokens and is materially
  more stable.
- Provider context is smaller without weakening the authoritative artifact.
- Local inference consumes more memory at the 8K default; developers can set an
  explicit bounded override.
- Small local models may still stop early, ignore requested tool sequences, or
  hallucinate. Prompt text is not accepted as a substitute for outcome
  verification.
- Removing locator-only pseudo-context reduced the measured qwen2.5-coder:7b
  one-read task from 3,785 to 2,670 input tokens (about 29.5%) while retaining
  three grounded passes. This is a task-specific measurement, not a universal
  compression claim.
- Context-window and sampling values are not yet recorded in InferenceEvidence.
  That schema addition is retained debt for reproducibility rather than being
  falsely claimed as present.
