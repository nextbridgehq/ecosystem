# G1 — Per-Package Metadata Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close gap G1 — R-META1/R-META3/R-META4(node) currently pass a monorepo
when a healthy sibling package.json masks a drifted declared package. Make
each declared npm package independently authoritative for these three checks.

**Architecture:** In `layer3` of `ecosystem/scripts/lib/rules.mjs`, compute
`declaredNpm` (the Set of package names from `manifest.distribution[channel=npm].packages`)
once per product. When non-empty, R-META1/R-META3/R-META4-node switch to a
**strict branch**: loop only over `pkgs` entries whose name is in `declaredNpm`,
validate each independently, emit one finding per disagreeing package — no
`Set`/any-of collapsing. When `declaredNpm` is empty, fall through to the
existing any-of implementation, byte-for-byte unchanged. R-META2, the Python
branches, the LICENSE-file `WARN`, and `io.mjs` are not touched.

**Tech Stack:** Node.js (`node --test`), no new dependencies.

## Global Constraints

- Spec of record: `ecosystem/docs/archive/G1-METADATA-SCOPING-SPEC.md`. Every task
  below implements exactly what it says — do not improve, generalize, or move
  filtering into `collectPackageJson`.
- `declaredNpm` membership is **exact string equality**, no normalization.
- Strict mode: **no `Set` collapsing** — every declared package with the
  relevant field gets independently checked; a mismatch in one package must
  not be suppressed by a healthy sibling, and two bad siblings must produce
  two findings.
- Fallback mode (`declaredNpm.size === 0`) must remain byte-for-byte
  *equivalent in observable behavior* to the current implementation: same
  candidate set, same ordering, same normalization, same finding messages,
  same semantics. This does not mean preserving exact source formatting —
  Task 2 necessarily restructures the surrounding code into if/else branches.
- R-META3 has no `SKIP` severity today and must not gain one in strict mode —
  zero declared packages carrying `license` means silent pass, same as today.
- **This repository has no local git init** (deliberate, see
  `PHASE-2-REPORT.md` → Architectural decisions). There is no `git commit`
  step anywhere in this plan — every task ends by re-running the relevant
  test command(s) instead, per the project's own Phase 2 practice.
- Full Phase 2 baseline (must stay green at the end): from `ecosystem/`,
  `node scripts/validate.mjs --repos ..` (exit 0), `node scripts/compile.mjs --check`
  (exit 0), `node scripts/sync.mjs --repos .. --check` (exit 0), `npm test`
  (all pass, count rises from 111 to 115).

---

### Task 1: Write the four failing tests against today's any-of behavior

**Files:**
- Modify: `ecosystem/test/drift-repository.test.mjs` (append after the
  existing R-META4 block, before the "The repository going away entirely"
  section, i.e. after line 152 / before line 154 of the current file)

**Interfaces:**
- Consumes: `findings(ws)` and `errorsFor(f, id)` helpers already defined at
  the top of this file (lines 9–15); `makeWorkspace`, `patchJson` from
  `./lib/fixture.mjs`, already imported at the top of this file.
- Produces: nothing new for later tasks — these are terminal test cases that
  Task 2's implementation must satisfy.

These four tests exercise the `repocode` fixture, which declares three npm
packages (`repocode`, `@repocode/core`, `@repocode/mcp`) each with its own
`repository`, `license`, and `engines.node` field (confirmed on disk). Against
today's unmodified `rules.mjs`, all four **must fail** — that failure is the
proof that the masking bug is real and exactly as described in G1.

- [ ] **Step 1: Add the four new tests**

Insert this block into `ecosystem/test/drift-repository.test.mjs`, immediately
after the `R-META4 treats ">=18" and ">=18.0.0" as the same floor` test (which
ends at line 152) and before the `/* ── R-META5: the CI claim behind "stable" ── */`
comment (line 154):

```js
/* ── G1: per-package independent validation (no any-of masking) ────────── */

// G1: repocode declares three independent npm packages (repocode,
// @repocode/core, @repocode/mcp), each with its own repository/license/
// engines.node field. Mutating only @repocode/core must not be maskable by
// its healthy siblings. Against today's any-of Set-based check, each of
// these four tests currently produces ZERO findings — that is the gap this
// plan closes. Once rules.mjs implements strict per-package validation
// (Task 2), each test's real assertions below must pass.

test('R-META1 catches one declared sibling package disagreeing on repository even when the others agree', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({
      ...p, repository: { type: 'git', url: 'https://github.com/someone-else/repocode.git' },
    }));
    const hits = errorsFor(findings(ws), 'R-META1');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /@repocode\/core/);
    assert.match(hits[0].message, /someone-else\/repocode/);
    assert.doesNotMatch(hits[0].message, /"repocode"/);
    assert.doesNotMatch(hits[0].message, /@repocode\/mcp/);
  } finally {
    ws.cleanup();
  }
});

test('R-META3 catches one declared sibling package disagreeing on licence even when the others agree', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, license: 'Apache-2.0' }));
    const hits = errorsFor(findings(ws), 'R-META3');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /@repocode\/core/);
    assert.match(hits[0].message, /Apache-2\.0/);
    assert.doesNotMatch(hits[0].message, /@repocode\/mcp/);
  } finally {
    ws.cleanup();
  }
});

test('R-META4 catches one declared sibling package disagreeing on runtime floor even when the others agree', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, engines: { ...p.engines, node: '>=18.0.0' } }));
    const hits = errorsFor(findings(ws), 'R-META4');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /@repocode\/core/);
    assert.match(hits[0].message, /18/);
    assert.doesNotMatch(hits[0].message, /@repocode\/mcp/);
  } finally {
    ws.cleanup();
  }
});

test('R-META3 reports two independent errors when two declared sibling packages both disagree on licence', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, license: 'Apache-2.0' }));
    patchJson(ws, 'repocode', 'packages/mcp/package.json', (p) => ({ ...p, license: 'Apache-2.0' }));
    const hits = errorsFor(findings(ws), 'R-META3');
    assert.equal(hits.length, 2, JSON.stringify(hits));
    const named = hits.map((h) => h.message).join('\n');
    assert.match(named, /@repocode\/core/);
    assert.match(named, /@repocode\/mcp/);
  } finally {
    ws.cleanup();
  }
});
```

- [ ] **Step 2: Run the new tests and verify all four fail**

Run from `ecosystem/`:

```bash
node --test test/drift-repository.test.mjs
```

Expected: the four new tests **FAIL**. Each failure should be an
`assert.equal(hits.length, 1, ...)` (or `2, ...`) failure showing `hits.length
=== 0` — confirming today's any-of check produces zero findings for a single
drifted sibling, exactly as G1 describes. Do not assume this — paste the
actual `node --test` failure output for all four tests (or note verbatim if
one fails differently than expected, and stop to investigate before
continuing). In particular, the two-sibling test must be confirmed to fail
with `hits.length === 0`, not merely assumed to — `repocode` (cli) staying at
`MIT` is what keeps it in today's `Set`, but that must be observed, not
inferred. All pre-existing tests in this file
(the six R-META1/R-META3/R-META4/R-META5 tests above, plus the "missing
repository" test) must still **PASS** — this proves Task 1 only added tests
and touched no implementation code.

- [ ] **Step 3: No commit**

This repository has no local git init (see Global Constraints). Leave the
four new failing tests in place; Task 2 makes them pass.

---

### Task 2: Implement strict per-package validation in rules.mjs

**Files:**
- Modify: `ecosystem/scripts/lib/rules.mjs:257-321` (the R-META1, R-META3, and
  R-META4-node sections of `layer3`)

**Interfaces:**
- Consumes: `pkgs` (array of `{ path, json }`, from `collectPackageJson`),
  `manifest` (the product's manifest doc, non-null at this point — line 255
  `if (!manifest) continue;` already guards this), `entry.repository` (string,
  e.g. `"nextbridgehq/repocode"`), `normalizeRepoRef`, `versionFloor` (both
  already imported at the top of `rules.mjs`), `py` (pyproject.toml reader
  result, may be `null`), `readJsonIfExists`, `existsSync`, `join` (already
  imported).
- Produces: no new exports — this task only changes the body of `layer3`.
  Finding shape unchanged: `{ rule, severity, subject, message }` via the
  existing `finding()` helper.

- [ ] **Step 1: Locate the exact block to replace**

Read `ecosystem/scripts/lib/rules.mjs` lines 255–321. Confirm it matches:

```js
    if (!manifest) continue; // remaining rules describe a manifest against its repository

    // R-META1 — declared repository matches the repository's own metadata.
    const candidates = [
      ...pkgs.map((p) => p.json?.repository?.url ?? p.json?.repository),
      py?.repository, py?.homepage,
      readJsonIfExists(join(repoDir, '.claude-plugin', 'plugin.json'))?.repository,
    ].map(normalizeRepoRef).filter(Boolean);
    if (candidates.length === 0) {
      out.push(finding('R-META1', SKIP, subject, 'repository declares no repository URL anywhere'));
    } else if (!candidates.includes(entry.repository)) {
      out.push(finding('R-META1', ERROR, subject,
        `registry says "${entry.repository}" but the repository declares ${[...new Set(candidates)].map((c) => `"${c}"`).join(', ')}`));
    }

    // R-META2 — every declared npm package exists and is publishable.
```
(R-META2's block, lines 270-290, stays completely unchanged — do not touch it.)
```js
    // R-META3 — licence agrees, and a LICENSE file exists.
    const licences = new Set([...pkgs.map((p) => p.json?.license), py?.license].filter(Boolean));
    if (licences.size > 0 && !licences.has(manifest.license)) {
      out.push(finding('R-META3', ERROR, subject,
        `manifest licence "${manifest.license}" does not match the repository's ${[...licences].join(', ')}`));
    }
    if (!existsSync(join(repoDir, 'LICENSE')) && !existsSync(join(repoDir, 'LICENSE.md'))) {
      out.push(finding('R-META3', WARN, subject, 'no LICENSE file found'));
    }

    // R-META4 — declared runtime floor matches the repository's declared floor.
    if (manifest.runtime?.node) {
      const declared = versionFloor(manifest.runtime.node);
      const found = pkgs.map((p) => versionFloor(p.json?.engines?.node)).filter((v) => v !== null);
      if (found.length === 0) {
        out.push(finding('R-META4', SKIP, subject, 'no engines.node declared anywhere in the repository'));
      } else if (!found.includes(declared)) {
        out.push(finding('R-META4', ERROR, subject,
          `manifest node floor ${declared} does not match engines.node ${[...new Set(found)].join(', ')}`));
      }
    }
    if (manifest.runtime?.python) {
```
(the `manifest.runtime?.python` block and everything after stays completely
unchanged.)

- [ ] **Step 2: Replace the R-META1/R-META3/R-META4-node sections**

Replace the three blocks above (R-META1 in full, R-META3's licence-agreement
paragraph only — not the LICENSE-file `WARN`, and R-META4's `node` branch
only — not the `python` branch) with:

```js
    // Declared npm packages (G1): when a manifest names specific packages under
    // distribution[channel=npm], those packages become the sole authority for
    // R-META1/R-META3/R-META4(node) — each checked independently, no any-of
    // collapsing across siblings. A manifest declaring none falls back to the
    // original tree-wide any-of behaviour, unchanged.
    const declaredNpm = new Set(
      (manifest.distribution ?? [])
        .filter((d) => d.channel === 'npm')
        .flatMap((d) => d.packages ?? []),
    );

    // R-META1 — declared repository matches the repository's own metadata.
    if (declaredNpm.size > 0) {
      const refs = pkgs
        .filter((p) => declaredNpm.has(p.json?.name))
        .map((p) => ({ name: p.json.name, ref: normalizeRepoRef(p.json?.repository?.url ?? p.json?.repository) }))
        .filter((r) => r.ref);
      if (refs.length === 0) {
        out.push(finding('R-META1', SKIP, subject, 'repository declares no repository URL anywhere'));
      } else {
        for (const { name, ref } of refs) {
          if (ref !== entry.repository) {
            out.push(finding('R-META1', ERROR, subject,
              `registry says "${entry.repository}" but declared package "${name}" declares "${ref}"`));
          }
        }
      }
    } else {
      const candidates = [
        ...pkgs.map((p) => p.json?.repository?.url ?? p.json?.repository),
        py?.repository, py?.homepage,
        readJsonIfExists(join(repoDir, '.claude-plugin', 'plugin.json'))?.repository,
      ].map(normalizeRepoRef).filter(Boolean);
      if (candidates.length === 0) {
        out.push(finding('R-META1', SKIP, subject, 'repository declares no repository URL anywhere'));
      } else if (!candidates.includes(entry.repository)) {
        out.push(finding('R-META1', ERROR, subject,
          `registry says "${entry.repository}" but the repository declares ${[...new Set(candidates)].map((c) => `"${c}"`).join(', ')}`));
      }
    }

    // R-META2 — every declared npm package exists and is publishable.
```

Leave R-META2's block exactly as it is today (do not retype it). Immediately
after R-META2's closing brace (the `for (const dist of manifest.distribution ?? [])`
loop that handles `pypi`), replace the R-META3 licence check and the R-META4
`node` branch with:

```js
    // R-META3 — licence agrees, and a LICENSE file exists.
    if (declaredNpm.size > 0) {
      for (const p of pkgs) {
        if (!declaredNpm.has(p.json?.name)) continue;
        const license = p.json?.license;
        if (license && license !== manifest.license) {
          out.push(finding('R-META3', ERROR, subject,
            `manifest licence "${manifest.license}" does not match declared package "${p.json.name}"'s licence "${license}"`));
        }
      }
    } else {
      const licences = new Set([...pkgs.map((p) => p.json?.license), py?.license].filter(Boolean));
      if (licences.size > 0 && !licences.has(manifest.license)) {
        out.push(finding('R-META3', ERROR, subject,
          `manifest licence "${manifest.license}" does not match the repository's ${[...licences].join(', ')}`));
      }
    }
    if (!existsSync(join(repoDir, 'LICENSE')) && !existsSync(join(repoDir, 'LICENSE.md'))) {
      out.push(finding('R-META3', WARN, subject, 'no LICENSE file found'));
    }

    // R-META4 — declared runtime floor matches the repository's declared floor.
    if (manifest.runtime?.node) {
      const declared = versionFloor(manifest.runtime.node);
      if (declaredNpm.size > 0) {
        const found = pkgs
          .filter((p) => declaredNpm.has(p.json?.name))
          .map((p) => ({ name: p.json.name, floor: versionFloor(p.json?.engines?.node) }))
          .filter((f) => f.floor !== null);
        if (found.length === 0) {
          out.push(finding('R-META4', SKIP, subject, 'no engines.node declared anywhere in the repository'));
        } else {
          for (const { name, floor } of found) {
            if (floor !== declared) {
              out.push(finding('R-META4', ERROR, subject,
                `manifest node floor ${declared} does not match declared package "${name}"'s engines.node floor ${floor}`));
            }
          }
        }
      } else {
        const found = pkgs.map((p) => versionFloor(p.json?.engines?.node)).filter((v) => v !== null);
        if (found.length === 0) {
          out.push(finding('R-META4', SKIP, subject, 'no engines.node declared anywhere in the repository'));
        } else if (!found.includes(declared)) {
          out.push(finding('R-META4', ERROR, subject,
            `manifest node floor ${declared} does not match engines.node ${[...new Set(found)].join(', ')}`));
        }
      }
    }
    if (manifest.runtime?.python) {
```

Leave the `manifest.runtime?.python` block and everything after it in
`layer3` completely unchanged.

- [ ] **Step 3: Run the full test file and verify everything passes**

Run from `ecosystem/`:

```bash
node --test test/drift-repository.test.mjs
```

Expected: **every** test in the file passes — the four new G1 tests from
Task 1 (now green), the six pre-existing R-META1/R-META3/R-META4/R-META5
tests (unchanged assertions, still passing — proving fallback mode for
`package-pilot` and degenerate strict mode for `agent-loop-guard` are both
byte-for-byte equivalent to before), and the "missing repository" test.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: `pass 115`, `fail 0` (111 existing + 4 new).

- [ ] **Step 5: Run the full Phase 2 baseline**

From `ecosystem/`:

```bash
node scripts/validate.mjs --repos ..
node scripts/compile.mjs --check
node scripts/sync.mjs --repos .. --check
```

Expected: all three exit 0, with output matching the Phase 2 baseline in
`PHASE-2-REPORT.md` (`0 error(s), 0 warning(s), 1 skipped` for validate — the
`R-META4 product:code-comrades` "no requires-python declared" skip — and
`unchanged` for every product in compile/sync). If any of the real committed
manifests now produce a *new* R-META1/R-META3/R-META4 finding that did not
exist before, stop and investigate before proceeding — it means one of the
nine real products has metadata drift this change newly exposes (a legitimate
finding, not a bug in this change, but it must be understood, not silently
accepted).

- [ ] **Step 6: No commit**

This repository has no local git init (see Global Constraints). This task,
and this plan, are complete once Steps 3–5 are all green.
