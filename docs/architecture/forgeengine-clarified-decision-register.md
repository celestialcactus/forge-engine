# ForgeEngine clarified decision register

**Status:** active decision summary
**Date:** 2026-08-20

This register translates the eight front-loaded questions into explicit decisions,
proposals, and evidence gates. Accepted ADRs and runtime tests remain stronger
authority; this page makes the remaining human decisions legible.

| Step | Topic | State | Decision or next gate |
| ---: | --- | --- | --- |
| 1 | License and ownership | License selected; rights attestation open | Forge-authored distributions use Apache-2.0. Root/npm/Cargo/native-package metadata is aligned. Before public publication, the maintainer must attest that they can license the existing contributions and identify any employer or third-party rights requiring clearance. |
| 2 | Alpha target matrix | Accepted | Support Windows x64 and macOS ARM64/x64. Keep Ubuntu x64 as a compatibility/CI target without an alpha support promise. Defer Windows ARM64 and Linux ARM64. Scaffolding is not support. |
| 3 | Configuration precedence | Accepted through PR #31 and Checkpoint 91 | Managed ceilings → explicit CLI → environment/secret references → workspace → user → built-ins. Selection values use precedence; policy/authority values are intersected and may only tighten. Workspace may select provider/model but not endpoints, credential references, executables, or state roots. Fixed user/workspace files, kernel-free config commands, redacted source/digest reporting, service/MCP parity, and no-fallback routing pass the declared hosted matrix. Forge owns intrinsic harness security; the operator owns organizational inference governance. CLI7 adds no provider ceilings or enterprise-policy subsystem. |
| 4 | Protocol compatibility | Accepted | Negotiate live wire versions/capabilities, version persisted record families independently, write only the current schema, support a bounded inspection/migration window, and fail closed on unknown newer execution semantics. |
| 5 | Memory semantics | ADR-0038/0039 accepted; Slice 0–2 candidate validation pending | Rust owns deterministic identity, exact scope, provenance, the canonical NDJSON ledger, rebuild, correction, recovery, and erasure rewrite; TypeScript owns orchestration, UX, and future replaceable retrieval machinery. Explicit repository decisions use `reviewed_decision`; recovery is bounded by 30 days, five lineage versions, and 16 MiB per exact scope. Only remember/find/show/explain/correct/history/restore are in the candidate. Autosave, forget/purge/history-clear, prompt injection, retrieval, and skills remain gated. |
| 6 | Sandbox contract split | Existing accepted direction; refinement gate open | Rust owns requirements and binding; a provider reports support facts and returns a lifecycle receipt. The lifecycle lane must prove the refined split before it replaces `EffectiveSandboxPlan`. |
| 7 | Evaluation thresholds | Deliberately TBD from evidence | Collect paired no-memory/retrieval baselines first. Freeze thresholds only after distributions are visible; automatic retrieval cannot be accepted on a metric chosen after seeing one favorable run. |
| 8 | Extension boundary | Recommended; pre-public-API decision pending | Prefer out-of-process MCP and declarative reviewed skills. Expose versioned capability/evidence contracts, not Rust internals or an arbitrary in-process plugin ABI. Every extension reuses the canonical run, policy, transaction, and artifact authority. |

## Why Apache-2.0 fits the stated goal

Apache-2.0 is permissive for individuals and company forks, includes an express
patent grant from contributors, and requires preservation of the license and
relevant notices. That is a better enterprise-fork default than an unqualified MIT
metadata field. It does not establish who owns code written as employment work or
imported from elsewhere; that is why the rights attestation remains separate.

## Provider-protocol answer

Yes—the accepted Forge pattern is consistent with mature provider behavior, with an
important distinction between public protocols and private storage:

- MCP initializes with protocol-version and capability negotiation and disconnects
  when no supported version overlaps.
- Codex app-server requires an initialization handshake, generates schemas specific
  to the running Codex version, and requires explicit opt-in for experimental API
  fields.
- Claude Code and Gemini CLI expose stable/latest or stable/preview/nightly release
  channels, version constraints, and rollback/promotion mechanisms.

Forge should copy those *protocol-management patterns*, not assume undocumented
compatibility for proprietary transcript or internal database formats. Wire
negotiation and durable-record migration are different problems and have separate
rules in ADR-0037.

## Primary references

- [Applying Apache License 2.0](https://www.apache.org/legal/apply-license)
- [MCP lifecycle and version negotiation](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
- [Codex app-server protocol](https://developers.openai.com/codex/app-server/)
- [Claude Code setup and release controls](https://code.claude.com/docs/en/setup)
- [Gemini CLI release channels and rollback](https://github.com/google-gemini/gemini-cli/blob/main/docs/releases.md)
