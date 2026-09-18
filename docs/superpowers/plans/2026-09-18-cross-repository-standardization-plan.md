# Cross-Repository Standardization & GitHub Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an automated, machine-verifiable Repository Compliance Contract across all 9 Nextbridge product repositories with a deterministic, non-destructive standardization engine and staged offline rollout.

**Architecture:** Build a 7-pillar compliance evaluator (`scripts/compliance.mjs`) and an idempotent standardization engine (`scripts/standardize.mjs`) driven by `config/compliance.yaml` and canonical templates. Prove all behavior against hermetic synthetic fixtures in `test/fixtures/compliance/` before generating an immutable mutation plan against the live sibling checkouts.

**Tech Stack:** Node 20+, `node --test`, `ajv` 8 (`ajv/dist/2020.js`), `js-yaml` 4, `node:fs`, `node:path`, `node:crypto`.

## Global Constraints

- **No Network Guarantee**: Stages 1–4 operate 100% offline; zero git remote requests, zero npm/pypi fetches.
- **No Remote Push**: Stage 5 prepares local review diffs and commit messages; zero remote pushes.
- **Fixture Isolation**: Tests write strictly under `tmpdir()`; never mutate real sibling checkouts or real `ecosystem/` files from tests.
- **Authority Invariant**: `.nextbridge/product.yaml` is the Single Source of Truth for product identity (`name`, `description.short`, `capabilities`, `runtime`, `plugins`, `maturity`).
- **Non-Destructive Invariant**: Existing `LICENSE` files are NEVER automatically overwritten. Existing undelimited governance files require `--adopt-governance` to modify.
- **Delimited Fences**: Canonical content lives strictly between `<!-- NEXTBRIDGE:BEGIN -->` and `<!-- NEXTBRIDGE:END -->` (governance) or `<!-- NEXTBRIDGE:METADATA:BEGIN -->` and `<!-- NEXTBRIDGE:METADATA:END -->` (README).
- **Exit Code Contract**: `0` = clean/pass, `1` = FAIL (or WARN in `--strict`), `2` = invalid CLI/config, `3` = repository resolution error.

---

### Task 1: Compliance Configuration & Canonical Governance Templates

**Files:**
- Create: `config/compliance.yaml`
- Create: `templates/SECURITY.md`
- Create: `templates/CONTRIBUTING.md`
- Test: `test/compliance-config.test.mjs`

**Interfaces:**
- Consumes: Nothing.
- Produces: Validated YAML configuration loaded by `scripts/lib/compliance/config.mjs` and raw markdown templates containing standard Nextbridge delimiters.

- [ ] **Step 1: Write failing test for config and templates**

Create `test/compliance-config.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

test('compliance configuration file exists and defines required rules', () => {
  const configPath = resolve('config', 'compliance.yaml');
  assert.equal(existsSync(configPath), true, 'config/compliance.yaml must exist');
  const raw = readFileSync(configPath, 'utf8');
  const cfg = yaml.load(raw);

  assert.equal(cfg.schema, 'nextbridge.dev/compliance/v1');
  assert.equal(cfg.marketplaces.canonical, 'nextbridge');
  assert.ok(cfg.marketplaces.deprecated.includes('code-comrades-marketplace'));
  assert.ok(cfg.marketplaces.deprecated.includes('graphpowers-marketplace'));
  assert.ok(cfg.exclusions.paths.includes('.git/**'));
  assert.ok(cfg.exclusions.paths.includes('node_modules/**'));
});

test('canonical governance templates exist and contain NEXTBRIDGE delimiters', () => {
  const secPath = resolve('templates', 'SECURITY.md');
  const contPath = resolve('templates', 'CONTRIBUTING.md');
  assert.equal(existsSync(secPath), true);
  assert.equal(existsSync(contPath), true);

  const sec = readFileSync(secPath, 'utf8');
  assert.match(sec, /<!-- NEXTBRIDGE:BEGIN -->/);
  assert.match(sec, /<!-- NEXTBRIDGE:END -->/);
  assert.match(sec, /# Security Policy/);

  const cont = readFileSync(contPath, 'utf8');
  assert.match(cont, /<!-- NEXTBRIDGE:BEGIN -->/);
  assert.match(cont, /<!-- NEXTBRIDGE:END -->/);
  assert.match(cont, /# Contributing to Nextbridge/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/compliance-config.test.mjs`
Expected: FAIL (files do not exist yet).

- [ ] **Step 3: Create `config/compliance.yaml`**

```yaml
schema: nextbridge.dev/compliance/v1

marketplaces:
  canonical: nextbridge
  deprecated:
    - code-comrades-marketplace
    - graphpowers-marketplace

exclusions:
  paths:
    - ".git/**"
    - "node_modules/**"
    - "dist/**"
    - "build/**"
    - "coverage/**"
    - "vendor/**"
    - ".next/**"
    - "**/*.min.js"
    - "**/*.map"

templates:
  security: "templates/SECURITY.md"
  contributing: "templates/CONTRIBUTING.md"

package_metadata:
  expected_author: "Nextbridge"
  expected_org: "nextbridgehq"
```

- [ ] **Step 4: Create `templates/SECURITY.md` and `templates/CONTRIBUTING.md`**

In `templates/SECURITY.md`:
```markdown
<!-- NEXTBRIDGE:BEGIN -->
# Security Policy

## Reporting Security Vulnerabilities

Nextbridge takes the security of our ecosystem and tools seriously. If you believe you have found a security vulnerability in any Nextbridge project, please report it to us as described below.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report vulnerabilities by contacting our security team at `security@nextbridge.dev` or via private vulnerability reporting on GitHub if enabled.

You should receive a response within 48 hours. If for some reason you do not, please follow up with an email to ensure we received your original message.
<!-- NEXTBRIDGE:END -->

## Repository-Specific Security Notes
<!-- Add any repository-specific security details or supported versions below this line -->
```

In `templates/CONTRIBUTING.md`:
```markdown
<!-- NEXTBRIDGE:BEGIN -->
# Contributing to Nextbridge

Thank you for your interest in contributing to the Nextbridge Developer Ecosystem!

## Ecosystem Standards

All Nextbridge repositories follow our shared development discipline:
1. **Product Manifest**: Every repository defines its metadata in `.nextbridge/product.yaml`.
2. **Canonical Marketplace**: Plugins publish through the canonical `nextbridge` marketplace.
3. **Reproducibility**: Builds, tests, and documentation synchronization must run deterministically.

## Development Workflow

1. Fork or branch from `main`.
2. Ensure existing tests pass locally.
3. Add tests for new capabilities or bugfixes.
4. Keep commit messages clear, conventional, and scoped.
<!-- NEXTBRIDGE:END -->

## Repository-Specific Contributing Guide
<!-- Add repository-specific setup, local testing, and build instructions below this line -->
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/compliance-config.test.mjs`
Expected: PASS (2 tests pass).

- [ ] **Step 6: Commit**

```bash
git add config/compliance.yaml templates/ test/compliance-config.test.mjs
git commit -m "feat(compliance): add compliance configuration and canonical governance templates"
```

---

### Task 2: Implement Compliance Context Loader & Discovery Layer

**Files:**
- Create: `scripts/lib/compliance/discovery.mjs`
- Create: `scripts/lib/compliance/context.mjs`
- Test: `test/compliance-context.test.mjs`

**Interfaces:**
- Consumes: `paths` from `scripts/lib/io.mjs`, `config/compliance.yaml`.
- Produces: `discoverTargetRepos(baseDir, registry)` and `loadProductContext(repoDir, productId, registry, config)`.

- [ ] **Step 1: Write failing test for context loader**

Create `test/compliance-context.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadProductContext } from '../scripts/lib/compliance/context.mjs';

test('loadProductContext correctly parses product files and identifies missing elements', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nb-ctx-'));
  try {
    mkdirSync(join(tmp, '.nextbridge'), { recursive: true });
    writeFileSync(join(tmp, '.nextbridge', 'product.yaml'), 'schema: nextbridge.dev/product/v1\nid: demo\nname: Demo\nmaturity: stable\n');
    writeFileSync(join(tmp, 'LICENSE'), 'MIT License');
    writeFileSync(join(tmp, 'README.md'), '# Demo\nSome description');

    const ctx = loadProductContext(tmp, 'demo', { products: { demo: { repository: 'nextbridgehq/demo' } } }, {});
    assert.equal(ctx.id, 'demo');
    assert.equal(ctx.productYaml?.name, 'Demo');
    assert.equal(ctx.hasLicense, true);
    assert.equal(ctx.hasSecurity, false);
    assert.equal(ctx.hasContributing, false);
    assert.equal(ctx.workflows.length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/compliance-context.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `discovery.mjs` and `context.mjs`**

`scripts/lib/compliance/discovery.mjs`:
```javascript
import { resolve, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';

export function discoverTargetRepos(baseDir, registry) {
  const absBase = resolve(baseDir);
  if (!existsSync(absBase) || !statSync(absBase).isDirectory()) {
    throw new Error(`Target repositories directory not found: ${baseDir}`);
  }
  const discovered = new Map();
  for (const [id, entry] of Object.entries(registry.products ?? {})) {
    const repoName = entry.repository?.split('/')[1] || id;
    const target = join(absBase, repoName);
    if (existsSync(target) && statSync(target).isDirectory()) {
      discovered.set(id, target);
    }
  }
  return discovered;
}
```

`scripts/lib/compliance/context.mjs`:
```javascript
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import yaml from 'js-yaml';

export function loadProductContext(repoDir, id, registry, config = {}) {
  const productYamlPath = join(repoDir, '.nextbridge', 'product.yaml');
  let productYaml = null;
  if (existsSync(productYamlPath)) {
    try {
      productYaml = yaml.load(readFileSync(productYamlPath, 'utf8'));
    } catch {
      productYaml = null;
    }
  }

  const pkgJsonPath = join(repoDir, 'package.json');
  let packageJson = null;
  if (existsSync(pkgJsonPath)) {
    try { packageJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')); } catch { packageJson = null; }
  }

  const pyprojectPath = join(repoDir, 'pyproject.toml');
  let pyproject = null;
  if (existsSync(pyprojectPath)) {
    pyproject = readFileSync(pyprojectPath, 'utf8');
  }

  const readmePath = join(repoDir, 'README.md');
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null;

  const secPath = join(repoDir, 'SECURITY.md');
  const security = existsSync(secPath) ? readFileSync(secPath, 'utf8') : null;

  const contPath = join(repoDir, 'CONTRIBUTING.md');
  const contributing = existsSync(contPath) ? readFileSync(contPath, 'utf8') : null;

  const hasLicense = existsSync(join(repoDir, 'LICENSE')) || existsSync(join(repoDir, 'LICENSE.md'));
  const licenseContent = hasLicense ? (existsSync(join(repoDir, 'LICENSE')) ? readFileSync(join(repoDir, 'LICENSE'), 'utf8') : readFileSync(join(repoDir, 'LICENSE.md'), 'utf8')) : null;

  const wfDir = join(repoDir, '.github', 'workflows');
  const workflows = [];
  if (existsSync(wfDir) && statSync(wfDir).isDirectory()) {
    for (const f of readdirSync(wfDir)) {
      if (f.endsWith('.yml') || f.endsWith('.yaml')) workflows.push(f);
    }
  }

  return {
    id,
    repoDir,
    registryEntry: registry.products?.[id] ?? null,
    productYaml,
    packageJson,
    pyproject,
    readme,
    security,
    contributing,
    hasLicense,
    licenseContent,
    workflows,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/compliance-context.test.mjs`
Expected: PASS (1 test passes).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/compliance/discovery.mjs scripts/lib/compliance/context.mjs test/compliance-context.test.mjs
git commit -m "feat(compliance): implement repository discovery and product context loader"
```

---

### Task 3: Implement the Seven Compliance Rule Evaluators

**Files:**
- Create: `scripts/lib/compliance/rules/identity.mjs` (R-STD-ID)
- Create: `scripts/lib/compliance/rules/governance.mjs` (R-STD-GOV)
- Create: `scripts/lib/compliance/rules/documentation.mjs` (R-STD-DOC)
- Create: `scripts/lib/compliance/rules/marketplace.mjs` (R-STD-MKP)
- Create: `scripts/lib/compliance/rules/package.mjs` (R-STD-PKG)
- Create: `scripts/lib/compliance/rules/ci.mjs` (R-STD-CI)
- Create: `scripts/lib/compliance/rules/sync.mjs` (R-STD-SYNC)
- Create: `scripts/lib/compliance/evaluator.mjs`
- Test: `test/compliance-rules.test.mjs`

**Interfaces:**
- Consumes: `loadProductContext`, `schema/product.v1.schema.json`, `config/compliance.yaml`.
- Produces: `evaluateProductCompliance(context, config)` returning structured findings with standardized codes (`PASS`, `WARN`, `FAIL`).

- [ ] **Step 1: Write tests for individual rule evaluation**

Create `test/compliance-rules.test.mjs` verifying:
- `R-STD-ID` rejects missing `.nextbridge/product.yaml`.
- `R-STD-GOV` passes when `SECURITY.md` and `CONTRIBUTING.md` carry `<!-- NEXTBRIDGE:BEGIN -->`.
- `R-STD-DOC` passes when bounded metadata block reflects `name`, `capabilities`, `family`.
- `R-STD-MKP` catches deprecated marketplace references in any `.md` file.
- `R-STD-PKG` checks `repository` URL and `author: Nextbridge`.
- `R-STD-CI` accepts `stable` with workflows, accepts `experimental` with `ci_exempt: true`, and fails `stable` with 0 workflows.
- `R-STD-SYNC` detects manifest projection drift.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/compliance-rules.test.mjs`
Expected: FAIL (evaluator modules not created).

- [ ] **Step 3: Implement the 7 rule modules in `scripts/lib/compliance/rules/`**

Write each rule module cleanly:
- `identity.mjs`: Schema validation and required field presence.
- `governance.mjs`: Inspects `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md` delimiters.
- `documentation.mjs`: Validates badge and `<!-- NEXTBRIDGE:METADATA:BEGIN -->` semantic content.
- `marketplace.mjs`: Recursively scans eligible files for deprecated marketplace IDs.
- `package.mjs`: Inspects `package.json` / `pyproject.toml` coordinates.
- `ci.mjs`: Implements the 6-case maturity truth table.
- `sync.mjs`: Compares `product.yaml` with snapshot in `ecosystem/manifests/<id>.yaml`.

- [ ] **Step 4: Implement `scripts/lib/compliance/evaluator.mjs`**

Aggregates the findings:
```javascript
export function evaluateProductCompliance(context, config) {
  const findings = [];
  findings.push(...evaluateIdentity(context, config));
  findings.push(...evaluateGovernance(context, config));
  findings.push(...evaluateDocumentation(context, config));
  findings.push(...evaluateMarketplace(context, config));
  findings.push(...evaluatePackage(context, config));
  findings.push(...evaluateCI(context, config));
  findings.push(...evaluateSync(context, config));

  const hasFail = findings.some((f) => f.status === 'FAIL');
  const hasWarn = findings.some((f) => f.status === 'WARN');
  const overall = hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS';

  return { id: context.id, status: overall, findings };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/compliance-rules.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/compliance/rules/ scripts/lib/compliance/evaluator.mjs test/compliance-rules.test.mjs
git commit -m "feat(compliance): implement seven compliance rule evaluators and aggregator"
```

---

### Task 4: Implement Compliance CLI Runner & Reporting (`scripts/compliance.mjs`)

**Files:**
- Create: `scripts/lib/compliance/reporter.mjs`
- Create: `scripts/compliance.mjs`
- Test: `test/compliance-cli.test.mjs`

**Interfaces:**
- Consumes: `evaluator.mjs`, `discovery.mjs`, `context.mjs`.
- Produces: CLI interface supporting `--repos-dir`, `--json`, `--strict`, `--product`, and exit codes `0, 1, 2, 3`.

- [ ] **Step 1: Write failing CLI integration test**

Create `test/compliance-cli.test.mjs` testing:
- `--help` prints usage with exit code 0.
- Invalid arguments exit with code 2.
- Missing target directory exits with code 3.
- Compliant repo exits 0; failing repo exits 1.
- `--strict` turns WARN into exit 1.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/compliance-cli.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `reporter.mjs` and `scripts/compliance.mjs`**

`reporter.mjs`: Formats human-readable matrix table and standardized JSON object.  
`scripts/compliance.mjs`: CLI argument parsing, directory discovery, batch evaluation, reporting, and exit code handling.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/compliance-cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/compliance/reporter.mjs scripts/compliance.mjs test/compliance-cli.test.mjs
git commit -m "feat(compliance): implement compliance CLI runner with strict mode and matrix reporting"
```

---

### Task 5: Build Synthetic Compliance Fixtures & Integration Suite

**Files:**
- Create: `test/fixtures/compliance/compliant-stable/`
- Create: `test/fixtures/compliance/compliant-experimental/`
- Create: `test/fixtures/compliance/missing-governance/`
- Create: `test/fixtures/compliance/stale-marketplace/`
- Create: `test/fixtures/compliance/unexempt-ci-missing/`
- Create: `test/fixtures/compliance/readme-drift/`
- Create: `test/compliance.test.mjs`

**Interfaces:**
- Consumes: `scripts/compliance.mjs`.
- Produces: 100% offline, hermetic proof that every rule correctly triggers PASS and FAIL against static test directories.

- [ ] **Step 1: Construct synthetic test fixtures under `test/fixtures/compliance/`**

Build minimal fixture directories representing each state.

- [ ] **Step 2: Write `test/compliance.test.mjs`**

Executes compliance evaluation across all synthetic fixtures and verifies expected finding codes.

- [ ] **Step 3: Run `node --test test/compliance.test.mjs`**

Expected: 100% PASS across all fixture scenarios.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/compliance/ test/compliance.test.mjs
git commit -m "test(compliance): add hermetic synthetic fixtures and compliance test suite"
```

---

### Task 6: Implement Mutation Planner & Safety Verification

**Files:**
- Create: `scripts/lib/standardize/planner.mjs`
- Create: `scripts/lib/standardize/safety.mjs`
- Test: `test/standardize-planner.test.mjs`

**Interfaces:**
- Consumes: `evaluateProductCompliance` findings, `templates/`, `config/compliance.yaml`.
- Produces: `generateMutationPlan(context, findings, options)` producing an array of classified mutations (`CREATE`, `UPDATE_CANONICAL_BLOCK`, `SAFE_REPLACE`, `REPORT_ONLY`, `SKIP`) and SHA-256 before/after hashes.

- [ ] **Step 1: Write failing test for mutation planner and safety gate**

Create `test/standardize-planner.test.mjs` verifying:
- Missing `SECURITY.md` plans `CREATE`.
- Existing `CONTRIBUTING.md` with delimiters plans `UPDATE_CANONICAL_BLOCK`.
- Existing governance file without delimiters plans `REPORT_ONLY` (unless `adoptGovernance: true`).
- Stale marketplace string plans `SAFE_REPLACE`.
- Existing differing `LICENSE` plans `REPORT_ONLY` (never auto-replace).
- Clean tree gate passes; dirty tree throws without `--force`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/standardize-planner.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `planner.mjs` and `safety.mjs`**

`planner.mjs`: Generates the mutation plan with before-hash, after-hash, and classification.  
`safety.mjs`: Checks git working tree cleanliness and validates plan hashes against live files.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/standardize-planner.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/standardize/planner.mjs scripts/lib/standardize/safety.mjs test/standardize-planner.test.mjs
git commit -m "feat(standardize): implement mutation planner and safety verification"
```

---

### Task 7: Implement Scaffolding Applier, Post-Validation & CLI (`scripts/standardize.mjs`)

**Files:**
- Create: `scripts/lib/standardize/applier.mjs`
- Create: `scripts/standardize.mjs`
- Test: `test/standardize.test.mjs`

**Interfaces:**
- Consumes: `planner.mjs`, `safety.mjs`, `evaluator.mjs`.
- Produces: CLI supporting `--plan`, `--check`, `--apply`, `--report <file>`, `--force`, `--adopt-governance`.

- [ ] **Step 1: Write failing integration test for standardizer**

Create `test/standardize.test.mjs` verifying:
- In a temporary workspace, running `standardize --plan` leaves files untouched and writes plan JSON.
- Running `standardize --apply` brings a non-compliant repo into full compliance.
- Post-apply compliance check validates cleanly.
- Re-running `standardize --apply` is completely idempotent (`0 changes`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/standardize.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `applier.mjs` and `scripts/standardize.mjs`**

`applier.mjs`: Safely writes files, preserves undelimited content, and calculates post-write hashes.  
`scripts/standardize.mjs`: Orchestrates Discovery → Pre-flight → Plan → Safety Gate → Apply → Post-Validation → Report.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/standardize.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/standardize/applier.mjs scripts/standardize.mjs test/standardize.test.mjs
git commit -m "feat(standardize): implement standardization applier with post-validation and idempotence"
```

---

### Task 8: Package.json Scripts & Ecosystem Integration

**Files:**
- Modify: `package.json`

**Interfaces:**
- Exposes:
  - `"compliance": "node scripts/compliance.mjs"`
  - `"compliance:strict": "node scripts/compliance.mjs --strict"`
  - `"standardize": "node scripts/standardize.mjs"`

- [ ] **Step 1: Update `package.json` scripts**

Add scripts for compliance and standardization.

- [ ] **Step 2: Run complete ecosystem test suite to verify no regression**

Run: `npm test && npm run check`
Expected: All existing 123 tests + new compliance and standardizer tests PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add compliance and standardize npm scripts"
```

---

### Task 9: Stage 2 — Live Pre-Flight Audit & Immutable Mutation Plan Generation

**Files:**
- Target: Run against live sibling checkouts (`..`) in READ-ONLY mode.
- Output: `.superpowers/standardize-plan.json`.

**Interfaces:**
- Produces: Live pre-flight audit report and reviewable mutation plan for the 9 repositories.

- [ ] **Step 1: Verify ecosystem repository clean gate**

Run: `git status --porcelain`
Expected: Empty (clean working tree).

- [ ] **Step 2: Run read-only pre-flight audit**

Run: `node scripts/compliance.mjs --repos-dir ..`
Verify findings across all 9 repositories.

- [ ] **Step 3: Generate immutable mutation plan**

Run: `node scripts/standardize.mjs --repos-dir .. --plan --report .superpowers/standardize-plan.json`
Verify plan output lists all planned mutations with file hashes.

- [ ] **Step 4: STOP for User Review**

Present the generated plan to the user. **Do NOT apply mutations until the user explicitly reviews and approves the plan.**

---

### Task 10: Stage 3 & 4 — Apply Standardization & Full Ecosystem Verification

**Files:**
- Modify: Sibling repositories (`../code-comrades`, `../graphpowers`, etc.) per approved plan.

- [ ] **Step 1: Apply standardization to sibling repositories**

Run: `node scripts/standardize.mjs --repos-dir .. --apply --plan-file .superpowers/standardize-plan.json --report .superpowers/standardize-run.json`
Expected: Mutations applied, post-apply validation runs across all 9 repositories.

- [ ] **Step 2: Verify zero residual compliance findings**

Run: `node scripts/compliance.mjs --repos-dir .. --strict`
Expected: All 9 repositories PASS with 0 warnings and 0 errors.

- [ ] **Step 3: Run complete ecosystem verification suite**

Run:
1. `npm test`
2. `npm run check`
3. `node scripts/validate.mjs --repos-dir ..`
Expected: 100% PASS across all suites.

---

### Task 11: Stage 5 — Git Review & Commit Preparation

**Files:**
- Review git diffs across all modified sibling repositories.

- [ ] **Step 1: Inspect diffs in each sibling repository**

Run git status and diff across sibling repositories to verify only delimited blocks and target files were modified.

- [ ] **Step 2: Generate recommended commit messages for each repository**

Present recommended conventional commit messages to the user for local commits.

- [ ] **Step 3: Confirm Zero Remote Pushes**

Verify that no git remote commands were run and all changes remain 100% local.
