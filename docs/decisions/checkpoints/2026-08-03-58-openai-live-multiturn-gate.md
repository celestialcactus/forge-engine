# Checkpoint 58 - Credentialed OpenAI multi-turn acceptance

**Date:** 2026-08-03
**Branch:** `feature/cli-live-loop`
**Status:** local and live provider gates green; exact-head hosted revalidation pending

## Why this checkpoint exists

The first credentialed OpenAI checks proved the direct Responses endpoint, but the
required search-to-read flow stopped after search. Forge recorded a valid terminal
provider turn as `completed` even when the requested second capability and outcome
were missing. The failure exposed two separate integration issues and supplied a
concrete acceptance case for the next outcome-verification increment.

## Findings

1. The OpenAI adapter uses `store: false` and manually manages conversation history.
   It replayed normalized assistant/tool messages but discarded exact response
   output items, including provider reasoning state. Current OpenAI model guidance
   requires manual-history clients to resend every response output item and, under
   `store: false`, the encrypted reasoning items returned by the API.
2. The planner prompt said "Use at most one Forge tool in this turn." GPT-5.6 Sol
   interpreted `turn` as the whole task and explicitly refused the required read
   after search.
3. Rust correctly recorded the provider behavior, but `status=completed` means only
   that a valid terminal planner turn occurred. It does not prove task completion.

Official guidance used for the continuation decision:
https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6

## Bounded correction

- `OpenAiResponsesProvider` now preserves exact completed response output items
  privately and replays them in order with the next `function_call_output`.
- Continuation state remains adapter-local and never enters `RunArtifact`, Rust
  events, logs, or the provider-neutral inference-evidence contract.
- Manual continuation is capped at 1,048,576 serialized characters, fails closed
  on malformed output items, and rejects concurrent reuse.
- If a streaming fixture omits a completed function item, the adapter reconstructs
  only the normalized function-call item needed for continuation.
- Planner wording now permits one tool per provider response and explicitly states
  that a returned tool result begins a new planning turn where another tool may be
  called when evidence is still missing. The runtime still rejects multiple tool
  calls in one provider response.

## Validation

- Focused inference suite: 8/8 passed.
- Full local gate: typecheck, 58/58 tests, and production build passed.
- Live OpenAI text gate: `run:91a5c068-b510-4db3-9b40-0aa68f028610`, 706 input /
  9 output tokens, exact `FORGE_OPENAI_OK`.
- Live OpenAI one-read gate: `run:acc2c07e-7457-4e67-96e5-383a7bbb917c`, two
  inference turns, one successful read, 1,657 input / 44 output tokens.
- Final live OpenAI search-to-read gate:
  `run:74eb577b-2a5e-42ba-a922-55369f9f3108`, three inference turns, exactly one
  search and one read, 12 canonical events, 2,827 input / 72 output tokens, exact
  answer `forge_workspace_read`.
- Provider-neutral local control:
  `run:a4120a36-2ff7-496a-83bb-f72473588c01` completed the same search-to-read
  flow on `qwen2.5-coder:7b` with three turns, two successful capabilities, and
  12 canonical events.
- All cloud calls used `C:\tmp\forge-openai-acceptance-fixture`; no Forge repository
  source was sent to OpenAI.

## Failed evidence retained

- `run:541c4e01-b0fd-4a27-b65e-f583a1f9d77b` stopped after search with
  `Insufficient evidence.`
- `run:002913f5-f7a6-46d0-a870-7af05707e321` stopped after search and stated that
  the one-tool wording prevented the required read.
- Both runs were mechanically valid and therefore recorded `completed`; neither
  satisfied the requested outcome. Increment 4 must make this distinction explicit
  rather than relying on prompt wording or model prose.

## Acceptance boundary

Credentialed OpenAI text, bounded-read, and dependent search-to-read behavior are
live-green locally. Increment 3 is not merged or finally accepted until the exact
patched head passes the hosted Node Windows/macOS and Rust-product
Windows/macOS/Ubuntu matrix. The existing controlled VS Code MCP result is unchanged
because this patch affects only provider planning/transport, not the MCP adapter.
