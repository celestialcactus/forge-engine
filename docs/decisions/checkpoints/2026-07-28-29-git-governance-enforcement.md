# Checkpoint 29: Git governance enforcement

**Date:** 2026-07-28
**Status:** Repository settings applied; workflow PR gate pending
**Canonical integration branch:** `develop`
**Stable promotion branch:** `rebuild/master`

## Decision

ForgeEngine uses a small two-line branch model:

- `develop` is the default and canonical integration line;
- `rebuild/master` is advanced only for named stable promotions;
- bounded topic branches start from and return to `develop`;
- historical `master` and transitional `rebuild/develop` are read-only.

Merge commits are the only enabled PR merge method. This preserves the ancestry of
accepted implementation commits referenced by Forge checkpoints. Automatic head
branch deletion prevents merged topic refs from looking like active work.

## Enforced repository settings

GitHub now requires a pull request and strict successful status checks on both active
long-lived branches. Protection includes administrators, blocks force-pushes and
deletion, and requires review conversations to be resolved. The five required jobs
are:

- Node 22 / Windows;
- Node 22 / macOS;
- hybrid Rust kernel + TypeScript adapter / Windows;
- hybrid Rust kernel + TypeScript adapter / macOS;
- hybrid Rust kernel + TypeScript adapter / Ubuntu.

The approval count is intentionally zero during solo-maintainer prototype work.
Requiring a self-approval would add ceremony without independent review. The count
must become one when a second regular maintainer joins.

## CI correction

Both workflows are narrowed to pull requests targeting `develop` or
`rebuild/master`, plus post-merge pushes to those branches and manual dispatches.
Topic-branch pushes no longer duplicate the same PR matrix. A workflow/ref
concurrency key cancels obsolete runs after a newer commit arrives.

## Remaining owner decisions

- Existing merged remote topic branches predate automatic deletion. They may be
  removed in a separate, explicitly approved cleanup after their merge ancestry is
  rechecked.
- `rebuild/master` retains its transitional name until the first public stable
  release. Renaming it to `main` is reasonable then, but doing so during active
  prototype reconstruction would create churn without improving enforcement.
- Git tags and release artifacts are not introduced until a named stable promotion.
