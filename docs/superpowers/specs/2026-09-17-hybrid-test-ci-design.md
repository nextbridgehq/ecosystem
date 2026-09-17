# Hybrid Test & CI Architecture Specification

**Date**: 2026-09-17  
**Topic**: Hybrid Test & CI Architecture for Nextbridge Ecosystem  
**Target Repository**: `nextbridgehq/ecosystem`  
**Objective**: Fix GitHub Actions `validate.yml` failures (35 failing tests due to missing sibling repositories) by establishing a clean, 3-tier hybrid test and CI architecture that makes default CI and local testing 100% hermetic with respect to product repositories, while preserving live repository integration testing.

---

## 1. Problem Statement & Root Cause Analysis

On commit `6b999a9`, GitHub Actions workflow `validate.yml` failed with 35 broken subtests during `npm test`:
- **29 tests** failed with `ENOENT: no such file or directory, stat '/home/runner/work/ecosystem/<product>'` because `test/lib/fixture.mjs` (`makeWorkspace()`) attempted to copy sibling product repositories from `WORKSPACE_ROOT = resolve(ROOT, '..')`. In CI, `actions/checkout@v4` only checks out `nextbridgehq/ecosystem`; sibling directories do not exist on the runner.
- **6 tests** failed with assertion errors (`0 !== 1` or `0 !== 3`) in `test/validate.test.mjs` because Layer 3 rules were evaluated directly against `REPOS = resolve(paths.registry, '..', '..')`. When sibling repositories were absent, `layer3()` returned `SKIP` findings instead of evaluating rule violations.

The architectural intent declared in `validate.yml` was to execute offline and deterministic checks on push and pull requests, while `repo-consistency.yml` was meant to handle cross-repository checks against live checkouts. However, `npm test` indiscriminately invoked all tests, including those coupled to external sibling repositories.

---

## 2. Architecture & Tiered Test Model

The ecosystem testing architecture is divided into three distinct tiers:

| Tier | Purpose | Target / Data Source | External Repositories | Network Dependency | Default CI (`validate.yml`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | Schema, referential integrity & deterministic compilation | In-tree files (`registry.yaml`, `taxonomy/`, `manifests/`, `catalog.json`, `marketplace.json`) | None | None | **Always runs** |
| **Tier 2** | Negative drift & rule-violation enforcement | Synthetic, lightweight fixtures in `test/fixtures/products/` | None (read-only fixtures) | None | **Always runs** |
| **Tier 3** | Live product repository integration | Real sibling checkouts (`../<product>`) | Required if enabled | None (local checkouts) | **Conditional / Graceful Skip** |

---

## 3. Synthetic Fixtures Specification (`test/fixtures/products/`)

### 3.1 Immutability Invariant
> **Fixtures are read-only test inputs. All mutation occurs exclusively inside temporary workspace copies created by `makeWorkspace()`. The files under `test/fixtures/` must never be modified at runtime.**

### 3.2 Fixture Provenance & Scope (`test/fixtures/README.md`)
Fixtures are minimal, declarative test stubs designed to exercise specific Layer 3 validation rules. They do not contain production application source code.

Each product fixture contains only the metadata files evaluated by Layer 3 rules:
- `package.json` / `pyproject.toml` (package names, repo URLs, license, runtime engines, private flags)
- `LICENSE`
- `.github/workflows/*.yml`
- `.claude-plugin/plugin.json`
- Minimal component stubs (e.g., `skills/<name>/SKILL.md`, `hooks/`)

### 3.3 Product Fixture Inventory & Rule Coverage

| Synthetic Fixture | Metadata Files Present | Baseline State | Intended Mutations / Exercised Rules |
| :--- | :--- | :--- | :--- |
| **`repocode`** | `packages/{cli,core,mcp}/package.json` (`engines.node: ">=20.0.0"`), `LICENSE` (MIT), `.github/workflows/ci.yml` | Valid multi-package npm product | Mutated for `R-META1` (sibling URL mismatch), `R-META2` (private package drift), `R-META3` (license drift), `R-META4` (node floor) |
| **`code-comrades`** | `package.json`, `LICENSE` (MIT), `.claude-plugin/plugin.json`, `.github/workflows/tests.yml`, 10 stub `skills/*/SKILL.md`, `hooks/` | Valid plugin product | Mutated for `R-MK5` (plugin rename), `R-MK7` (skill/hook count drift), `R-META5` (stable product CI requirement) |
| **`graphpowers`** | `pyproject.toml` (`urls.Repository: "nextbridgehq/graphpowers"`), `LICENSE` (MIT), `.claude-plugin/plugin.json`, 11 stub `skills/*/SKILL.md`, `hooks/` | Valid python/plugin product | Mutated for `R-MK7` (missing hooks), `R-MK2` (stray marketplace), `R-META1` (pyproject repo matching) |
| **`package-pilot`** | `package.json` (`"private": true`), `LICENSE` (MIT), `.github/workflows/ci.yml` | Valid private product | Mutated for `R-META2` (distributed publicly while marked private) |
| **`project-charter`** | `pyproject.toml` (`urls.Repository`), `LICENSE` (MIT), `.github/workflows/ci.yml` | Valid python product | Mutated for `R-META1` (repository URL mismatch defect) |
| **`edge-compat-check`** | `package.json`, `LICENSE` (MIT) *(intentionally no `.github/workflows/`)* | Valid product without CI | Baseline intentionally lacks CI to prove `R-META5` fires when maturity is marked `stable` |
| **`agent-loop-guard`** | `package.json`, `LICENSE` (MIT), `.github/workflows/ci.yml` | Valid product | General lifecycle and sync drift fixtures |
| **`block-builder`** | `package.json`, `LICENSE` (MIT), `.github/workflows/ci.yml` | Valid product | General lifecycle and sync drift fixtures |
| **`registry-guard`** | `package.json`, `LICENSE` (MIT), `.github/workflows/ci.yml` | Valid product | General lifecycle and sync drift fixtures |

---

## 4. Test Infrastructure Refactoring

### 4.1 Refactoring `test/lib/fixture.mjs`
- **Decouple from parent directory**:
  Replace `WORKSPACE_ROOT = resolve(ROOT, '..')` with:
  ```javascript
  export const FIXTURES_ROOT = resolve(ROOT, 'test', 'fixtures', 'products');
  ```
- **Preserve API compatibility**:
  `makeWorkspace({ products = ALL_PRODUCTS, prefix = 'nb-fix-' } = {})` preserves its current signature and return shape (`{ root, eco, repo, cleanup }`).
- **Fast, lightweight copying**:
  `copyTree(join(FIXTURES_ROOT, name), join(root, name))` operates on minimal synthetic trees. Fixture copying becomes lightweight and deterministic across both Linux and Windows filesystems.

### 4.2 Module Contract for `test/lib/repos.mjs`
`test/lib/repos.mjs` encapsulates repository resolution without calling `process.exit()`:

```javascript
/**
 * Resolves repository paths for Tier 3 testing with deterministic precedence:
 * 1. Explicit CLI arguments (--repos <dir...>)
 * 2. Environment variable (ECOSYSTEM_REPOS_DIR)
 * 3. Registry-driven sibling discovery (../<product>)
 * 4. Fallback: Graceful Skip (only when discovery was automatic)
 */
export function parseRepoArgs(argv = process.argv.slice(2));
export function discoverSiblingRepos(registry, baseDir);
export function resolveLiveRepos(options = {});
export function formatSkipMessage(reason);
```

#### Deterministic Resolution Precedence
```text
                    resolveLiveRepos()
                           │
              ┌────────────┴────────────┐
              │                         │
        --repos supplied?          No --repos
              │                         │
             YES                  ENV supplied?
              │                    /          \
        validate paths           YES           NO
          │                       │             │
       missing?                validate     registry-driven
       /     \                  paths       sibling lookup
     YES      NO                  │          /         \
      │        │               missing?   found any   none found
    ERROR     RUN                 │          │            │
                                ERROR       RUN          SKIP
```

1. **Explicit `--repos <paths...>`**:
   If any requested repository does not exist on disk, throws a descriptive error immediately (`Explicitly requested repository not found at: <path>`).
2. **Explicit `ECOSYSTEM_REPOS_DIR`**:
   If the specified directory does not exist, throws a descriptive error immediately (`Configured ECOSYSTEM_REPOS_DIR not found at: <path>`). If it exists, discovers indexed products within it.
3. **Implicit Sibling Discovery**:
   Inspects `registry.yaml` for indexed products and checks for directories at `../<product>`.
   - Permissive: Runs against whichever registered products are physically present.
   - Reports discovery stats (`Discovered: N / Total: M`).
4. **Implicit Absent Fallback**:
   If no repositories are discovered and no explicit configuration was provided, marks Tier 3 as gracefully skipped (`reason: 'sibling repositories not available'`).

### 4.3 Test File Classification & Separation

1. **Tier 1 (Contract & Compilation)**:
   - `test/compile.test.mjs`
   - `test/validate.test.mjs` (strictly Layers 1 & 2: schema and referential integrity)
2. **Tier 2 (Synthetic Drift & Fixture Hardening)**:
   - `test/drift-marketplace.test.mjs`
   - `test/drift-repository-fixture.test.mjs` (contains the repository rule tests previously residing in lines 272–418 of `validate.test.mjs`, now running against `FIXTURES_ROOT`)
   - `test/fixture.test.mjs`
   - `test/lifecycle.test.mjs`
   - `test/sync-lifecycle.test.mjs`
   - `test/evolution-plugin.test.mjs`
   - `test/evolution-taxonomy.test.mjs`
   - `test/error-contract.test.mjs`
3. **Tier 3 (Live Repository Integration)**:
   - `test/integration-repos.test.mjs`:
     Executes `resolveLiveRepos()`. If skipped, registers `t.skip(formatSkipMessage(reason))`. If resolved, executes live Layer 3 rules across the discovered repositories.

---

## 5. Scripts & CI Workflows

### 5.1 `package.json` Scripts
```json
{
  "scripts": {
    "validate": "node scripts/validate.mjs",
    "validate:repos": "node scripts/validate.mjs --repos ..",
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

### 5.2 CI Workflow Mapping

#### `validate.yml` (Blocking Pull Request & Main Push)
- **Environment**: Standalone checkout of `nextbridgehq/ecosystem`.
- **Character**: Hermetic with respect to product repositories; deterministic and independent of sibling checkouts.
- **Execution**:
  ```bash
  npm ci
  node scripts/validate.mjs
  npm test
  node scripts/compile.mjs --check
  ```
- **Output Experience**:
  - Tier 1: All contract & compilation tests pass.
  - Tier 2: All fixture & drift tests pass against synthetic products.
  - Tier 3: `○ Tier 3 — Live repository integration: SKIPPED (sibling repositories not available)`
  - Total: 100% Green CI on every commit.

#### `repo-consistency.yml` (Scheduled & PR Cross-Repository Verification)
- **Environment**: Clones `nextbridgehq/ecosystem` and shallow-clones all 9 registered product repositories as siblings (`..`).
- **Execution**:
  ```yaml
  - name: Live repository integration tests (Tier 3)
    working-directory: ecosystem
    env:
      ECOSYSTEM_REPOS_DIR: ..
    run: npm run test:repos
  ```
- **Output Experience**:
  - Tier 3: `✓ Tier 3 — Live repository integration: 9/9 repositories verified`

---

## 6. Verification Plan

1. **Local Clean Verification (Tier 1 + Tier 2 + Tier 3 Skip)**:
   - Run `npm test` inside an isolated directory without sibling repositories.
   - Verify all Tier 1 and Tier 2 tests pass.
   - Verify Tier 3 emits `○ Tier 3 — Live repository integration: SKIPPED (sibling repositories not available)` with exit code 0.
2. **Local Integration Verification (Tier 3 Live)**:
   - Run `npm run test:repos` with `ECOSYSTEM_REPOS_DIR=..`.
   - Verify all 9 sibling repositories are discovered and pass Layer 3 checks.
3. **Explicit Error Semantics Verification**:
   - Run `npm run test:repos -- --repos /nonexistent/path`.
   - Verify it throws an error and fails immediately without silent skipping.
4. **CI Compatibility Verification**:
   - Verify `validate.yml` workflow simulation executes cleanly without external network calls to product repositories.
