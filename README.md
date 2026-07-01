# Forge Engine (v0.1)

Forge Engine is a spec-driven, enterprise-grade agent execution harness designed for local-first efficiency, hybrid intelligence routing, and robust state persistence. It enables developers to run complex, multi-agent workflows (DAGs) locally or hybridly, minimizing cloud overhead while maintaining enterprise safety features like DLP, Egress enforcement, and contextual auto-compression.

---

## 🌟 Key Features

### 1. Hybrid Model Routing
Run in three operational modes:
*   **Sovereign:** Executes strictly on local hardware (Ollama / Llama3 / Mistral) for absolute data isolation and zero provider cost.
*   **Copilot:** Relies on premium cloud models (Claude 3.5 Sonnet / GPT-4o) for high-reasoning tasks.
*   **Hybrid (Dynamic Dispatch):** Utilizes a heuristic classifier to analyze task complexity, token sizes, and file footprints, automatically routing lighter tasks to local LLMs and heavy reasoning to the cloud.

### 2. Directed Acyclic Graph (DAG) Workflows
Build structured agent topologies instead of fragile linear chains:
*   Define multi-agent pipelines with `defineWorkflow`.
*   Support dynamic edge routing using conditional guard gates (e.g. `analysisCompleted`, `noBlockerFindings`).
*   Built-in resilient loop protection preventing agents from hitting unbounded iterations.

### 3. State Checkpointing & Persistence
*   Automatically persists state checkpoints at every node transition using Drizzle ORM and `better-sqlite3`.
*   If an execution is interrupted, crashes, or hits an iteration cap, it can be instantly resumed from its last valid state.
*   Integrated **FTS5 Full-Text Search** virtual tables for indexing and semantic recall of previous agent execution results.

### 4. Compress-Cache-Retrieve (CCR) Context Pipeline
Avoid LLM context-window blowout with our smart compression engine:
*   **Smart JSON Array Crusher:** Samples massive JSON data, keeping failures and anomalies intact while trimming redundant successes.
*   **Hash-and-Swap Truncation:** Large command line logs and code arrays are swapped with a 16-character hash and saved to the SQLite cache.
*   **Autonomous Retrieval:** Injects the `ccr_retrieve` tool directly into the LLM's workspace, allowing the model to pull the uncompressed data if it needs to inspect a truncated section.

### 5. Interactive CLI & Live Steering
*   **Model Thought Streaming:** Watch the agent's step-by-step thinking directly within the console renderer.
*   **Manual Intervention (SIGTSTP):** Press `Ctrl+Z` at any time to pause execution. Inject context on-the-fly, inspect properties, or force redirect the engine to a specific workflow node.

---

## 🛠️ Installation

Prerequisites: Node.js (v18+) and npm.

1.  Clone the repository:
    ```bash
    git clone https://github.com/celestialcactus/forge-engine.git
    cd forge-engine
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Build the source:
    ```bash
    npm run build
    ```

---

## ⚙️ Configuration

Create a `.env` file in the root of your project:

```env
# Cloud Model Authentication
ANTHROPIC_API_KEY=your-claude-key-here
OPENAI_API_KEY=your-openai-key-here

# Local Model Configuration (Ollama)
OLLAMA_API_BASE_URL=http://127.0.0.1:11434/api

# OpenTelemetry Exports (Optional)
OTEL_SERVICE_NAME=forge-engine
```

### Sandbox Execution (Docker)
By default, the `bash` and `browser_action` tools run locally during development. In production, configure the docker workspace environment to sandbox shell commands:
```env
FORGE_SANDBOX_MODE=docker
```

---

## 🚀 Running the Engine

Initialize the SQLite database memory:
```bash
npm run db:generate
npm run db:migrate
```

Launch the interactive CLI loop:
```bash
npm run forge
```

---

## 🧪 Testing

To run the unit test suite verifying the registry filters and model router heuristics:
```bash
npm run test
```
