# Docs Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move completed phase docs to `docs/archive/`, fix every reference to them, and untrack a stray scratch report.

**Architecture:** Pure file moves (`git mv`) plus link-path edits in Markdown. No code, schema, or test changes. A one-off Node link check proves every relative Markdown link and every backticked `docs/...md` path resolves.

**Tech Stack:** git, Node 20+, `npm run check`, `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-07-docs-cleanup-design.md`

## Global Constraints

- No changes under `scripts/`, `schema/`, `test/`, `manifests/`, `registry.yaml`, `taxonomy/`, or generated files.
- Archived doc content changes only in reference paths. No prose edits.
- Use `git mv` for every move so history follows.
- `.superpowers/sdd/task-1-report.md` stays on disk; only the index entry goes.
- Single commit: `chore(docs): archive completed phase docs, untrack scratch report`.

## Review Focus

1. Relative links inside archived docs that pointed at kept docs (`ADDING-A-PRODUCT.md`, `SCHEMA-FREEZE.md`) now need `../`. Expect them to resolve.
2. Links inside archived docs that pointed at `../manifests/README.md` now need `../../manifests/README.md`.
3. A kept doc (`NINE-PRODUCT-REPRESENTATION.md`) links to an archived doc. Expect it to resolve.
4. Links with `#anchor` suffixes keep the anchor unchanged.
5. Backticked `docs/<NAME>.md:<line>` citations in `PHASE-3-GATE-1-REPO-PUSH-SPEC.md` name the archive path for archived targets and stay unchanged for kept targets.

The link check (Step 1) covers items 1–3 and 5. Item 4: the check strips anchors before resolving, and Step 4 edits only the path part.

---

### Task 1: Archive docs, fix references, untrack scratch report

**Files:**
- Move: `docs/G1-IMPLEMENTATION-PLAN.md` → `docs/archive/G1-IMPLEMENTATION-PLAN.md`
- Move: `docs/G1-METADATA-SCOPING-SPEC.md` → `docs/archive/G1-METADATA-SCOPING-SPEC.md`
- Move: `docs/PHASE-2-SPEC.md` → `docs/archive/PHASE-2-SPEC.md`
- Move: `docs/PHASE-2-REPORT.md` → `docs/archive/PHASE-2-REPORT.md`
- Move: `docs/PHASE-3-GATE-1-REPO-PUSH-SPEC.md` → `docs/archive/PHASE-3-GATE-1-REPO-PUSH-SPEC.md`
- Move: `docs/PHASE-3-GRAPHPOWERS-HOOKS-FIX-SPEC.md` → `docs/archive/PHASE-3-GRAPHPOWERS-HOOKS-FIX-SPEC.md`
- Move: `docs/MARKETPLACE-CONSOLIDATION.md` → `docs/archive/MARKETPLACE-CONSOLIDATION.md`
- Modify: `README.md:168-169`
- Modify: `docs/NINE-PRODUCT-REPRESENTATION.md:33`
- Modify (after move): `docs/archive/PHASE-2-REPORT.md`, `docs/archive/PHASE-2-SPEC.md`, `docs/archive/G1-IMPLEMENTATION-PLAN.md`, `docs/archive/PHASE-3-GATE-1-REPO-PUSH-SPEC.md`
- Untrack: `.superpowers/sdd/task-1-report.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/archive/` with seven files; zero broken doc links.

- [ ] **Step 1: Save the link check and run it as baseline (expect PASS)**

Write to the session scratchpad as `linkcheck.mjs` (do not commit it):

```javascript
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const files = ['README.md'];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.md')) files.push(p);
  }
})('docs');

const broken = [];
for (const f of files) {
  if (f.replaceAll('\\', '/').startsWith('docs/superpowers/')) continue;
  const text = readFileSync(f, 'utf8');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
    if (!existsSync(resolve(dirname(f), target.split('#')[0]))) broken.push(`${f}: ](${target})`);
  }
  for (const [, path] of text.matchAll(/`(?:ecosystem\/)?(docs\/[A-Za-z0-9\/-]+\.md)(?::\d+)?`/g)) {
    if (!existsSync(path)) broken.push(`${f}: \`${path}\``);
  }
}
console.log(broken.length ? broken.join('\n') : 'OK: all doc links resolve');
process.exit(broken.length ? 1 : 0);
```

`docs/superpowers/` is skipped: its specs and plans quote example paths that are not live links.

Run from repo root: `node <scratchpad>/linkcheck.mjs`
Expected: `OK: all doc links resolve`. If it fails before any change, stop and report: the baseline is already broken.

- [ ] **Step 2: Move the seven docs**

```bash
mkdir -p docs/archive
git mv docs/G1-IMPLEMENTATION-PLAN.md docs/G1-METADATA-SCOPING-SPEC.md \
  docs/PHASE-2-SPEC.md docs/PHASE-2-REPORT.md \
  docs/PHASE-3-GATE-1-REPO-PUSH-SPEC.md docs/PHASE-3-GRAPHPOWERS-HOOKS-FIX-SPEC.md \
  docs/MARKETPLACE-CONSOLIDATION.md docs/archive/
```

- [ ] **Step 3: Run the link check (expect FAIL)**

Run: `node <scratchpad>/linkcheck.mjs`
Expected: exit 1. Broken entries include `README.md: ](docs/PHASE-2-SPEC.md)`, `docs/NINE-PRODUCT-REPRESENTATION.md: ](MARKETPLACE-CONSOLIDATION.md)`, `docs/archive/PHASE-2-REPORT.md: ](ADDING-A-PRODUCT.md)`, and backticked paths in `docs/archive/PHASE-3-GATE-1-REPO-PUSH-SPEC.md`.

- [ ] **Step 4: Fix references**

`README.md` lines 168–169, replace:
```markdown
- [docs/PHASE-2-SPEC.md](docs/PHASE-2-SPEC.md) and
  [docs/PHASE-2-REPORT.md](docs/PHASE-2-REPORT.md) — the hardening phase.
```
with:
```markdown
- [docs/archive/PHASE-2-SPEC.md](docs/archive/PHASE-2-SPEC.md) and
  [docs/archive/PHASE-2-REPORT.md](docs/archive/PHASE-2-REPORT.md) — the hardening phase.
```

`docs/NINE-PRODUCT-REPRESENTATION.md` line 33: `](MARKETPLACE-CONSOLIDATION.md)` → `](archive/MARKETPLACE-CONSOLIDATION.md)`.

`docs/archive/PHASE-2-REPORT.md` (every occurrence, anchors kept):
- `](ADDING-A-PRODUCT.md` → `](../ADDING-A-PRODUCT.md` (lines 116, 371, 382, 395, 631)
- `](SCHEMA-FREEZE.md)` → `](../SCHEMA-FREEZE.md)` (line 689)
- `](../manifests/README.md)` → `](../../manifests/README.md)` (lines 110, 675)

`docs/archive/PHASE-2-SPEC.md` line 46: `](SCHEMA-FREEZE.md)` → `](../SCHEMA-FREEZE.md)`.

`docs/archive/G1-IMPLEMENTATION-PLAN.md` line 22: `ecosystem/docs/G1-METADATA-SCOPING-SPEC.md` → `ecosystem/docs/archive/G1-METADATA-SCOPING-SPEC.md`.

`docs/archive/PHASE-3-GATE-1-REPO-PUSH-SPEC.md`:
- lines 31 and 86: `docs/PHASE-2-REPORT.md:190` → `docs/archive/PHASE-2-REPORT.md:190`
- lines 32 and 95: `docs/PHASE-2-SPEC.md:179` → `docs/archive/PHASE-2-SPEC.md:179`
- lines 33–34 (`NINE-PRODUCT-REPRESENTATION.md`, `SCHEMA-FREEZE.md`): unchanged, both are kept docs.

Same-folder links between archived docs stay unchanged.

- [ ] **Step 5: Run the link check (expect PASS)**

Run: `node <scratchpad>/linkcheck.mjs`
Expected: `OK: all doc links resolve`.

- [ ] **Step 6: Untrack the scratch report**

```bash
git rm --cached .superpowers/sdd/task-1-report.md
git check-ignore -v .superpowers/sdd/task-1-report.md
```
Expected: second command prints the matching `.gitignore` rule. File still exists on disk.

- [ ] **Step 7: Run repo checks**

Run: `npm run check` — expected exit 0.
Run: `npm test` — expected all pass, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/NINE-PRODUCT-REPRESENTATION.md docs/archive docs/superpowers
git status --short
git commit -m "chore(docs): archive completed phase docs, untrack scratch report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected `git status --short` before commit: seven `R` renames into `docs/archive/`, `M README.md`, `M docs/NINE-PRODUCT-REPRESENTATION.md`, `M` spec, `A` this plan, `D .superpowers/sdd/task-1-report.md`. Nothing else.
