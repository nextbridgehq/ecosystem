# Phase 2 — Ecosystem Hardening (Spec)

Status: accepted, not yet implemented
Supersedes nothing. Follows Phase 1.5, which is accepted and complete.

## Why this phase exists

Phase 1.5 proved the model: nine heterogeneous products are represented under
one schema, the registry curates membership, the compiler produces
`catalog.json` and one canonical `marketplace.json`, and both published plugins
install and load from that compiled marketplace.

What is *not* yet proven is that the ecosystem stays trustworthy while the
products evolve independently of it. Phase 1.5 produced direct evidence that
this is the real risk:

- marketplace metadata had drifted from product versions
- Python compatibility documentation was wrong
- the GraphPowers plugin failed to load from *any* marketplace, while schema
  validation passed
- Code Comrades was marked `stable` with no CI
- Package Pilot had no repository metadata
- Project Charter pointed at the wrong GitHub owner
- Edge Compat Check still has a Windows path-separator defect
- GraphPowers' `ci/upstream-watch.yml` was never installed into
  `.github/workflows/`, so its intended verification never ran

Every one of those was found by hand. Phase 2 turns the ecosystem from a
cataloguing system into a continuously validated one, so the next one is found
by a check.

## Goal

> A new Nextbridge product can be added without architectural intervention, and
> an existing product can evolve without silently making the ecosystem stale or
> misleading.

## Non-goals — explicitly out of scope

These are deferred by decision, not oversight:

- **No integrations.** `registry.integrations` stays `[]`.
- **No solutions.** `registry.solutions` stays `[]`.
- **No marketplace UI, website, or CLI.**
- **No changes to `product.v1`** unless a real product proves it insufficient.
  The schema freeze in [SCHEMA-FREEZE.md](SCHEMA-FREEZE.md) holds.
- **No maturity model change.** O2 stays deferred. The eventual shape
  (`declared_maturity` plus a computed `ecosystem_status` with observable
  checks) is recorded here as intent only; Phase 2 does not implement it.
- **No git initialisation of the nine product directories**, and **no
  connection or push to the real `nextbridgehq` remotes.**

## The three levels

Phase 2 proves Levels 1 and 2. Level 3 belongs to a later, deliberate
publishing phase.

### Level 1 — deterministic local

```
fixtures -> validate -> compile -> byte-for-byte comparison
```

No network, no git. Proves that the same inputs always produce the same two
artifacts, and that a hand-edited artifact is rejected.

### Level 2 — disposable git lifecycle

```
temporary git repos -> modify product -> sync -> PR-like diff -> validate -> compile
```

Disposable git repositories created by the test harness, containing copies of
the ecosystem and product fixtures, exercising the same commands CI runs.

### Level 3 — actual production CI (NOT in Phase 2)

```
nextbridgehq/ecosystem -> GitHub PR -> GitHub Actions -> real product repositories
```

### What "clean checkout" may and may not claim

A fresh temporary copy of the ecosystem fixture, with the CI-equivalent
commands run from that clean state, proves **the workflows' underlying commands
and clean-checkout reproducibility**. It does **not** prove GitHub PR execution.
Actual GitHub Actions execution is verified only once the ecosystem repository
is pushed. Reports produced by this phase must state the distinction.

## Hardening objective

> Reproducible and continuously testable without requiring the real product
> repositories to be git repositories locally, and without requiring network
> access.

Network-dependent Layer 3 behaviour is tested against disposable fixtures, not
against live GitHub.

## The five questions Phase 2 must answer

1. **Does the registry stay synchronized?** Prove the full lifecycle:
   product change → sync detects → ecosystem change → validation → catalog
   regeneration → marketplace regeneration.
2. **Can the ecosystem detect real repository regressions?** Metadata drift,
   package/distribution drift, runtime drift, marketplace violations, plugin
   component drift, taxonomy drift — without becoming so strict that legitimate
   product evolution is blocked. Every drift scenario needs a paired negative
   test proving a *legitimate* change does not fire the rule.
3. **What does maturity actually mean?** Gather evidence only. Do not change it.
4. **Is the snapshot boundary enforced?** `product.yaml` is authoritative;
   `manifests/*.yaml` is a generated cache. Humans must never edit
   `manifests/*.yaml` directly. R-SYNC1 is the load-bearing rule here, not an
   implementation detail.
5. **Is the operational contract written down?** Adding a future product or
   plugin must be a documented procedure, not an act of architecture.

## Known constraints discovered while scoping

These are facts about the current code that the implementation must respect.

### C1 — `layer3` resolves the snapshot through the module-global `paths`

`scripts/lib/rules.mjs` reads the snapshot for R-SYNC1 via
`paths.manifests`, and `loadManifests()` in `scripts/lib/io.mjs` does the same.
`paths` is derived from `ROOT`, which is derived from `import.meta.url` — the
location of the *script*, not the working directory.

Consequence: a fixture ecosystem cannot be validated in-process by importing
the real `rules.mjs`. It **can** be validated by copying the whole ecosystem
tree into the fixture and running the copied `scripts/*.mjs` as subprocesses,
because `ROOT` then resolves to the fixture. Phase 2 uses the subprocess
approach and **does not** parameterise `ROOT`. Adding a root parameter is a
change to shipped code in service of tests; copying the tree is not.

### C2 — `sync.mjs` copies bytes, so `manifests/*.yaml` cannot carry a banner

R-SYNC1 compares the snapshot to the product's `product.yaml` byte for byte
(after CRLF normalisation). A "generated file — do not edit" banner inside the
YAML would make every snapshot differ from its source. The snapshot boundary
must therefore be enforced *outside* the files: a `manifests/README.md`, the
ecosystem README, `.gitattributes`, and R-SYNC1 itself.

### C3 — `node_modules` must reach the fixture without being copied

The fixture ecosystem needs `ajv` and `js-yaml`. Copying `node_modules` per
fixture is slow. Use a directory junction on Windows
(`symlinkSync(src, dst, 'junction')`) and a symlink elsewhere.

### C4 — a clean Claude environment is available via `CLAUDE_CONFIG_DIR`

Verified: setting `CLAUDE_CONFIG_DIR` to an empty temporary directory yields
`No marketplaces configured` and writes a fresh `.claude.json` there. Clean
Claude environment verification therefore never touches the developer's real
configuration.

### C5 — `edge-compat-check` fails its own test suite on Windows

Known, deliberately out of scope, and unchanged by this phase.

## Current baseline (must not regress)

```
node scripts/validate.mjs --repos ..   0 errors, 0 warnings, 1 skipped
node scripts/compile.mjs --check       unchanged, unchanged
node scripts/sync.mjs --repos .. --check   0 change(s)
npm test                               60 pass, 0 fail
```

Rules in force: R-META1..5, R-MK1..7, R-REF1..9, R-SYNC1, R-TAX1.

## Local environment state

The retired `code-comrades-marketplace` and `graphpowers-marketplace` sources
and their stale plugin installs were removed from the developer's Claude
configuration, leaving only `nextbridge` with `code-comrades@nextbridge` 0.3.0
and `graphpowers@nextbridge` 0.3.1, both enabled. This was a local
configuration cleanup only; the ecosystem repository was already correct.

Noted, not acted on: `<local dev machine>\graphpowers` is a separate, stale 0.1.0
working copy of GraphPowers, unrelated to the sibling product directory. No
marketplace references it any more.
