# Docs Cleanup Design

**Date:** 2026-10-07
**Scope:** Repository hygiene only. No code, schema, or test changes.

## Goal

Keep `docs/` limited to live contracts and guides. Move completed phase records
to `docs/archive/`. Stop tracking a scratch file that predates its gitignore rule.

## Changes

### 1. Archive completed phase docs

Move with `git mv` so file history follows:

- `docs/G1-IMPLEMENTATION-PLAN.md`
- `docs/G1-METADATA-SCOPING-SPEC.md`
- `docs/PHASE-2-SPEC.md`
- `docs/PHASE-2-REPORT.md`
- `docs/PHASE-3-GATE-1-REPO-PUSH-SPEC.md`
- `docs/PHASE-3-GRAPHPOWERS-HOOKS-FIX-SPEC.md`
- `docs/MARKETPLACE-CONSOLIDATION.md`

All seven go to `docs/archive/<same name>`.

### 2. Keep in `docs/`

- `ADDING-A-PRODUCT.md`: contributor guide, linked from README.
- `CLAUDE-PLUGIN-SCHEMA-VERIFICATION.md`: cited by `scripts/lib/build.mjs:102`.
- `SCHEMA-FREEZE.md`: live schema contract.
- `NINE-PRODUCT-REPRESENTATION.md`: describes the current product set.
- `superpowers/`: active specs and plans.

### 3. Fix references

- `README.md` lines 168–169: point to `docs/archive/PHASE-2-SPEC.md` and
  `docs/archive/PHASE-2-REPORT.md`.
- `docs/NINE-PRODUCT-REPRESENTATION.md` line 33: link to
  `archive/MARKETPLACE-CONSOLIDATION.md`.
- Cross-references inside archived docs: rewrite each `docs/<NAME>.md` so it
  points at the file's actual location after the move (`docs/archive/<NAME>.md`
  for archived docs, unchanged for kept docs). Markdown links use correct
  relative paths from `docs/archive/`.

### 4. Untrack scratch report

`git rm --cached .superpowers/sdd/task-1-report.md`. The file stays on disk.
The existing `.superpowers` gitignore rule prevents re-adding it.

## Out of scope

- Splitting `scripts/lib/rules.mjs`. `layer2` is about 170 lines. Revisit if it grows.
- Editing archived doc content beyond reference paths.

## Verification

1. Grep for `docs/[A-Za-z0-9-]+\.md` across the repo. Every match resolves to
   an existing file.
2. `npm run check` passes.
3. `npm test` passes.

## Commit

Single commit: `chore(docs): archive completed phase docs, untrack scratch report`.
