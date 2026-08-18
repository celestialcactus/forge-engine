# ForgeEngine repository and worktree authority

**Status:** accepted contributor workflow
**Authority anchor:** `5fff597269168c250b15e89e7ae77d68f0510abc`
**Canonical remote:** `https://github.com/celestialcactus/forge-engine.git`
**Canonical integration branch:** `origin/develop`

The authority is a Git lineage, not a particular drive letter. A clone or worktree is
valid when its `origin/develop` and `HEAD` both contain the reconstruction authority
anchor. The anchor is the merge of PR #25: it permanently distinguishes the
reconstructed engine from the historical prototype without hard-coding the current
tip of `develop`.

## Start every new lane this way

```powershell
git fetch origin develop
npm run repo:authority -- --require-current-develop
git worktree add -b codex/<bounded-lane> <absolute-worktree-path> origin/develop
```

Run `npm run repo:authority` again inside the new worktree. The command is read-only.
It rejects the wrong remote, a stale prototype lineage, and—with
`--require-current-develop`—a branch that does not contain the fetched integration
head.

## This workstation

- `C:\dev\forge-engine` owns the canonical reconstructed Git object store.
- `C:\tmp\forge-engine-canonical-develop` is the clean local `develop` worktree.
- `C:\Users\gabri\OneDrive\Documents\Platform` is the dirty historical prototype
  checkout. Preserve it for archaeology and recovery; do not create new Forge work
  from it and do not discard its uncommitted content.
- The Codex saved project currently points at that historical checkout. Re-open
  `C:\dev\forge-engine` as the ForgeEngine project before creating another Codex
  worktree. The app currently exposes no programmatic project-path reassignment.

These paths are local operational facts, not portable product requirements.

## Existing stale work

Do not merge stale ancestry. Preserve the candidate commit or dirty worktree, create
a fresh branch from current `origin/develop`, and replay only the bounded diff. Run
the original acceptance gate again on the replayed commit. This applies to the
trusted-alpha candidate `a023119`, the CLI8A candidate `b5effea`, and the current
sandbox lifecycle lane when it reaches its safe reconciliation checkpoint.

## What this guard does not prove

The guard does not prove that a change is correct, reviewed, tested, or accepted. It
only prevents an implementation lane from borrowing authority from the archived
prototype or an unfetched `develop` reference.
