# Cross-Repository Standardization & GitHub Sync Design Specification

**Status:** Approved  
**Date:** 2026-09-18  
**Scope:** Phase A — Cross-Repository Standardization, Compliance Validation, and Local Synchronization for the 9 Nextbridge Sibling Repositories  

---

## 1. Executive Overview

The Nextbridge developer ecosystem consists of 9 distinct product repositories (`repocode`, `code-comrades`, `graphpowers`, `package-pilot`, `project-charter`, `edge-compat-check`, `agent-loop-guard`, `block-builder`, `registry-guard`) indexed and described within `ecosystem`. 

Phase A establishes:
1. A formal, machine-verifiable **Repository Compliance Contract** covering identity, governance, documentation, marketplace integrity, package metadata, and maturity-aware CI.
2. A read-only **Compliance Validator Engine** (`scripts/compliance.mjs`) executing 7 independent, granular rules against local sibling checkouts and synthetic fixtures.
3. A safe, deterministic, idempotent **Standardization Engine** (`scripts/standardize.mjs`) featuring a transaction-safe mutation planner (`--plan`), explicit safety gates, and post-apply validation.
4. A staged, strictly local rollout pipeline that proves tooling against synthetic fixtures first, generates an immutable approval plan, applies changes to local checkouts, and validates consistency—with **zero network access** and **zero git pushes**.

---

## 2. Architectural Boundaries & Authority Model

```
                    NEXTBRIDGE ECOSYSTEM
                             │
                ┌────────────┴────────────┐
                │                         │
         Product Authority          Global Authority
                │                         │
   .nextbridge/product.yaml          ecosystem/
   • name, short description         • canonical templates (SECURITY, CONTRIBUTING)
   • capabilities, runtime           • canonical marketplace definition (@nextbridge)
   • plugins, maturity               • capability taxonomy & registry positioning
                │                         │
                └────────────┬────────────┘
                             ▼
                   Compliance Validator
                             │
     ┌──────────┬────────────┼────────────┬──────────┐
     ▼          ▼            ▼            ▼          ▼
  Identity  Governance     README    Marketplace  Package
  (R-STD-ID)(R-STD-GOV)   (R-STD-DOC) (R-STD-MKP) (R-STD-PKG)
                             │
                             ▼
                       Maturity / CI
                        (R-STD-CI)
                             │
                             ▼
                    Sync Integrity Gate
                       (R-STD-SYNC)
```

- **`.nextbridge/product.yaml` is the Single Source of Truth for Product Identity**:
  `name`, `description.short`, `capabilities`, `runtime`, `plugins`, and `maturity` are authoritative within the product repository.
- **`ecosystem/` is the Authority for Global Standards & Governance**:
  `ecosystem/manifests/<id>.yaml` is the validated catalog projection; canonical templates, marketplace naming (`nextbridge`), ecosystem badges, and verification rules are owned by `ecosystem`.
- **Product Code & Internal Documentation are Untouched**:
  Source code, package dependencies, internal architecture notes, and scripts are strictly preserved.

---

## 3. Section 1: The Repository Compliance Contract

The contract evaluates each product repository against seven independent rules:

### 3.1 Rule Specifications

#### `R-STD-ID` (Product Identity)
- **Requirement**: `.nextbridge/product.yaml` must exist, validate against `schema/product.v1.schema.json`, and define all required product attributes.
- **Authoritative Fields**: `id`, `name`, `description.short`, `capabilities`, `runtime`, `plugins`, `maturity`.
- **Failure Condition**: Missing manifest, schema syntax error, or undefined authoritative identity fields.

#### `R-STD-GOV` (Governance Files)
- **Requirement**: Every repository must contain `LICENSE`, `SECURITY.md`, and `CONTRIBUTING.md`.
- **Canonical Delimiters**: Governance files must include the standard Nextbridge block bounded by:
  ```markdown
  <!-- NEXTBRIDGE:BEGIN -->
  ... canonical policy text ...
  <!-- NEXTBRIDGE:END -->
  ```
- **Extension Allowance**: Legitimate repository-specific guidance is allowed beneath `<!-- NEXTBRIDGE:END -->`.
- **Safety Policy**: An existing `LICENSE` file is **never** automatically overwritten. Disagreements between `LICENSE` and declared `product.yaml` license emit `REPORT_ONLY` findings requiring human review.

#### `R-STD-DOC` (README & Ecosystem Badging)
- **Requirement**: `README.md` must begin with the canonical Nextbridge Ecosystem badge linking to `nextbridgehq/ecosystem`, followed by a bounded metadata block:
  ```markdown
  [![Nextbridge Ecosystem](https://img.shields.io/badge/Nextbridge-Ecosystem-blue)](https://github.com/nextbridgehq/ecosystem)
  
  <!-- NEXTBRIDGE:METADATA:BEGIN -->
  > **Part of the [Nextbridge Developer Ecosystem](https://github.com/nextbridgehq/ecosystem)**
  > **Family:** <family-name> | **Maturity:** <maturity>
  > **Capabilities:** `<cap-1>`, `<cap-2>`
  <!-- NEXTBRIDGE:METADATA:END -->
  ```
- **Bounded Invariant**: The remainder of the `README.md` (installation, features, usage, architecture) is owned by the product and remains untouched.

#### `R-STD-MKP` (Marketplace Discipline & Stale Reference Scan)
- **Requirement**: For published plugins, documentation must reference only the canonical Nextbridge marketplace (`claude plugin install <name>@nextbridge`).
- **Repository-Wide Scan**: Scans documentation, examples, and configurations (`*.md`, `*.mdx`, `*.yaml`, `*.yml`, `*.json`, `*.ts`, `*.js`, `*.py`) excluding ignored directories (`.git/`, `node_modules/`, `dist/`, `build/`, `coverage/`, `vendor/`).
- **Prohibited Identifiers**: Defined in `config/compliance.yaml` (`code-comrades-marketplace`, `graphpowers-marketplace`). Any occurrence is an immediate `FAIL`.

#### `R-STD-PKG` (Canonical Package Metadata)
- **Requirement**: Validates package manifests (`package.json` for Node, `pyproject.toml` for Python) conditionally based on the package ecosystem.
- **Canonical Fields**:
  - `repository`: Canonical GitHub URL (`nextbridgehq/<repo>`).
  - `author` / `maintainer`: Must reference `Nextbridge`.
  - `bugs` / `issues`: Canonical GitHub issues URL if present.
- **Product-Owned Fields**: `description`, `keywords`, `dependencies`, `devDependencies`, `engines`, `scripts`, and Python classifiers remain strictly product-owned.
- **Field Status Model**: Distinct from overall rule result (`VALID`, `MISSING`, `INVALID`, `MISMATCH`, `NOT_APPLICABLE`).

#### `R-STD-CI` (Maturity-Aware CI Matrix)
- **Requirement**: Evaluates GitHub Actions workflows (`.github/workflows/*.yml`) against product maturity:

| Maturity | CI Workflows Present | `ci_exempt: true` Declared | Evaluation Result |
|---|---|---|---|
| `stable` | Yes (≥1 workflow) | No | **PASS** |
| `stable` | No (0 workflows) | Any | **FAIL** (Stable products must run CI) |
| `stable` | Yes | Yes | **FAIL** (Exemption prohibited for stable) |
| `experimental` | Yes | Any | **PASS** |
| `experimental` | No | Yes | **PASS** (Exemption valid & auditable) |
| `experimental` | No | No | **WARN** (Unexempt experimental lacking CI) |

*Application*: `edge-compat-check` is `experimental` with `ci_exempt: true`, validating cleanly without masking gaps.

#### `R-STD-SYNC` (Canonical Synchronization Integrity)
- **Requirement**: Verifies that downstream projections match the authoritative `.nextbridge/product.yaml`:
  - `ecosystem/manifests/<id>.yaml` is a bit-for-bit snapshot of `.nextbridge/product.yaml`.
  - `README.md` bounded metadata block semantically reflects authoritative attributes (normalized comparison, whitespace/formatting resilient).
  - `catalog.json` accurately reflects compiled product properties.

---

## 4. Section 2: Compliance Validator Engine

### 4.1 Pipeline Architecture
The validator separates repository discovery, context loading, and rule evaluation into a clean pipeline:

```
Repository Discovery (discoverSiblingRepos)
        ↓
Product Context Loader (loadProductContext)
  • Parse product.yaml & manifest snapshot
  • Parse package.json / pyproject.toml
  • Load README.md, SECURITY.md, CONTRIBUTING.md, LICENSE
  • Enumerate workflows & scan candidate doc/code files
        ↓
Rule Evaluators (evaluateRule)
  • Identity, Governance, Documentation, Marketplace, Package, CI, Sync
        ↓
Finding Collector (Standardized Finding Codes)
        ↓
Status Aggregator (PASS | WARN | FAIL)
        ↓
Reporter (Human Matrix / Machine JSON)
```

### 4.2 Configuration Model (`config/compliance.yaml`)
Rules, deprecated marketplace identifiers, and path exclusions are externalized into configuration:
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

templates:
  security: "templates/SECURITY.md"
  contributing: "templates/CONTRIBUTING.md"

package_metadata:
  expected_author: "Nextbridge"
  expected_org: "nextbridgehq"
```

### 4.3 Standardized Finding Codes
Findings use stable, machine-readable codes:
- `MISSING_PRODUCT_MANIFEST`, `SCHEMA_VALIDATION_ERROR`
- `MISSING_LICENSE`, `LICENSE_MISMATCH`
- `MISSING_SECURITY_POLICY`, `INVALID_SECURITY_DELIMITERS`
- `MISSING_CONTRIBUTING_GUIDE`, `INVALID_CONTRIBUTING_DELIMITERS`
- `MISSING_ECOSYSTEM_BADGE`, `README_METADATA_DRIFT`
- `STALE_MARKETPLACE_REFERENCE`, `UNCANONICAL_PLUGIN_INSTALL_SYNTAX`
- `PACKAGE_COORDINATE_MISMATCH`, `MISSING_PACKAGE_AUTHOR`
- `UNEXEMPT_CI_MISSING`, `INVALID_CI_EXEMPTION`
- `CATALOG_PROJECTION_DRIFT`

### 4.4 CLI & Exit Code Contract
```bash
node scripts/compliance.mjs --repos-dir <dir> [--json] [--strict] [--product <id>]
```
- **Exit 0**: All evaluated checks passed cleanly.
- **Exit 1**: One or more `FAIL` findings detected (or `WARN` findings when `--strict` is set).
- **Exit 2**: Invalid CLI arguments or malformed configuration file.
- **Exit 3**: Repository or catalog resolution error (target directory not found).

---

## 5. Section 3: Standardization & Scaffolding Engine

### 5.1 Design Principles & Operational Flow
The standardizer is a deterministic, non-destructive remediation engine:

```
                    standardize.mjs
                           │
                    Repository Discovery
                           │
                    Pre-Flight Compliance
                           │
                    Mutation Planner
                           │
                 ┌─────────┴─────────┐
                 │                   │
             AUTO-FIX            REPORT ONLY
                 │                   │
          Safety Gate               │
          (Clean Tree)               │
                 │                   │
          Apply Mutations            │
                 │                   │
                 └─────────┬─────────┘
                           ▼
                 Post-Apply Compliance
                           │
                           ▼
                 Run Report / Manifest
```

### 5.2 Operating Modes
| Mode | Mutates Files? | Description | Exit Code |
|---|---|---|---|
| Default (Preview) | ❌ | Displays unified diffs and proposed changes | `0` unless execution error |
| `--plan` | ❌ | Emits immutable approval plan artifact with file hashes | `0` |
| `--check` | ❌ | Verifies compliance; exits non-zero on drift | `0` if compliant, `1` on drift |
| `--apply` | ✅ | Applies safe mutations and runs post-validation | `0` on success, `1` on failure |

### 5.3 Mutation Classifications & Safety Rules
1. `CREATE`:
   - Used for missing `SECURITY.md` and `CONTRIBUTING.md` using canonical templates.
   - Prohibited for `LICENSE` if an existing file is present.
2. `UPDATE_CANONICAL_BLOCK`:
   - Used for updating bounded zones in `SECURITY.md`, `CONTRIBUTING.md` (`<!-- NEXTBRIDGE:BEGIN -->`), and `README.md` (`<!-- NEXTBRIDGE:METADATA:BEGIN -->`).
   - Content outside delimiters is preserved byte-for-byte.
   - For existing governance files lacking delimiters: default is `REPORT_ONLY`. Prepending requires explicit `--adopt-governance` flag.
3. `SAFE_REPLACE`:
   - Used for known, unambiguous deprecated marketplace string replacements (`code-comrades@code-comrades-marketplace` → `code-comrades@nextbridge`).
   - Ambiguous matches are classified as `REPORT_ONLY`.
4. `REPORT_ONLY`:
   - Discrepancies requiring human judgment (e.g. third-party repository URLs, conflicting license files, ambiguous code references).
5. `SKIP`:
   - Files already in full compliance.

### 5.4 Safety Gates & Transactional Model
- **Working Tree Gate**: Refuses execution on dirty git checkouts unless `--force` is explicitly provided.
- **Plan Integrity Check**: When running `--apply --plan-file <path>`, verifies that file hashes on disk match the approved plan before modifying anything.
- **Post-Apply Full Run**: If post-apply validation detects residual findings, it evaluates all repositories, reports all remaining findings across the entire ecosystem, and exits with code 1.
- **Zero Git Side-Effects**: `standardize.mjs` only touches files. It never runs `git add`, `git commit`, `git stash`, or `git reset`.

---

## 6. Section 4: Staged Rollout, Verification & GitHub Sync Pipeline

### 6.1 The Five Rollout Stages

```
Stage 1: Engine Construction & Synthetic Fixture Proof (Hermetic ecosystem/)
   ↓
Stage 2: Pre-Flight Audit & Immutable Mutation Plan Generation (--plan)
   ↓
Stage 3: Controlled Local Remediation (--apply + post-validation)
   ↓
Stage 4: End-to-End Ecosystem Verification (Full test suite + strict compliance)
   ↓
Stage 5: Local Git Staging & Review Gate (Zero pushes)
```

### 6.2 Guarantees & Invariants
- **No Network Guarantee**: Stages 1 through 4 execute 100% offline. No git remotes are contacted, no packages fetched or published.
- **Ecosystem Clean Gate**: Stage 2 will not begin until Stage 1 passes all tests and `ecosystem` has a clean git working tree.
- **Zero Push Gate**: Stage 5 prepares local review diffs and suggested commit messages. No branches or tags are pushed to remote repositories.

### 6.3 Verification Suite
1. `node --test test/compliance.test.mjs`: Proves all 7 compliance rules against hermetic fixtures in `test/fixtures/compliance/`.
2. `node --test test/standardize.test.mjs`: Proves idempotent scaffolding, delimiter preservation, and non-destructive replacement against temporary workspaces.
3. `npm run check`: Layer 1 & 2 validation clean; catalog and marketplace up to date.
4. `npm test`: All 123 Tier 1, 2, 3 ecosystem tests pass.
5. `node scripts/compliance.mjs --repos-dir .. --strict`: All 9 sibling checkouts pass all 7 compliance rules with zero errors and zero warnings.

---

## 7. Deliverables & File Mapping

```
ecosystem/
├── config/
│   └── compliance.yaml                  # Config-driven rules, exclusions, deprecated IDs
├── templates/
│   ├── SECURITY.md                      # Canonical Nextbridge security policy template
│   └── CONTRIBUTING.md                  # Canonical Nextbridge contribution guide template
├── scripts/
│   ├── compliance.mjs                   # Compliance audit CLI runner
│   ├── standardize.mjs                  # Deterministic scaffolding & remediation CLI runner
│   └── lib/
│       ├── compliance/
│       │   ├── discovery.mjs            # Sibling repository path resolver & traversal safety
│       │   ├── context.mjs              # Product context loader
│       │   ├── evaluator.mjs            # Rule dispatch & aggregation
│       │   ├── reporter.mjs             # Matrix & JSON formatting
│       │   └── rules/
│       │       ├── identity.mjs         # R-STD-ID
│       │       ├── governance.mjs       # R-STD-GOV
│       │       ├── documentation.mjs    # R-STD-DOC
│       │       ├── marketplace.mjs      # R-STD-MKP
│       │       ├── package.mjs          # R-STD-PKG
│       │       ├── ci.mjs               # R-STD-CI
│       │       └── sync.mjs             # R-STD-SYNC
│       └── standardize/
│           ├── planner.mjs              # Mutation planner & classification
│           ├── safety.mjs               # Dirty-tree & plan hash verification
│           ├── applier.mjs              # Delimited block injection & safe replacement
│           └── reporter.mjs             # Operation manifest generator
├── test/
│   ├── compliance.test.mjs              # Synthetic fixture test suite for compliance rules
│   ├── standardize.test.mjs             # Synthetic fixture test suite for standardizer
│   └── fixtures/
│       └── compliance/                  # Minimal test fixtures for all PASS/FAIL conditions
└── package.json                         # npm run compliance, npm run standardize
```
