# VS Code Developer Test Milestone A

**Repository:** `C:\dev\forge-engine`
**Mode:** read-only MCP apprentice
**Tools:** seven Forge repository-intelligence tools

## Prepare and refresh VS Code

The production build is already validated. If you pull or change source later, run:

```powershell
npm ci
npm run check
npm run build
```

In VS Code:

1. Run **MCP: Reset Cached Tools** from the Command Palette.
2. Run **MCP: List Servers**.
3. Select **forge-engine**, then **Restart Server**.
4. Open Copilot Chat in Agent mode.
5. In **Configure Tools**, confirm all seven `forge_` tools appear.

For a controlled test, disable unrelated tools or explicitly tell the agent to use
only tools whose names begin with `forge_`.

## Test 1: workspace identity and trace

```text
Use only Forge tools. Call Forge Workspace Summary with maxFiles 20. Report:
- the Forge run ID;
- workspace snapshot ID;
- total file count;
- whether the file list was truncated;
- the ordered event types in the run.
Do not use VS Code's built-in file search.
```

Expected: a completed run, successful capability, bounded file list, and events
from `run.started` through `run.completed`.

## Test 2: search-to-read evidence chain

```text
Use only Forge tools. Search the workspace for "class ForgeWorkspaceService".
Choose the matching source file, then use Forge Read Workspace File to read the
smallest useful line range around that declaration. Explain what the service owns.
For every factual claim, cite the Forge file and line evidence. Include both Forge
run IDs.
```

Expected: literal search evidence followed by a bounded read. No whole-repository
dump and no file modification.

## Test 3: structural declarations

```text
Use Forge Workspace Declarations to find symbols containing "Workspace". Group the
results by class, interface/type, function, and variable. Give each file and line,
state how many files were scanned, and tell me whether the result was truncated.
```

Expected: TypeScript/JavaScript syntax-tree declarations. This is not yet semantic
references or call hierarchy.

## Test 4: compiler truth

```text
Use Forge TypeScript Diagnostics with configPath "tsconfig.v1.json" and
maxDiagnostics 50. Report the diagnostic count, project file count, whether
anything was emitted, and the Forge run ID. Do not run a terminal command.
```

Expected for the validated checkout: zero diagnostics and `emitted: false`.

## Test 5: Git state and bounded diff

```text
Use Forge Git Status, then Forge Git Diff with maxBytes 4000. Summarize the current
branch, number of changed files, the major change themes visible in the bounded
diff, and whether the diff was truncated. Include both Forge run IDs. Do not invoke
Git through a terminal tool.
```

Expected: the worktree is currently dirty because the reconstruction is
uncommitted. The diff tool must return no more than the requested bound.

## Test 6: boundary rejection

```text
Call Forge Read Workspace File with path "../package.json". Do not substitute a
different tool when it fails. Report the structured Forge error, capability success
flag, and ordered event types. Confirm that no outside file content was returned.
```

Expected: the MCP result is marked as an error, capability success is false, and
the evidence mentions path traversal. This is an intentional negative test.

## Test 7: multi-tool repository briefing

```text
Using only Forge tools, produce a short evidence-backed briefing on the current V1
runtime. You must use workspace summary, declarations, bounded file read,
TypeScript diagnostics, and Git status. Separate verified facts from your
interpretation. Include every Forge run ID and note any truncated evidence.
```

Expected: the host composes multiple independent Forge artifacts rather than
receiving one opaque answer from Forge.

## What to observe

Please note more than whether the answer is correct:

- Did Copilot select the intended Forge tool without excessive prompting?
- Were tool names and descriptions understandable?
- Was the evidence too verbose or too sparse?
- Did run IDs and event traces help, or distract?
- Did bounded results cause a useful follow-up retrieval?
- Did any result imply capabilities Forge does not actually have?
- How long did diagnostics and repository scanning feel?

These observations will shape the indexed workspace service, context compiler, and
future change transaction more than raw token counts will.

## Current boundary

Do not ask Forge to edit, run tests, execute commands, or commit yet. VS Code itself
may have tools that can do those things, but they are not part of this Forge
milestone. Keeping them disabled during the controlled test makes the tether's
actual contribution measurable.
