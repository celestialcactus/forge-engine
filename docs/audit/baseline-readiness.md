# Verified-Baseline Readiness

## Decision

The repository is **not ready for a verified-baseline pass as a runnable agent engine**. It is ready for a narrower **baseline-stabilization pass** whose purpose is to make installation deterministic, define the minimum supported runtime, establish enforceable boundaries, and create one mocked end-to-end path.

It is unsafe to execute model-controlled built-in tools against untrusted input or valuable workspaces. `bashTool`, `readFileTool`, `writeFileTool`, and MCP server launch are not sandboxed by ForgeEngine.

## Evidence from this audit environment

- Node `v22.19.0` satisfies `package.json` (`>=22`), although `README.md` incorrectly says Node 18+.
- `npm ci` fails with an AI SDK/Ollama peer conflict.
- `npm ci --legacy-peer-deps` succeeds, but that is a diagnostic workaround, not an acceptable baseline install procedure.
- Build and typecheck pass after the workaround.
- Six unit tests pass outside the managed sandbox; the sandboxed run fails because Vitest cannot spawn a worker.
- No runnable engine fixture exists, so provider, workflow, persistence, tool, policy, and CLI behavior cannot be verified end to end.

## Exact prerequisites for the next baseline pass

### Commands

Run from the repository root on a clean checkout:

1. `node --version`
2. `npm --version`
3. `npm ci` — must succeed without `--force` or `--legacy-peer-deps`
4. `npm run typecheck`
5. `npm run build`
6. `npm test -- --reporter=verbose`
7. `npm audit --json`
8. `npm pack --dry-run`
9. Execute the packed CLI help/version command once a real CLI entrypoint exists.
10. Run a deterministic mocked E2E fixture that constructs the engine, denies an out-of-root file access and a blocked command, executes one allowed tool, checkpoints, simulates interruption, resumes exactly once, and reaches a terminal checkpoint.

No command should be recorded as passing from this audit except those listed with captured results in `current-state.md`.

### Dependencies and runtimes

- A deliberately selected Node LTS baseline; current metadata requires Node 22 or later.
- npm version pinned or recorded in CI.
- A mutually compatible, exact generation of `ai` and every installed AI SDK provider.
- A supported native `better-sqlite3` build for each target OS/architecture.
- SQLite with FTS5 and `RETURNING` support if those features remain in V1.
- Vitest worker process/thread support, or an explicitly configured single-worker test mode for restricted CI.
- Docker/another sandbox runtime only if shell/browser/MCP execution is part of baseline scope. Merely having Docker installed is insufficient; an isolation profile and denial tests are required.

### Environment variables

The deterministic mocked baseline should require **none**.

Optional integration lanes, kept separate from baseline, may require:

- `OLLAMA_BASE_URL` (choose one canonical name; README currently documents `OLLAMA_API_BASE_URL`, while no source reads it).
- Provider credentials such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or Google credentials only after managed-credential and egress ADRs. Never require them for unit/E2E baseline.
- `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` only for an opt-in telemetry test. Current `TelemetryManager` instead accepts an endpoint parameter and mutates `OTEL_SERVICE_NAME`.
- A canonical Forge config-home override. Current code uses legacy `AGENT_ENGINE_HOME`; the plan proposes Forge naming.

The exact provider environment contract cannot be finalized until provider and credential decisions are made.

### Services

- None for unit and mocked E2E baseline.
- Optional local Ollama service for a separate sovereign integration test, with a pinned model artifact/digest and preflight health check.
- Optional OTLP collector for telemetry integration; telemetry must be disabled by default in sovereign tests.
- No live cloud provider should be needed to accept baseline.

### Fixtures

- Minimal valid global/repo configuration pairs covering every precedence branch and invalid input.
- Temporary workspace with inside/outside paths, symlinks/reparse points, forbidden directories, dependency files, and platform-specific path forms.
- Safe, blocked, quoted, chained, encoded, shell-specific, and timeout command cases.
- DLP corpus with positive/negative cases and prompt/context/tool-output flows.
- Egress corpus covering exact host, subdomain, port, scheme, credentials-in-URL, redirects, DNS rebinding assumptions, provider calls, MCP, and subprocess traffic.
- Scripted/mock AI SDK provider with text, tool-call, failure, retry, max-step, cancellation, and malformed structured-output cases.
- Workflow graphs for straight-line, branching, no passing guard, bounded loop, failure, interruption, and resume.
- SQLite databases for fresh schema, upgrade, corrupt/partial state, concurrent access, terminal checkpoint, memory update/delete, FTS rebuild, and CCR collision/expiry/quota.
- MCP test server with known manifest, environment capture, tool schema, timeout, crash, and malicious response cases.
- Package smoke fixture that installs the packed tarball and invokes its public API/CLI.

## Entry criteria before claiming readiness

1. Normal clean install succeeds from the lockfile on the supported matrix.
2. “Sovereign,” “trusted,” permissions, and sandbox boundaries are decided in ADRs.
3. Unsupported policy fields either enforce behavior or fail validation; none silently imply protection.
4. The minimum composition root and mocked E2E fixture exist.
5. File, command, provider, network, MCP, DLP, and audit boundaries have denial tests.
6. Persistence transition and terminal/resume semantics are transactional and tested.
7. README and package metadata describe only verified behavior.
