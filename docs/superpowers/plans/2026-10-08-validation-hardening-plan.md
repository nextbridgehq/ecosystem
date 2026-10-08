# Validation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six validation defects so that every check reports what is true, with one failing-first test per code fix.

**Architecture:** Small, local edits to `scripts/lib/io.mjs`, `scripts/lib/rules.mjs`, `scripts/validate.mjs`, `test/lib/fixture.mjs` and one CI workflow. No new modules, no schema changes. Task 1 fixes the test helper first, so the suite is green on Windows before any behaviour change.

**Tech Stack:** Node 20+, ESM, `node --test`, `node:assert/strict`, GitHub Actions bash.

**Spec:** `docs/superpowers/specs/2026-10-08-validation-hardening-design.md`

## Global Constraints

- Exit codes stay as they are: `0` clean, `1` usage/internal error, `2` validation errors or drift.
- Node keeps `versionFloor` (major-only). Only R-META4's Python branch uses `pythonFloor`.
- `.gitattributes` stays unchanged.
- Local layer 3 runs keep the `skipped` behaviour for absent checkouts. Fix 5 changes CI only.
- Out of scope: review findings 7–11 and the nits (duplicate CI test runs, unreadable-file crashes, partial sync writes, `sync.mjs` CLI flags, `plugin.manifest` path pattern, dead code at `rules.mjs:309`).
- Acceptance: `npm test` passes on Windows and Linux. `npm run check` exits 0, and `catalog.json` and `.claude-plugin/marketplace.json` are unchanged.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `pyproject.toml` with CRLF line endings. The `m` flag treats `\r\n` correctly for `^`, and `scalar()` stops at the closing quote. Expect same fields as LF. Pinned in Task 2.
2. `requires-python` with an upper bound or a list, such as `">=3.10,<4"`. `pythonFloor` reads the first number pair. Expect `"3.10"`. Pinned in Task 2.
3. Two manifest files with the same `id`. Before the fix, one silently replaced the other. Expect both to be loaded and the misnamed one reported. Covered by Task 3's test.
4. `validate` without `--repos` while layer 1 fails. Expect the existing "pass --repos-dir" skip, not the new "layer 1 failed" skip. Pinned in Task 4.
5. `patchProduct` writes LF back to a file that was CRLF. Later `gitDiffStat` in `sync-lifecycle` could show a whole-file diff on Windows. Expect that test to pass. If it fails on the diff assertion, rule on it in the ledger rather than editing the assertion.

---

### Task 1: `patchProduct` normalises CRLF (fix 6)

**Files:**
- Modify: `test/lib/fixture.mjs:82-85`
- Test: `test/sync-lifecycle.test.mjs` (existing, unchanged)

**Interfaces:**
- Consumes: nothing.
- Produces: `patchProduct(ws, repo, rel, mutate)` passes `mutate` LF-only text. Signature unchanged.

- [ ] **Step 1: Run the existing test to confirm it fails**

Run: `node --test test/sync-lifecycle.test.mjs`
Expected on a Windows `core.autocrlf=true` checkout: FAIL with `description.short block did not match the expected fixture text`. On Linux it passes already; note that in the ledger and continue.

- [ ] **Step 2: Normalise before the mutator**

In `test/lib/fixture.mjs`, replace:

```javascript
export function patchProduct(ws, repo, rel, mutate) {
  const file = join(ws.repo(repo), rel);
  writeFileSync(file, mutate(readFileSync(file, 'utf8')), 'utf8');
}
```

with:

```javascript
export function patchProduct(ws, repo, rel, mutate) {
  const file = join(ws.repo(repo), rel);
  writeFileSync(file, mutate(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')), 'utf8');
}
```

- [ ] **Step 3: Run the test to confirm it passes**

Run: `node --test test/sync-lifecycle.test.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 4: Run the full suite**

Run: `npm test > <workspace>/task1.log 2>&1; echo exit $?` and read the tail.
Expected: exit 0, 0 failures. This is the green baseline for the later tasks.

- [ ] **Step 5: Commit**

```bash
git add test/lib/fixture.mjs
git commit -m "test: normalise CRLF in patchProduct before mutating

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `readPyproject` end-of-input and `pythonFloor` (fixes 1 and 2)

**Files:**
- Modify: `scripts/lib/io.mjs:94-125`
- Modify: `scripts/lib/rules.mjs:4-7` (import), `scripts/lib/rules.mjs:369-377` (R-META4 Python branch)
- Create: `test/io.test.mjs`
- Modify: `test/drift-repository-fixture.test.mjs` (two tests after the existing R-META4 Node test, line 96)

**Interfaces:**
- Consumes: nothing.
- Produces: `pythonFloor(range: unknown): string | null`, exported from `scripts/lib/io.mjs`. Returns `"<major>.<minor>"` with minor defaulting to `0`, or `null`. `readPyproject(file)` return shape unchanged.

- [ ] **Step 1: Write the failing unit tests**

Create `test/io.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPyproject, pythonFloor } from '../scripts/lib/io.mjs';

const withPyproject = (text, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-py-'));
  try {
    const file = join(dir, 'pyproject.toml');
    writeFileSync(file, text, 'utf8');
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('readPyproject reads [project] when it is the last section', () => {
  const py = withPyproject(
    '[build-system]\nrequires = ["hatchling"]\n\n[project]\nname = "demo"\nversion = "1.0.0"\nrequires-python = ">=3.10"\n',
    readPyproject,
  );
  assert.equal(py.name, 'demo');
  assert.equal(py.version, '1.0.0');
  assert.equal(py.requiresPython, '>=3.10');
});

test('readPyproject does not stop a section at a literal Z', () => {
  const py = withPyproject(
    '[project]\nname = "demo"\ndescription = "Zero config"\nlicense = "MIT"\n\n[project.urls]\nHomepage = "https://example.com"\n',
    readPyproject,
  );
  assert.equal(py.name, 'demo');
  assert.equal(py.license, 'MIT');
  assert.equal(py.homepage, 'https://example.com');
});

test('readPyproject reads CRLF files the same as LF', () => {
  const py = withPyproject('[project]\r\nname = "demo"\r\nrequires-python = ">=3.11"\r\n', readPyproject);
  assert.equal(py.name, 'demo');
  assert.equal(py.requiresPython, '>=3.11');
});

test('pythonFloor compares major and minor', () => {
  assert.notEqual(pythonFloor('>=3.10'), pythonFloor('>=3.12'));
  assert.equal(pythonFloor('>=3.10'), '3.10');
  assert.equal(pythonFloor('>=3.10,<4'), '3.10');
});

test('pythonFloor treats a missing minor as 0', () => {
  assert.equal(pythonFloor('>=3'), pythonFloor('>=3.0'));
});

test('pythonFloor returns null for anything unreadable', () => {
  assert.equal(pythonFloor(undefined), null);
  assert.equal(pythonFloor(3.1), null);
  assert.equal(pythonFloor('any'), null);
});
```

- [ ] **Step 2: Run the unit tests to confirm they fail**

Run: `node --test test/io.test.mjs`
Expected: FAIL. The import fails with `does not provide an export named 'pythonFloor'`, so every test in the file fails.

- [ ] **Step 3: Write the failing rule tests**

In `test/drift-repository-fixture.test.mjs`, after the test `'R-META4 catches a declared Node floor the repository does not support (repocode fixture)'` (ends line 96), add:

```javascript
test('R-META4 catches a Python floor that differs only in the minor version (graphpowers fixture)', () => {
  const doc = { ...baseManifest(), id: 'graphpowers', runtime: { python: '>=3.12' } };
  const res = layer3({ registry, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(res, 'R-META4').filter((f) => f.severity === ERROR);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0].message, /3\.12/);
  assert.match(hits[0].message, /3\.9/);
});

test('R-META4 accepts a Python floor that matches requires-python (graphpowers fixture)', () => {
  const doc = { ...baseManifest(), id: 'graphpowers', runtime: { python: '>=3.9' } };
  const res = layer3({ registry, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.deepEqual(rules(res, 'R-META4'), []);
});
```

`FIXTURES_ROOT/graphpowers/pyproject.toml` declares `requires-python = ">=3.9"`.

- [ ] **Step 4: Run the rule tests to confirm the first fails**

Run: `node --test --test-name-pattern="Python floor" test/drift-repository-fixture.test.mjs`
Expected: the "differs only in the minor version" test FAILS (`0 !== 1`). The "matches" test PASSES.

- [ ] **Step 5: Fix `readPyproject` and add `pythonFloor`**

In `scripts/lib/io.mjs`, after `versionFloor` (line 103), add:

```javascript
/**
 * Lowest "major.minor" a Python range admits, so ">=3.10" and ">=3.12" differ
 * and ">=3" equals ">=3.0" (rule R-META4). Unreadable input returns null.
 */
export function pythonFloor(range) {
  if (typeof range !== 'string') return null;
  const m = range.match(/(\d+)(?:\.(\d+))?/);
  return m ? `${Number(m[1])}.${Number(m[2] ?? 0)}` : null;
}
```

In `readPyproject`, replace the section regex line:

```javascript
    const re = new RegExp(`^\\[${name.replace(/[.[\]]/g, '\\$&')}\\]([\\s\\S]*?)(?=^\\[|\\Z)`, 'm');
```

with:

```javascript
    const re = new RegExp(`^\\[${name.replace(/[.[\]]/g, '\\$&')}\\]([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm');
```

`(?![\s\S])` matches only at end of input. JavaScript has no `\Z`.

- [ ] **Step 6: Use `pythonFloor` in R-META4**

In `scripts/lib/rules.mjs`, change the import (lines 4-7) to add `pythonFloor`:

```javascript
import {
  paths, readJson, readJsonIfExists, readTextIfExists, listDir, isDir,
  collectPackageJson, normalizeRepoRef, versionFloor, pythonFloor, readPyproject,
} from './io.mjs';
```

In the R-META4 Python branch, replace:

```javascript
      const declared = versionFloor(manifest.runtime.python);
      const found = versionFloor(py?.requiresPython);
```

with:

```javascript
      const declared = pythonFloor(manifest.runtime.python);
      const found = pythonFloor(py?.requiresPython);
```

The messages already interpolate `declared` and `found`, so they now print `3.12` and `3.9`.

- [ ] **Step 7: Run both test files to confirm they pass**

Run: `node --test test/io.test.mjs test/drift-repository-fixture.test.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 8: Run the full suite and the check**

Run: `npm test > <workspace>/task2.log 2>&1; echo exit $?` and read the tail.
Expected: exit 0, 0 failures.
Run: `npm run check`
Expected: exit 0, generated files reported `unchanged`.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/io.mjs scripts/lib/rules.mjs test/io.test.mjs test/drift-repository-fixture.test.mjs
git commit -m "fix(validate): read final pyproject section, compare python minor floor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Key manifests by filename (fix 3)

**Files:**
- Modify: `scripts/lib/io.mjs:42-51`
- Modify: `test/error-contract.test.mjs` (new test after line 35)

**Interfaces:**
- Consumes: nothing.
- Produces: `loadManifests()` returns `{ [filenameWithoutYaml]: { file, doc } }`. For every correct snapshot the key equals `doc.id`, so callers (`compile.mjs`, `validate.mjs`, `rules.mjs`, tests) see no change.

- [ ] **Step 1: Write the failing test**

In `test/error-contract.test.mjs`, after the test `'exit code 2 means validation errors or drift'` (ends line 35), add:

```javascript
test('a manifest whose id does not match its filename is a schema error', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'manifests/misnamed.yaml', readFixture(ws, 'manifests/graphpowers.yaml'));
    const r = run(ws, ['scripts/validate.mjs', '--json']);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    const hits = JSON.parse(r.stdout).errors.filter((f) => f.rule === 'R-SCHEMA');
    assert.ok(hits.some((f) => f.subject === 'manifests/misnamed.yaml'), JSON.stringify(hits));
  } finally { ws.cleanup(); }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test --test-name-pattern="does not match its filename" test/error-contract.test.mjs`
Expected: FAIL with exit code `0 !== 2`. Both files share `id: graphpowers`, so one silently replaces the other.

- [ ] **Step 3: Key by filename**

In `scripts/lib/io.mjs`, replace:

```javascript
/** Every product manifest currently synced into manifests/, keyed by product id. */
export function loadManifests() {
  const out = {};
  for (const file of listDir(paths.manifests)) {
    if (!file.endsWith('.yaml')) continue;
    const doc = readYaml(join(paths.manifests, file));
    out[doc?.id ?? file.replace(/\.yaml$/, '')] = { file, doc };
  }
  return out;
}
```

with:

```javascript
/**
 * Every product manifest currently synced into manifests/, keyed by filename
 * without `.yaml`. Layer 1 reports any manifest whose id differs from its key.
 */
export function loadManifests() {
  const out = {};
  for (const file of listDir(paths.manifests)) {
    if (!file.endsWith('.yaml')) continue;
    out[file.replace(/\.yaml$/, '')] = { file, doc: readYaml(join(paths.manifests, file)) };
  }
  return out;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `node --test --test-name-pattern="does not match its filename" test/error-contract.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite and the check**

Run: `npm test > <workspace>/task3.log 2>&1; echo exit $?` and read the tail.
Expected: exit 0, 0 failures.
Run: `npm run check`
Expected: exit 0, generated files `unchanged`.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/io.mjs test/error-contract.test.mjs
git commit -m "fix(validate): key manifests by filename so id mismatches are reported

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Skip layer 3 when layer 1 fails (fix 4)

**Files:**
- Modify: `scripts/validate.mjs:31-41`
- Modify: `test/error-contract.test.mjs` (two tests after Task 3's test)

**Interfaces:**
- Consumes: Task 3's `loadManifests()` (unchanged shape).
- Produces: when layer 1 has errors and a repos directory is given, findings include `{ rule: 'R-REPO', severity: 'skipped', subject: 'layer 3', message: 'not run - layer 1 failed' }` and no layer 3 findings.

- [ ] **Step 1: Write the failing tests**

In `test/error-contract.test.mjs`, after the test added in Task 3, add:

```javascript
test('a structurally broken manifest reports its schema error instead of crashing layer 3', () => {
  const ws = makeWorkspace({ products: ['graphpowers'] });
  try {
    const original = readFixture(ws, 'manifests/graphpowers.yaml');
    const broken = original.replace(/^    path: \.\n/m, '');
    assert.notEqual(broken, original, 'fixture no longer has a plugin path line to remove');
    writeFixture(ws, 'manifests/graphpowers.yaml', broken);

    const r = run(ws, ['scripts/validate.mjs', '--repos', '..', '--json']);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.errors.some((f) => f.rule === 'R-SCHEMA'), JSON.stringify(out.errors));
    assert.ok(
      out.skipped.some((f) => f.rule === 'R-REPO' && f.subject === 'layer 3' && /layer 1 failed/.test(f.message)),
      JSON.stringify(out.skipped),
    );
  } finally { ws.cleanup(); }
});

test('without --repos, a layer 1 failure still reports the usual layer 3 skip', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'manifests/misnamed.yaml', readFixture(ws, 'manifests/graphpowers.yaml'));
    const out = JSON.parse(run(ws, ['scripts/validate.mjs', '--json']).stdout);
    const skip = out.skipped.filter((f) => f.rule === 'R-REPO' && f.subject === 'layer 3');
    assert.equal(skip.length, 1, JSON.stringify(skip));
    assert.match(skip[0].message, /--repos-dir/);
  } finally { ws.cleanup(); }
});
```

- [ ] **Step 2: Run them to confirm the first fails**

Run: `node --test --test-name-pattern="layer 3" test/error-contract.test.mjs`
Expected: "structurally broken manifest" FAILS with exit code `1 !== 2` (layer 3 throws `TypeError` on `plugin.path.replace`). "without --repos" PASSES: it pins behaviour that must not change.

- [ ] **Step 3: Gate layer 3 on layer 1**

In `scripts/validate.mjs`, replace:

```javascript
  findings = [...layer1({ registry, taxonomy, manifests })];
  // Layer 2 assumes layer 1 held; running it on a structurally broken document
  // produces noise rather than information.
  if (!findings.some((f) => f.severity === ERROR)) {
    findings.push(...layer2({ registry, taxonomy, manifests }));
  }
  if (reposDir !== null) {
    findings.push(...layer3({ registry, manifests, reposDir: resolve(reposDir) }));
  } else {
```

with:

```javascript
  findings = [...layer1({ registry, taxonomy, manifests })];
  // Layers 2 and 3 assume layer 1 held; running them on a structurally broken
  // document produces noise, or a crash, rather than information.
  const structural = findings.some((f) => f.severity === ERROR);
  if (!structural) {
    findings.push(...layer2({ registry, taxonomy, manifests }));
  }
  if (reposDir !== null && structural) {
    findings.push({ rule: 'R-REPO', severity: SKIP, subject: 'layer 3', message: 'not run - layer 1 failed' });
  } else if (reposDir !== null) {
    findings.push(...layer3({ registry, manifests, reposDir: resolve(reposDir) }));
  } else {
```

The final `else` branch (the existing "pass --repos-dir" skip) is unchanged.

- [ ] **Step 4: Run them to confirm both pass**

Run: `node --test --test-name-pattern="layer 3" test/error-contract.test.mjs`
Expected: PASS, both.

- [ ] **Step 5: Run the full suite and the check**

Run: `npm test > <workspace>/task4.log 2>&1; echo exit $?` and read the tail.
Expected: exit 0, 0 failures.
Run: `npm run check`
Expected: exit 0, generated files `unchanged`.

- [ ] **Step 6: Commit**

```bash
git add scripts/validate.mjs test/error-contract.test.mjs
git commit -m "fix(validate): skip layer 3 when layer 1 reports structural errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fail repo-consistency CI on a clone failure (fix 5)

**Files:**
- Modify: `.github/workflows/repo-consistency.yml:36-53`

**Interfaces:**
- Consumes: nothing.
- Produces: the "Check out the indexed product repositories" step exits `1` if any clone failed, after trying every repository.

No automated test (spec: "Verify by reading the diff").

- [ ] **Step 1: Edit the step**

Replace:

```yaml
      # Shallow clone every indexed product. A repository that cannot be
      # cloned produces a `skipped` finding rather than a false pass.
```

with:

```yaml
      # Shallow clone every indexed product. A clone failure fails the job:
      # layer 3 against a missing checkout would only report `skipped` and pass.
      # Every repository is tried first so the log lists all failures.
```

and replace:

```yaml
          for repo in $repos; do
            name="${repo##*/}"
            if [ -d "$name" ]; then continue; fi
            gh repo clone "$repo" "$name" -- --depth 1 || echo "::warning::could not clone $repo"
          done
```

with:

```yaml
          failed=0
          for repo in $repos; do
            name="${repo##*/}"
            if [ -d "$name" ]; then continue; fi
            if ! gh repo clone "$repo" "$name" -- --depth 1; then
              echo "::error::could not clone $repo"
              failed=1
            fi
          done
          exit "$failed"
```

`if !` keeps `set -e` from stopping the loop at the first failure.

- [ ] **Step 2: Verify the YAML parses and the diff is only this step**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/repo-consistency.yml','utf8')); console.log('ok')"`
Expected: `ok`.
Run: `git diff --stat`
Expected: one file, `.github/workflows/repo-consistency.yml`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/repo-consistency.yml
git commit -m "ci: fail repo-consistency when a product repository cannot be cloned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
