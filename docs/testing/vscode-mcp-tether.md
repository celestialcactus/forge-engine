# Test ForgeEngine in VS Code

**Applies to:** Slice 1 read-only tether
**Repository to open:** `C:\dev\forge-engine`

## What this test proves

VS Code launches Forge as a local stdio MCP server, discovers two read-only tools,
and invokes the same Forge workspace service used by the CLI. Tool results include
a Forge run ID, workspace snapshot identity, context counts, evidence, and ordered
events.

It does not yet prove model inference, editing, terminal execution, durable session
resume, or a custom Forge editor interface.

## Prerequisites

- Node.js 22 or later;
- VS Code with MCP support and GitHub Copilot Chat enabled;
- the `C:\dev\forge-engine` checkout opened as the workspace folder.

## Prepare the checkout

In the VS Code integrated terminal:

```powershell
npm ci
npm run check
npm run build
```

The build step matters because `.vscode/mcp.json` launches
`dist/src/cli.js mcp` rather than a TypeScript development process.

## Start the tether

1. Open the Command Palette with `Ctrl+Shift+P`.
2. Run **MCP: List Servers**.
3. Select **forge-engine** and start or restart it.
4. Review and accept VS Code's local-server trust prompt.
5. Open Copilot Chat in Agent mode.
6. Open **Configure Tools** and confirm these tools are present:
   - **Forge Workspace Summary** (`forge_workspace_summary`)
   - **Forge Workspace Search** (`forge_workspace_search`)

## Suggested manual prompts

```text
Use the Forge Workspace Summary tool. Tell me the Forge run ID, workspace snapshot
ID, total file count, and whether the returned file list was truncated.
```

```text
Use the Forge Workspace Search tool to search for "software-evidence runtime".
Report each matching file and line, and include the Forge run ID.
```

Use the tool picker or a `#` tool mention if the agent does not select the tool
automatically.

## Expected behavior

- VS Code shows `forge-engine` as running.
- Exactly two Forge tools appear.
- Both calls report `status: completed`.
- Results refer to the currently opened `forge-engine` workspace.
- Search returns literal line evidence rather than an LLM-generated answer.
- No file is changed and no network or shell capability is exposed by Forge.

## Troubleshooting

- If the server will not start, run `npm run build` and then **MCP: Restart Server**.
- If tools are stale, run **MCP: Reset Cached Tools** and restart `forge-engine`.
- Use **MCP: List Servers → forge-engine → Show Output** for transport errors.
- Confirm the opened folder is exactly `C:\dev\forge-engine`; `${workspaceFolder}`
  is passed to Forge as its evidence boundary.
- Run `node dist/src/cli.js doctor --json` in the integrated terminal to verify the
  built CLI independently of VS Code.

## Windows boundary

VS Code currently does not provide MCP server sandboxing on Windows. This tether is
therefore constrained by Forge itself: it registers only bounded read operations.
Do not interpret the VS Code trust prompt or the current Forge policy as a process
containment boundary.

## References

- [VS Code: add and manage MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
