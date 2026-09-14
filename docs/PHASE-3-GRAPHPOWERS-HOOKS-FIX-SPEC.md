# Phase 3 — graphpowers Upstream Hooks Fix (Spec)

Status: PR opened, awaiting merge — [nextbridgehq/graphpowers#5](https://github.com/nextbridgehq/graphpowers/pull/5).
Closes the release blocker recorded in
[PHASE-2-REPORT.md](PHASE-2-REPORT.md#release-blocker--graphpowersnextbridge-does-not-install-cleanly)
once merged and released. Not yet re-verified — that's the separate
post-merge gate below, not run yet.

## The defect

`nextbridgehq/graphpowers`'s `.claude-plugin/plugin.json` declares
`"hooks": "./hooks/hooks.json"`, which Claude Code already loads by
convention. This causes `claude plugin install` to fail with "Duplicate hooks
file detected" on a clean install — proved live by
`npm run verify:clean-env` in Phase 2 (see the report's Release Blocker
section). The fix was already applied and merged into the **local** working
copy during Phase 1.5, but never reached the real upstream repository — a
regression of an applied-but-unpublished fix, not a new defect.

Mechanically confirmed before this spec was written:

- `graphpowers/` (sibling of `ecosystem/` under the project root) **is** a
  real git working copy — `origin` = `https://github.com/nextbridgehq/graphpowers.git`
  — but was 5 commits stale.
- After `git fetch origin main`: `origin/main` HEAD is
  `45bbf22816d2f1e98e44d2c0a0e34f9799ed7539` — the exact commit
  `PHASE-2-REPORT.md` cites.
- `git show origin/main:.claude-plugin/plugin.json` (and independently,
  `gh api repos/nextbridgehq/graphpowers/contents/.claude-plugin/plugin.json`)
  both confirm the `"hooks"` line is still present on `origin/main` today.
- `gh auth status` confirms an authenticated `nextbridgehq` account with
  `repo` + `workflow` scopes.

## Scope

- One file: `graphpowers/.claude-plugin/plugin.json`.
- One line removed: `"hooks": "./hooks/hooks.json",`.
- One PR opened against `nextbridgehq/graphpowers`, base `main`.

**Non-goals:**
- No manual version bump — `graphpowers` uses `release-please.yml`; version
  bumps come from release-please's own release PR after this fix merges.
- No other file in `graphpowers` touched.
- No changes anywhere in `ecosystem/`.
- **No merge.** This task opens the PR and stops. Merging it, and later
  merging release-please's resulting release PR, are the user's actions.
- No push to `main` directly — push goes to a feature branch only.

## Workflow

Executed directly against the real `graphpowers/` working copy (no scratch
clone — it's already the correct git working copy, just was stale).

1. **Sync:** `git pull --ff-only origin main`. Safe — working tree was
   already clean, pure fast-forward, 5 commits.

2. **Verify the defect is present on the pulled `main`, before editing anything:**
   - Confirm `45bbf22816d2f1e98e44d2c0a0e34f9799ed7539` is an ancestor of
     (or equal to) the now-pulled local `main` HEAD
     (`git merge-base --is-ancestor 45bbf22816d2f1e98e44d2c0a0e34f9799ed7539 HEAD`).
   - Confirm the working tree's `.claude-plugin/plugin.json` still contains
     `"hooks": "./hooks/hooks.json"` after the pull.
   - If either check fails, **stop** — the premise this spec was written
     against no longer holds, and the defect needs re-diagnosis before any
     edit.

3. **Branch:** `git checkout -b fix/remove-redundant-hooks-declaration`.

4. **Fix:** remove exactly the one line
   `"hooks": "./hooks/hooks.json",` from `.claude-plugin/plugin.json`.

5. **Prove the diff is exactly a one-line removal, before commit:**
   - `.claude-plugin/plugin.json` still parses as valid JSON
     (`node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'))"`
     or equivalent).
   - `git diff --check` passes (no whitespace errors).
   - `git diff` contains **only** the removal of the `"hooks"` line — no
     version bump, no lockfile change, no reformatting, no other file
     touched. Confirm via `git diff --stat` (exactly one file) and a full
     read of `git diff`.
   - If the diff contains anything beyond that one removed line, **stop** and
     fix the working tree before committing — do not commit an unreviewed
     diff.

6. **Commit:** `git commit -m "fix: remove redundant hooks declaration from plugin.json"`
   — matches the repository's own established Angular-style convention
   (confirmed from `git log`: `fix: ...`, `feat: ...`,
   `chore(main): release ...`), so release-please picks it up correctly as a
   patch-level fix in its next release PR.

7. **Push:** `git push origin fix/remove-redundant-hooks-declaration` — a
   feature branch, never `main`.

8. **Open PR:** `gh pr create` against `nextbridgehq/graphpowers`, base
   `main`, head `fix/remove-redundant-hooks-declaration`. Body states: the
   defect, the exact commit where it's confirmed present, that this is a
   regression of a fix already merged locally in Phase 1.5 but never
   published, and a pointer to `PHASE-2-REPORT.md`'s Release Blocker section
   for full context.

9. **Stop.** Report the PR URL. Do not merge. Do not touch `ecosystem/`.

## Separate, later, post-merge verification gate (not part of this task)

Only after the user has merged both this PR **and** release-please's
resulting release PR:

```
npm run verify:clean-env
```

run from `ecosystem/`, must exit 0 with `graphpowers@nextbridge` reported as
loaded successfully — closing 🔴 marketplace-release-ready. This is a
separate, explicitly later action, not executed as part of this spec.
