# Hybrid Test & CI Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a 3-tier hybrid test and CI architecture that makes default CI and local testing hermetic with respect to product repositories, eliminating 35 failing tests in `validate.yml`, while preserving live repository integration testing.

**Architecture:** 
- **Tier 1 (Contract & Compilation)**: Schema and referential checks against in-tree files.
- **Tier 2 (Synthetic Drift & Fixture Hardening)**: Minimal synthetic product fixtures in `test/fixtures/products/` with an immutable copying mechanism in `makeWorkspace()`.
- **Tier 3 (Live Repository Integration)**: Sibling repository testing in `test/integration-repos.test.mjs` with explicit `--repos` / `--repos-dir` error semantics and graceful automatic skipping when repositories are absent.

**Tech Stack:** Node.js 20+ (`node:test`, `node:assert/strict`, `node:fs`, `node:path`), Ajv, js-yaml, GitHub Actions.

## Global Constraints
- No test in Tier 1 or Tier 2 may read from `../<product>` or depend on external repositories.
- Fixtures under `test/fixtures/` are strictly read-only test inputs. All mutation occurs exclusively in temporary workspace copies created by `makeWorkspace()`.
- Explicit `--repos <path>` or `--repos-dir <dir>` must immediately fail if any specified path does not exist; silent skipping is permitted ONLY during automatic sibling discovery when no repos are found.
- Default `npm test` must pass cleanly in clean environments with exit code 0.
- All code changes must be executed inside `d:\Projects\mini projects\nextbridge-ecosystem\ecosystem`.

---

### Task 1: Create Synthetic Product Fixtures & Provenance Documentation

**Files:**
- Create: `test/fixtures/README.md`
- Create: `test/fixtures/products/repocode/packages/{cli,core,mcp}/package.json`
- Create: `test/fixtures/products/repocode/LICENSE`
- Create: `test/fixtures/products/repocode/.github/workflows/ci.yml`
- Create: `test/fixtures/products/code-comrades/package.json`
- Create: `test/fixtures/products/code-comrades/LICENSE`
- Create: `test/fixtures/products/code-comrades/.claude-plugin/plugin.json`
- Create: `test/fixtures/products/code-comrades/.github/workflows/tests.yml`
- Create: `test/fixtures/products/code-comrades/skills/{changelog-fragment-extractor,code-commenter,error-handling-auditor,import-sorter-cleaner,license-header-injector,readme-master,readme-per-folder,test-stub-generator,type-annotator,doc-validator}/SKILL.md`
- Create: `test/fixtures/products/code-comrades/hooks/.gitkeep`
- Create: `test/fixtures/products/graphpowers/pyproject.toml`
- Create: `test/fixtures/products/graphpowers/LICENSE`
- Create: `test/fixtures/products/graphpowers/.claude-plugin/plugin.json`
- Create: `test/fixtures/products/graphpowers/skills/{graph-query,graph-build,graph-inspect,graph-export,graph-diff,graph-metrics,graph-lint,graph-trace,graph-visualize,graph-schema,graph-cache}/SKILL.md`
- Create: `test/fixtures/products/graphpowers/hooks/.gitkeep`
- Create: `test/fixtures/products/package-pilot/package.json`
- Create: `test/fixtures/products/package-pilot/LICENSE`
- Create: `test/fixtures/products/package-pilot/.github/workflows/ci.yml`
- Create: `test/fixtures/products/project-charter/pyproject.toml`
- Create: `test/fixtures/products/project-charter/LICENSE`
- Create: `test/fixtures/products/project-charter/.github/workflows/ci.yml`
- Create: `test/fixtures/products/edge-compat-check/package.json`
- Create: `test/fixtures/products/edge-compat-check/LICENSE`
- Create: `test/fixtures/products/agent-loop-guard/package.json`
- Create: `test/fixtures/products/agent-loop-guard/LICENSE`
- Create: `test/fixtures/products/agent-loop-guard/.github/workflows/ci.yml`
- Create: `test/fixtures/products/block-builder/package.json`
- Create: `test/fixtures/products/block-builder/LICENSE`
- Create: `test/fixtures/products/block-builder/.github/workflows/ci.yml`
- Create: `test/fixtures/products/registry-guard/package.json`
- Create: `test/fixtures/products/registry-guard/LICENSE`
- Create: `test/fixtures/products/registry-guard/.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Rule requirements from `scripts/lib/rules.mjs` (Layer 3 inspections).
- Produces: Synthetic metadata-only directory trees in `test/fixtures/products/<name>` for all 9 products.

- [ ] **Step 1: Write `test/fixtures/README.md` documenting fixture provenance and immutability**

```markdown
# Synthetic Product Fixtures

These fixtures are **synthetic test stubs**, NOT clones of production repositories.
They provide the minimum metadata files required to test Layer 3 validation rules deterministically, offline, and without network or external repository dependencies.

## Invariant
Fixtures are read-only test inputs. All mutation occurs exclusively inside temporary workspace copies created by `makeWorkspace()`. Never mutate files in this directory.

## Product Coverage
- `repocode`: Multi-package monorepo (cli, core, mcp) with engines.node >=20.0.0.
- `code-comrades`: Claude Code plugin with 10 skills, hooks, and CI workflow.
- `graphpowers`: Python project with pyproject.toml repo URL, 11 skills, hooks.
- `package-pilot`: Private npm package (`"private": true`).
- `project-charter`: Python project with pyproject.toml repo URL.
- `edge-compat-check`: Product intentionally lacking CI workflow (negative test for R-META5).
- `agent-loop-guard`, `block-builder`, `registry-guard`: Standard products with package.json and CI workflows.
```

- [ ] **Step 2: Generate the 9 synthetic product fixtures**

Create each product directory with its exact metadata stubs:
- `repocode`:
  - `packages/cli/package.json`: `{"name": "@nextbridge/repocode-cli", "version": "0.1.0", "license": "MIT", "repository": {"type": "git", "url": "https://github.com/nextbridgehq/repocode.git"}, "engines": {"node": ">=20.0.0"}}`
  - `packages/core/package.json`: `{"name": "@nextbridge/repocode-core", "version": "0.1.0", "license": "MIT", "repository": {"type": "git", "url": "https://github.com/nextbridgehq/repocode.git"}, "engines": {"node": ">=20.0.0"}}`
  - `packages/mcp/package.json`: `{"name": "@nextbridge/repocode-mcp", "version": "0.1.0", "license": "MIT", "repository": {"type": "git", "url": "https://github.com/nextbridgehq/repocode.git"}, "engines": {"node": ">=20.0.0"}}`
  - `LICENSE`: `MIT License`
  - `.github/workflows/ci.yml`: `name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`
- `code-comrades`:
  - `package.json`: `{"name": "@nextbridge/code-comrades", "version": "0.1.0", "license": "MIT", "repository": {"type": "git", "url": "https://github.com/nextbridgehq/code-comrades.git"}, "engines": {"node": ">=20.0.0"}}`
  - `LICENSE`: `MIT License`
  - `.claude-plugin/plugin.json`: `{"name": "code-comrades", "version": "0.1.0", "description": "Code Comrades"}`
  - `.github/workflows/tests.yml`: `name: tests\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`
  - 10 skills: `skills/<name>/SKILL.md` with frontmatter `name` and `description`
  - `hooks/`: directory with `.gitkeep`
- `graphpowers`:
  - `pyproject.toml`: `[project]\nname = "graphpowers"\nversion = "0.1.0"\nlicense = "MIT"\n[project.urls]\nRepository = "https://github.com/nextbridgehq/graphpowers"\n`
  - `LICENSE`: `MIT License`
  - `.claude-plugin/plugin.json`: `{"name": "graphpowers", "version": "0.1.0", "description": "Graphpowers"}`
  - 11 skills: `skills/<name>/SKILL.md`
  - `hooks/`: directory with `.gitkeep`
- `package-pilot`:
  - `package.json`: `{"name": "package-pilot", "version": "0.1.0", "license": "MIT", "private": true, "repository": {"type": "git", "url": "https://github.com/nextbridgehq/package-pilot.git"}, "engines": {"node": ">=20.0.0"}}`
  - `LICENSE`: `MIT License`
  - `.github/workflows/ci.yml`: `name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`
- `project-charter`:
  - `pyproject.toml`: `[project]\nname = "project-charter"\nversion = "0.1.0"\nlicense = "MIT"\n[project.urls]\nRepository = "https://github.com/nextbridgehq/project-charter"\n`
  - `LICENSE`: `MIT License`
  - `.github/workflows/ci.yml`: `name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`
- `edge-compat-check`:
  - `package.json`: `{"name": "edge-compat-check", "version": "0.1.0", "license": "MIT", "repository": {"type": "git", "url": "https://github.com/nextbridgehq/edge-compat-check.git"}, "engines": {"node": ">=20.0.0"}}`
  - `LICENSE`: `MIT License`
  - *(Intentionally no .github/workflows directory)*
- `agent-loop-guard`, `block-builder`, `registry-guard`:
  - `package.json`: valid with name matching repository, `license: "MIT"`, `repository.url: "https://github.com/nextbridgehq/<name>.git"`, `engines.node: ">=20.0.0"`
  - `LICENSE`: `MIT License`
  - `.github/workflows/ci.yml`: minimal workflow

- [ ] **Step 3: Verify all 9 fixtures exist via node script**

Run: `node -e "const fs = require('node:fs'); const products = ['repocode','code-comrades','graphpowers','package-pilot','project-charter','edge-compat-check','agent-loop-guard','block-builder','registry-guard']; for (const p of products) { if (!fs.existsSync('test/fixtures/products/' + p)) throw new Error('missing ' + p); } console.log('ALL FIXTURES PRESENT');"`
Expected: `ALL FIXTURES PRESENT`

- [ ] **Step 4: Commit**

```bash
git add test/fixtures
git commit -m "test: add synthetic product fixtures and provenance documentation"
```

---

### Task 2: Refactor `test/lib/fixture.mjs` to Decouple from Parent Directory

**Files:**
- Modify: `test/lib/fixture.mjs`
- Test: `test/fixture.test.mjs`

**Interfaces:**
- Consumes: Synthetic fixtures in `test/fixtures/products/`
- Produces: `export const FIXTURES_ROOT`, `export function makeWorkspace({ products, prefix })`, preserving existing callers.

- [ ] **Step 1: Write test verifying `makeWorkspace` copies from `FIXTURES_ROOT`**

In `test/fixture.test.mjs`, ensure test runs against `FIXTURES_ROOT` without referencing `WORKSPACE_ROOT`:

```javascript
test('a fixture workspace reproduces the real ecosystem exactly', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    assert.ok(existsSync(join(ws.eco, 'registry.yaml')));
    assert.ok(existsSync(join(ws.repo('repocode'), 'LICENSE')));
  } finally {
    ws.cleanup();
  }
});
```

- [ ] **Step 2: Update `test/lib/fixture.mjs`**

Replace `export const WORKSPACE_ROOT = resolve(ROOT, '..');` with:
```javascript
export const FIXTURES_ROOT = resolve(ROOT, 'test', 'fixtures', 'products');
```
And in `makeWorkspace()`:
```javascript
export function makeWorkspace({ products = ALL_PRODUCTS, prefix = 'nb-fix-' } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const eco = join(root, 'ecosystem');

  copyTree(ECOSYSTEM_ROOT, eco);
  for (const name of products) {
    const fixturePath = join(FIXTURES_ROOT, name);
    if (!existsSync(fixturePath)) {
      throw new Error(`Synthetic fixture not found for product: "${name}" at ${fixturePath}`);
    }
    copyTree(fixturePath, join(root, name));
  }

  // Link dependencies rather than copying them
  const modules = join(eco, 'node_modules');
  if (!existsSync(modules)) {
    symlinkSync(join(ECOSYSTEM_ROOT, 'node_modules'), modules,
      process.platform === 'win32' ? 'junction' : 'dir');
  }

  return {
    root,
    eco,
    repo: (name) => join(root, name),
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}
```

- [ ] **Step 3: Run `fixture.test.mjs`**

Run: `node --test test/fixture.test.mjs`
Expected: All subtests in `fixture.test.mjs` PASS.

- [ ] **Step 4: Commit**

```bash
git add test/lib/fixture.mjs test/fixture.test.mjs
git commit -m "refactor(test): decouple makeWorkspace from parent directory to synthetic fixtures"
```

---

### Task 3: Implement Repository Resolver in `test/lib/repos.mjs`

**Files:**
- Create: `test/lib/repos.mjs`
- Create: `test/repos-resolver.test.mjs`

**Interfaces:**
- Consumes: CLI args (`--repos`, `--repos-dir`), env (`ECOSYSTEM_REPOS_DIR`), `registry.yaml`.
- Produces:
  - `parseRepoArgs(argv)`
  - `discoverSiblingRepos(registry, baseDir)`
  - `resolveLiveRepos(options)`
  - `formatSkipMessage(reason)`

- [ ] **Step 1: Write unit tests for `repos.mjs` resolution logic in `test/repos-resolver.test.mjs`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoArgs, resolveLiveRepos, formatSkipMessage } from './lib/repos.mjs';

test('parseRepoArgs extracts --repos paths and --repos-dir', () => {
  const parsed = parseRepoArgs(['--repos', 'path/a', 'path/b', '--repos-dir', 'parent/dir']);
  assert.deepEqual(parsed.repos, ['path/a', 'path/b']);
  assert.equal(parsed.reposDir, 'parent/dir');
});

test('resolveLiveRepos throws on non-existent explicit repo', () => {
  assert.throws(
    () => resolveLiveRepos({ argv: ['--repos', 'definitely/does/not/exist'] }),
    /Explicitly requested repository not found/
  );
});

test('resolveLiveRepos throws on non-existent ECOSYSTEM_REPOS_DIR', () => {
  assert.throws(
    () => resolveLiveRepos({ env: { ECOSYSTEM_REPOS_DIR: 'definitely/does/not/exist' } }),
    /Configured repos directory not found/
  );
});

test('resolveLiveRepos falls back to graceful skip when automatic discovery finds nothing', () => {
  const res = resolveLiveRepos({ argv: [], env: {}, baseDir: 'nonexistent-empty-dir' });
  assert.equal(res.available, false);
  assert.match(res.reason, /sibling repositories not available/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/repos-resolver.test.mjs`
Expected: FAIL with `Cannot find module './lib/repos.mjs'`

- [ ] **Step 3: Implement `test/lib/repos.mjs`**

```javascript
import { resolve, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { paths, readYaml } from '../../scripts/lib/io.mjs';

export function parseRepoArgs(argv = process.argv.slice(2)) {
  const repos = [];
  let reposDir = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repos') {
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        repos.push(argv[i]);
        i++;
      }
      i--;
    } else if (argv[i] === '--repos-dir') {
      reposDir = argv[++i] ?? null;
    }
  }
  return { repos, reposDir };
}

export function discoverSiblingRepos(registry, baseDir) {
  const discovered = new Map();
  const missing = [];
  const products = Object.entries(registry?.products ?? {});

  for (const [id, entry] of products) {
    const repoName = entry.repository.split('/')[1] || id;
    const target = join(baseDir, repoName);
    if (existsSync(target) && statSync(target).isDirectory()) {
      discovered.set(id, target);
    } else {
      missing.push(id);
    }
  }

  return { discovered, missing, total: products.length };
}

export function resolveLiveRepos({
  argv = process.argv.slice(2),
  env = process.env,
  baseDir = resolve(paths.registry, '..', '..'),
  registry = readYaml(paths.registry),
} = {}) {
  const { repos, reposDir } = parseRepoArgs(argv);

  // 1. Explicit --repos <paths...>
  if (repos.length > 0) {
    const resolved = new Map();
    for (const p of repos) {
      const abs = resolve(p);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        throw new Error(`Explicitly requested repository not found at: ${p}`);
      }
      const name = abs.split(/[\\/]/).pop();
      resolved.set(name, abs);
    }
    return {
      available: true,
      source: 'cli-repos',
      repos: resolved,
      count: resolved.size,
      total: resolved.size,
      reposDir: null,
    };
  }

  // 2. Explicit --repos-dir or ECOSYSTEM_REPOS_DIR
  const explicitDir = reposDir || env.ECOSYSTEM_REPOS_DIR;
  if (explicitDir) {
    const absDir = resolve(explicitDir);
    if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
      throw new Error(`Configured repos directory not found at: ${explicitDir}`);
    }
    const { discovered, missing, total } = discoverSiblingRepos(registry, absDir);
    return {
      available: discovered.size > 0,
      source: reposDir ? 'cli-repos-dir' : 'env',
      repos: discovered,
      count: discovered.size,
      total,
      reposDir: absDir,
      reason: discovered.size === 0 ? 'no registered products found in configured directory' : null,
    };
  }

  // 3. Implicit sibling discovery
  const { discovered, missing, total } = discoverSiblingRepos(registry, baseDir);
  if (discovered.size > 0) {
    return {
      available: true,
      source: 'auto-sibling',
      repos: discovered,
      count: discovered.size,
      total,
      reposDir: baseDir,
    };
  }

  // 4. Fallback: Graceful Skip
  return {
    available: false,
    source: 'none',
    repos: new Map(),
    count: 0,
    total,
    reposDir: null,
    reason: 'sibling repositories not available',
  };
}

export function formatSkipMessage(reason) {
  return `○ Tier 3 — Live repository integration: SKIPPED (${reason})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/repos-resolver.test.mjs`
Expected: All tests in `test/repos-resolver.test.mjs` PASS.

- [ ] **Step 5: Commit**

```bash
git add test/lib/repos.mjs test/repos-resolver.test.mjs
git commit -m "feat(test): add deterministic repository resolver with explicit error semantics"
```

---

### Task 4: Move Repository Rule Detection Tests to `test/drift-repository-fixture.test.mjs`

**Files:**
- Create: `test/drift-repository-fixture.test.mjs`
- Modify: `test/validate.test.mjs` (remove lines 272–418)

**Interfaces:**
- Consumes: `FIXTURES_ROOT` from `test/lib/fixture.mjs`, `layer3` from `scripts/lib/rules.mjs`.
- Produces: Pure Tier 2 negative drift tests for Layer 3 rules; restores `validate.test.mjs` as strictly Tier 1.

- [ ] **Step 1: Create `test/drift-repository-fixture.test.mjs` targeting `FIXTURES_ROOT`**

Port the repository rule tests (formerly in `validate.test.mjs:272-418`) to run against `FIXTURES_ROOT`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { paths, readYaml, loadManifests } from '../scripts/lib/io.mjs';
import { layer3, ERROR, WARN } from '../scripts/lib/rules.mjs';
import { FIXTURES_ROOT } from './lib/fixture.mjs';

const registry = readYaml(paths.registry);
const manifests = loadManifests();

const clone = (v) => structuredClone(v);
const rules = (findings, rule) => findings.filter((f) => f.rule === rule);
const baseManifest = () => clone(manifests.repocode.doc);
const withManifests = (entries) =>
  Object.fromEntries(entries.map((doc) => [doc.id, { file: `${doc.id}.yaml`, doc }]));

test('R-META1 catches a repository URL mismatch against fixture', () => {
  const reg = clone(registry);
  reg.products['project-charter'].repository = 'saadat-dev/project-charter';
  const doc = { ...baseManifest(), id: 'project-charter', distribution: [] };
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(findings, 'R-META1');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /nextbridgehq\/project-charter/);
});

test('R-META2 catches a product distributed on npm while marked private (package-pilot fixture)', () => {
  const reg = clone(registry);
  reg.products['package-pilot'].manifest_status = 'present';
  const doc = {
    ...baseManifest(), id: 'package-pilot',
    distribution: [{ channel: 'npm', packages: ['package-pilot'], access: 'public' }],
  };
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(findings, 'R-META2');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /"private": true/);
});

test('R-META5 catches maturity "stable" in a repository with no CI (edge-compat-check fixture)', () => {
  const reg = clone(registry);
  reg.products['edge-compat-check'].manifest_status = 'present';
  const doc = { ...baseManifest(), id: 'edge-compat-check', maturity: 'stable' };
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.equal(rules(findings, 'R-META5').length, 1);
});

test('R-META5 accepts "stable" when repository runs CI (code-comrades fixture)', () => {
  const findings = layer3({ registry, manifests, reposDir: FIXTURES_ROOT });
  assert.deepEqual(rules(findings, 'R-META5').filter((f) => f.severity === ERROR), []);
});

test('R-META4 catches a declared Node floor the repository does not support (repocode fixture)', () => {
  const reg = clone(registry);
  const doc = baseManifest();
  doc.runtime.node = '>=18';
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.equal(rules(findings, 'R-META4').length, 3);
});

test('R-MK7 catches a component count that does not match the repository (code-comrades fixture)', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const doc = {
    ...baseManifest(), id: 'code-comrades',
    plugins: [{
      name: 'code-comrades', host: 'claude-code', path: '.',
      manifest: '.claude-plugin/plugin.json', marketplace: 'nextbridge',
      components: { skills: 3, agents: 1, hooks: false, mcp: false },
      status: 'published',
    }],
  };
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(findings, 'R-MK7');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /declares 3 skills but the repository has 10/);
});

test('R-MK7 accepts the real graphpowers plugin structure against fixture', () => {
  const reg = clone(registry);
  reg.products.graphpowers.manifest_status = 'present';
  const doc = {
    ...baseManifest(), id: 'graphpowers',
    plugins: [{
      name: 'graphpowers', host: 'claude-code', path: '.',
      manifest: '.claude-plugin/plugin.json', marketplace: 'nextbridge',
      components: { skills: 11, agents: 0, commands: 0, hooks: true, mcp: false },
      status: 'published',
    }],
  };
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.deepEqual(rules(findings, 'R-MK7'), []);
  assert.deepEqual(rules(findings, 'R-MK5'), []);
});

test('R-MK5 catches a plugin name that disagrees with its plugin.json against fixture', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const doc = {
    ...baseManifest(), id: 'code-comrades',
    plugins: [{
      name: 'comrades', host: 'claude-code', path: '.',
      manifest: '.claude-plugin/plugin.json', marketplace: 'nextbridge',
      components: { skills: 10, agents: 0, commands: 0, hooks: true, mcp: false },
      status: 'published',
    }],
  };
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.equal(rules(findings, 'R-MK5').length, 1);
});
```

- [ ] **Step 2: Clean `test/validate.test.mjs` to remove live repository coupling**

In `test/validate.test.mjs`, remove lines 272–418. `validate.test.mjs` now contains exclusively Tier 1 tests (Layers 1 and 2).

- [ ] **Step 3: Run both test files to verify they pass**

Run: `node --test test/validate.test.mjs test/drift-repository-fixture.test.mjs`
Expected: Both test suites PASS 100% offline.

- [ ] **Step 4: Commit**

```bash
git add test/validate.test.mjs test/drift-repository-fixture.test.mjs
git commit -m "refactor(test): move layer 3 rule detection tests to synthetic fixture suite"
```

---

### Task 5: Implement Tier 3 Live Suite in `test/integration-repos.test.mjs`

**Files:**
- Create: `test/integration-repos.test.mjs`

**Interfaces:**
- Consumes: `resolveLiveRepos`, `formatSkipMessage` from `test/lib/repos.mjs`, `layer3` from `scripts/lib/rules.mjs`.
- Produces: Live Tier 3 test runner with explicit dynamic reporting and graceful skip.

- [ ] **Step 1: Write `test/integration-repos.test.mjs`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paths, readYaml, loadManifests } from '../scripts/lib/io.mjs';
import { layer3, ERROR } from '../scripts/lib/rules.mjs';
import { resolveLiveRepos, formatSkipMessage } from './lib/repos.mjs';

test('Tier 3 — Live repository integration', (t) => {
  const resolution = resolveLiveRepos();

  if (!resolution.available) {
    const msg = formatSkipMessage(resolution.reason);
    console.log(msg);
    t.skip(resolution.reason);
    return;
  }

  const registry = readYaml(paths.registry);
  const manifests = loadManifests();

  const findings = layer3({
    registry,
    manifests,
    reposDir: resolution.reposDir,
  });

  const errors = findings.filter((f) => f.severity === ERROR);
  assert.deepEqual(errors, [], `Layer 3 errors found: ${JSON.stringify(errors, null, 2)}`);

  console.log(
    `✓ Tier 3 — Live repository integration: ${resolution.count}/${resolution.total} repositories verified`
  );
});
```

- [ ] **Step 2: Run test in isolated/no-repo environment to verify graceful skip**

Run: `node --test test/integration-repos.test.mjs`
Expected: Output contains `ok 1 - Tier 3 — Live repository integration # SKIP sibling repositories not available` and exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add test/integration-repos.test.mjs
git commit -m "feat(test): add Tier 3 live repository integration suite with dynamic reporting"
```

---

### Task 6: Update `scripts/validate.mjs` to Support `--repos-dir` and `ECOSYSTEM_REPOS_DIR`

**Files:**
- Modify: `scripts/validate.mjs`

**Interfaces:**
- Consumes: `--repos-dir <dir>`, `ECOSYSTEM_REPOS_DIR`, `--repos <dir>` (alias).
- Produces: Layer 3 directory resolution aligned with test infrastructure.

- [ ] **Step 1: Update CLI flag parsing in `scripts/validate.mjs`**

```javascript
const reposDir = flag('--repos-dir') || flag('--repos') || process.env.ECOSYSTEM_REPOS_DIR || null;
```

- [ ] **Step 2: Test `scripts/validate.mjs` without flags**

Run: `node scripts/validate.mjs`
Expected: Layers 1 and 2 pass; Layer 3 is skipped with message `pass --repos-dir <dir> or set ECOSYSTEM_REPOS_DIR`.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate.mjs
git commit -m "feat(cli): support --repos-dir and ECOSYSTEM_REPOS_DIR in validate.mjs"
```

---

### Task 7: Update `package.json` and CI Workflows

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/validate.yml`
- Modify: `.github/workflows/repo-consistency.yml`

**Interfaces:**
- Consumes: Granular test scripts and workflow configurations.
- Produces: Coherent CI and developer command suite.

- [ ] **Step 1: Update `package.json` scripts**

Update `scripts` section:
```json
{
  "scripts": {
    "validate": "node scripts/validate.mjs",
    "validate:repos": "node scripts/validate.mjs --repos-dir ..",
    "compile": "node scripts/compile.mjs",
    "check": "node scripts/validate.mjs && node scripts/compile.mjs --check",
    "sync": "node scripts/sync.mjs",
    "test": "node --test test/*.test.mjs",
    "test:contract": "node --test test/compile.test.mjs test/validate.test.mjs",
    "test:unit": "npm run test:contract",
    "test:fixtures": "node --test test/drift-marketplace.test.mjs test/drift-repository-fixture.test.mjs test/fixture.test.mjs test/lifecycle.test.mjs test/sync-lifecycle.test.mjs test/evolution-*.test.mjs test/error-contract.test.mjs",
    "test:repos": "node --test test/integration-repos.test.mjs"
  }
}
```

- [ ] **Step 2: Update `.github/workflows/validate.yml`**

Ensure `validate.yml` accurately documents its hermetic character:
```yaml
name: validate

# Layers 1 and 2 plus synthetic fixtures and generated artifacts.
# Hermetic with respect to product repositories; deterministic and independent of sibling checkouts.
```

- [ ] **Step 3: Update `.github/workflows/repo-consistency.yml`**

In `repo-consistency.yml`, update step to run Tier 3 integration test suite:
```yaml
      - name: Repository consistency (layers 1-3)
        working-directory: ecosystem
        env:
          ECOSYSTEM_REPOS_DIR: ..
        run: |
          node scripts/validate.mjs --repos-dir ..
          npm run test:repos
```

- [ ] **Step 4: Run `npm test` locally to verify clean pass**

Run: `npm test`
Expected: 100% of tests pass (Tier 1 & Tier 2 pass, Tier 3 either passes or skips gracefully). Exit code 0.

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows/validate.yml .github/workflows/repo-consistency.yml
git commit -m "chore(ci): update test scripts and workflow definitions for hybrid architecture"
```

---

### Task 8: End-to-End Verification & Drift Test Suite Alignment

**Files:**
- Audit & run: `test/drift-marketplace.test.mjs`, `test/drift-repository.test.mjs` (rename to `test/drift-repository-fixture.test.mjs`), `test/sync-lifecycle.test.mjs`, `test/error-contract.test.mjs`.

**Interfaces:**
- Consumes: Refactored `makeWorkspace()` using synthetic fixtures.
- Produces: 100% passing test suite across all 115+ tests without requiring live sibling checkouts.

- [ ] **Step 1: Check existing `drift-repository.test.mjs`**

Merge or rename `drift-repository.test.mjs` into `drift-repository-fixture.test.mjs`, ensuring all tests run against `makeWorkspace()` and synthetic fixtures.

- [ ] **Step 2: Run full test suite with clean environment simulation**

Run: `npm test`
Expected: ALL test files pass. Zero ENOENT errors. Zero assertion errors.

- [ ] **Step 3: Run targeted tier commands**

Run:
1. `npm run test:contract` -> PASS
2. `npm run test:fixtures` -> PASS
3. `npm run test:repos` -> PASS / SKIP (Exit 0)
4. `npm run check` -> PASS

- [ ] **Step 4: Commit any final test cleanups**

```bash
git add test/
git commit -m "test: align drift test suite with synthetic fixtures"
```
