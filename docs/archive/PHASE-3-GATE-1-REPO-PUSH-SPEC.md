# Phase 3, Gate 1 — Establish the Real Ecosystem Repository (Spec)

Status: approved, execution pending. First workstream of Phase 3 — Production
GitHub / Ecosystem Verification, gated ahead of Gate 2 (real GitHub Actions
execution), Gate 3 (scheduled automation), Gate 4 (governance/branch
protection), Gate 5 (automated `verify:clean-env`), and O2 (maturity model).

## Why this is its own spec, not part of a five-gate plan

Phase 2's own recurring finding — *implementation is ground truth, the plan
is a hypothesis* — applies directly here. Gates 2–5 depend on observing a
real GitHub repository that does not exist yet: real Actions permissions,
real token behavior, real workflow trigger timing. Designing them now would
repeat the exact mistake Phase 2 avoided. Gate 1 is scoped alone; each
subsequent gate gets its own spec, written after inspecting what Gate 1
actually produced.

## Context established before writing this spec

- `gh repo list nextbridgehq` confirmed no `ecosystem` repo exists yet in the
  org. (It also listed `reporise`, `viscraft`, `packalytics` — not among the
  9 registry products, unrelated, ignored.)
- `ecosystem/.gitignore` already excludes `node_modules/`.
- `.claude/` contains exactly one file: `.claude/handoff/latest.md` — a
  session-internal Phase 2 task-tracking artifact (mentions the local
  `D:\Projects\mini projects\nextbridge-ecosystem` path and internal workflow
  instructions). Not repository documentation.
- A grep for local paths/username across tracked-looking files found 4 hits
  in `.md` files. Inspected individually, only 2 are genuine local filesystem
  leaks:
  - `docs/archive/PHASE-2-REPORT.md:190` — `C:\Users\saadat\AppData\Local\Temp\nb-claude-FPymBK\...`, inside a quoted `verify:clean-env` error transcript.
  - `docs/archive/PHASE-2-SPEC.md:179` — `C:\Users\saadat\graphpowers`, a local dev-machine path.
  - The other 2 hits (`docs/NINE-PRODUCT-REPRESENTATION.md:119`,
    `docs/SCHEMA-FREEZE.md:70`) mention `saadat-dev` as a **GitHub username
    that was itself a real, already-public defect** — the wrong repository
    owner R-META1 caught in `project-charter`'s actual `pyproject.toml`. Not
    a local filesystem leak. Redacting these would erase documented evidence
    of a real bug, which is exactly the scope creep this spec must avoid —
    **these two are explicitly left untouched.**
- A broader secret scan (`api_key`/`secret`/`password`/`token`-shaped
  strings, `ghp_`/`gho_`/AWS-key patterns) across the tree, excluding
  `node_modules/`, found nothing.
- `validate.yml` and `repo-consistency.yml` both trigger on `push: branches:
  [main]`. `repo-consistency.yml`'s repository-clone step uses
  `secrets.ECOSYSTEM_READ_TOKEN || github.token` — falls back to the default
  Actions token when the secret isn't configured, and all 9 product
  repositories are public, so cloning should succeed even before any
  Gate 4 secret setup. This means the first push will **automatically**
  produce real evidence toward Gate 2, as a side effect — this spec records
  that evidence but does not act on it (see Non-goals).

## Scope

1. Redact exactly the 2 genuine local-path lines identified above, with
   generic placeholders that preserve each sentence's meaning.
2. Add `.claude/` to `.gitignore`.
3. Re-run the full local baseline after the edits — must be unchanged from
   the documented Phase 2 baseline (doc-only edit, no script/schema/manifest
   touched).
4. Create `nextbridgehq/ecosystem`, public.
5. `git init` this directory, one commit, push to `main`.
6. Confirm the pushed repository's file tree and default branch. Check once
   whether `validate.yml`/`repo-consistency.yml` fired on the push and
   record pass/fail/pending — do not debug a failure here (see Non-goals).
7. Stop. Report repo URL, commit SHA, workflow evidence.

## Non-goals

- No workflow, schema, manifest, or script changes.
- No fixing anything discovered only by inspection unless it blocks Gate 1
  itself (i.e., the 2 genuine path redactions are in-scope; nothing else
  found during hygiene review is).
- No wording/rewording pass on the 4 flagged docs beyond the 2 exact
  redactions — this is not a documentation cleanup task.
- No debugging a Gate-2-relevant workflow failure if the automatic first-push
  run fails. Record it as input to Gate 2's own spec instead.
- No git initialization or push of any of the 9 product directories — only
  `ecosystem/` itself. (`graphpowers/` already had its own separate,
  pre-existing git history from the earlier upstream-fix task; that is
  unrelated to this gate and untouched by it.)
- No `ECOSYSTEM_READ_TOKEN` secret creation, no branch protection, no
  required-checks configuration — that is Gate 4.

## Workflow

1. **Redact — `docs/archive/PHASE-2-REPORT.md:190`:**
   Change
   `` `Error: Hook load failed: Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file C:\Users\saadat\AppData\Local\Temp\nb-claude-FPymBK\plugins\cache\nextbridge\graphpowers\0.3.1\hooks\hooks.json. ...` ``
   to the same line with the absolute path replaced by
   `<CLAUDE_CONFIG_DIR>\plugins\cache\nextbridge\graphpowers\0.3.1\hooks\hooks.json`
   — matches how `verify-clean-env.mjs` itself describes the isolated
   directory (`CLAUDE_CONFIG_DIR` env var), so the substitution is accurate,
   not just generic.

2. **Redact — `docs/archive/PHASE-2-SPEC.md:179`:**
   Change `` `C:\Users\saadat\graphpowers` `` to
   `` `<local dev machine>\graphpowers` `` — preserves the sentence's meaning
   (a separate, stale local install existed and was noted but not acted on).

3. **`.gitignore`:** append `.claude/` as its own line.

4. **Re-run baseline**, from `ecosystem/`:
   ```
   node scripts/validate.mjs --repos ..
   node scripts/compile.mjs --check
   node scripts/sync.mjs --repos .. --check
   npm test
   ```
   Must match the documented Phase 2 baseline exactly (`0 error(s), 0
   warning(s), 1 skipped`; both artifacts `unchanged`; all 9 products
   `unchanged`; `115/115` pass — 115, not 111, since G1's tests are now
   part of the suite). If anything differs, **stop** — the doc edits should
   be inert; a baseline change means something unexpected happened.

5. **Initialize git first** — `gh repo create --source=.` requires the
   source path to already be a git repository:
   ```
   git init -b main
   ```
   `-b main` sets the initial branch name explicitly, independent of whatever
   the local git config's default happens to be.

6. **Create the repository and attach it as the remote:**
   ```
   gh repo create nextbridgehq/ecosystem --public \
     --description "Nextbridge plugin ecosystem: registry, taxonomy, and generated Claude Code marketplace" \
     --source=. --remote=origin
   ```
   `--source=.` without `--push` creates the empty remote and configures
   `origin` locally — it does not push (`--push` is the flag that would).
   Commit content is still prepared and reviewed before anything leaves the
   machine.

7. **Review what will be committed, commit, push:**
   ```
   git add -A
   git status
   ```
   Read the full `git status` output before committing. Confirm:
   - `node_modules/` absent.
   - `.claude/` absent (now gitignored).
   - No file outside `ecosystem/`'s own tree is staged (this command must be
     run from inside `ecosystem/`, not the project root — the 9 product
     directories and other project-root files must never appear here).

   Then:
   ```
   git commit -m "Establish nextbridge ecosystem repository

   Publishes the validated state of the Nextbridge plugin ecosystem:
   registry, taxonomy, product manifests, generated catalog and marketplace,
   validation/sync/compile tooling, and CI workflows. Phases 0-2 complete
   (see docs/), including G1 per-package metadata scoping and the graphpowers
   upstream release-blocker fix. 115/115 tests passing; validate/compile/sync
   all clean against the 9 real product repositories."
   git push -u origin main
   ```

8. **Verify:**
   ```
   gh repo view nextbridgehq/ecosystem --json defaultBranchRef,pushedAt
   ```
   Confirm default branch is `main`. Then, once (not polling repeatedly):
   ```
   gh run list --repo nextbridgehq/ecosystem --limit 5
   ```
   Record whatever it shows — success, failure, or not-yet-started (Actions
   can take a short while to register on a brand-new repo). Do not iterate
   on a failure; record it for Gate 2. This is observation only: even a
   green result here does not mean Gate 2 is passed — Gate 2 gets its own
   spec and decides what "real Actions verification" fully requires.

9. **Stop.** Report: repository URL, commit SHA, `git status` summary
   confirming clean scope, baseline re-verification result, and the workflow
   run evidence from step 8.
