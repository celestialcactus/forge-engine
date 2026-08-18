# ForgeEngine V1 system map and build strategy

**Status:** explanatory map; contracts and ADRs remain authoritative
**Date:** 2026-08-17

ForgeEngine is one evidence-producing runtime with several surfaces. TypeScript owns
fast-changing product integration; Rust owns decisions and durable execution truth.
Replaceable databases, model providers, and OS sandbox providers sit behind those
contracts rather than becoming alternate runtimes.

```mermaid
flowchart TB
    subgraph Surfaces["Developer and host surfaces"]
        CLI["Interactive Forge CLI"]
        MCP["VS Code / MCP apprentice"]
        EMBED["Embedded host / organization harness"]
    end

    subgraph TS["TypeScript integration layer"]
        UX["CLI UX and streaming presentation"]
        HOST["MCP and embedded-host adapters"]
        PROVIDERS["Ollama and cloud inference adapters"]
        TOOLS["Tool and workflow composition"]
        CONFIG["Config facts and secret references"]
    end

    subgraph RUST["Rust authoritative kernel"]
        RUN["Run state machine and budgets"]
        POLICY["Policy, approval, and capability admission"]
        TX["ChangeSet transaction and recovery"]
        EVIDENCE["Events, artifacts, provenance, and verification"]
        CONTEXT["Context admission and future memory selection"]
        SBXPLAN["Sandbox requirements and provider binding"]
    end

    subgraph Machinery["Replaceable machinery"]
        WORKSPACE["Bounded read, search, Git, diagnostics, and test"]
        INFERENCE["Local or explicitly selected cloud inference"]
        SANDBOX["Windows / macOS / Linux sandbox provider"]
    end

    subgraph State["Local-first state"]
        LEDGER["Append-oriented authoritative ledgers and artifacts"]
        PROJECTION["Rebuildable SQLite / search / vector / graph projections"]
    end

    CLI --> UX
    MCP --> HOST
    EMBED --> HOST
    UX --> RUN
    HOST --> RUN
    PROVIDERS --> RUN
    TOOLS --> POLICY
    CONFIG --> POLICY
    RUN --> POLICY
    RUN --> CONTEXT
    POLICY --> TX
    POLICY --> SBXPLAN
    TX --> WORKSPACE
    RUN --> INFERENCE
    SBXPLAN --> SANDBOX
    WORKSPACE --> EVIDENCE
    INFERENCE --> EVIDENCE
    SANDBOX --> EVIDENCE
    EVIDENCE --> LEDGER
    LEDGER --> PROJECTION
    EVIDENCE --> UX
    EVIDENCE --> HOST
```

The arrows matter: adapters can provide facts and perform approved work, but only
the kernel can admit a capability, declare a transaction state, or produce the
authoritative run artifact. A graph or vector database accelerates a query; it does
not decide truth.

## Delivery strategy

```mermaid
flowchart LR
    CORE["Accepted evidence / transaction core"] --> ALPHA["CLI7 trusted installable alpha"]
    ALPHA --> MEM["CLI8A attributable memory"]
    MEM --> EVAL["CLI8B paired retrieval evaluation"]
    EVAL --> SKILL["CLI8C reviewed skill candidate"]
    CORE --> SBX["Parallel native sandbox lifecycle gate"]
    SBX --> BETA["Restricted beta"]
    SKILL --> PILOT["Developer pilot differentiation"]
    BETA --> PILOT
```

The sandbox lane and learning lane share contracts but not release claims. The
trusted alpha does not claim containment; the restricted beta cannot ship until an
exact OS/provider gate passes. Memory and skills cannot bypass policy or mutation
authority.

## Recommended public extension boundary

For alpha, expose only versioned, narrow contracts:

- MCP tools/resources for out-of-process host integration;
- an embedded TypeScript host adapter over the same Rust run protocol;
- provider adapters that normalize inference facts but cannot route implicitly;
- declarative, reviewed skills that request existing capabilities;
- read-only event/artifact readers with documented schema windows.

Do not stabilize Rust module layouts, database tables, arbitrary in-process plugin
hooks, raw shell/write tools, or internal projection schemas. This keeps third-party
integration possible without freezing implementation internals or creating parallel
runtimes. A post-alpha ADR must decide which of these surfaces receives a public
compatibility promise.
