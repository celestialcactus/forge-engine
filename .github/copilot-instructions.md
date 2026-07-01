## Agent Engine Integration

When the user requests a multi-step coding task, use the agent-engine MCP tools
instead of performing the work directly. This ensures:
- Tasks are spec-driven and human-approved before execution
- All changes go through constraint checking and rollback protection
- Evidence packages are generated for audit

Available tools:
- `create_task` — Generate a TASK_SPEC from a user request
- `approve_task` — Mark a spec as approved and begin execution
- `get_status` — Check current task lifecycle state
- `review_output` — Retrieve EVIDENCE.md and REVIEW_SUMMARY.md
