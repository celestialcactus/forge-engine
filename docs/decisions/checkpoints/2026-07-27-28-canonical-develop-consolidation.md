# Checkpoint 28: canonical develop consolidation

**Date:** 2026-07-27
**Status:** Accepted
**Canonical branch:** `develop`
**Validated consolidated source:** `8d295b12e7d553f8f64cf90784588ea967906173`

## Decision checkpoint

The literal `develop` branch is the canonical, readily pullable integration line for
the ForgeEngine rebuild. It was created from `8d295b1`, which contains the complete
accepted reconstruction through Slice 2E-0 plus the rebuild-branch CI correction.
The newest candidate-operation feature branch had no additional commits: its local
HEAD and `origin/rebuild/develop` were exactly the same object before consolidation.

`rebuild/develop` is frozen at `8d295b1` as a transition/history pointer. New feature
branches and PRs target `develop`. `rebuild/master` remains the separately promoted
stable rebuild line, and historical default `master` remains unchanged.

## Validation before publication

A fresh local `npm run check:hybrid` passed on exact commit `8d295b1`:

- Rust format and warnings-as-errors Clippy;
- all Rust unit, transaction, policy, runtime, worktree, protocol, and bridge tests;
- Rust workspace build;
- TypeScript typecheck, 37 tests, and production build;
- 27 hybrid/MCP checks, including the unchanged seven-tool MCP surface.

The same commit already passed hosted Windows/macOS cross-platform conformance and
Windows/macOS/Ubuntu hybrid conformance on the `rebuild/develop` integration head.
PR #4 added `develop` to the hybrid push filter and updated only branch policy
documentation. Its merge commit `b462f335732719aed7424ab108437ac8dc6c6ca1`
then passed both hosted workflows on the actual `develop` push:

- Cross-platform conformance, run `30298569364`: Windows and macOS passed.
- Hybrid kernel conformance, run `30298569650`: Windows, macOS, and Ubuntu passed.

This checkpoint is accepted on that exact merge commit. The workflow results validate
the consolidated integration head, rather than only the feature or transition branch.

## Version identity rule

The consolidated remote version is `origin/develop`. A local checkout is current
only when its intended base contains that ref; equality can be proven with
`git rev-parse HEAD` and `git rev-parse origin/develop` for a clean develop checkout,
or ancestry with `git merge-base --is-ancestor origin/develop HEAD` for a feature.

## Honest limits

GitHub rulesets are not yet configured, so no direct-push or review restriction is
claimed. The process, CI triggers, PR history, and checkpoint records provide the
current enforcement. Default-branch cutover and deletion of frozen/historical refs
remain explicit future owner decisions.
