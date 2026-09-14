# Nextbridge Ecosystem

The schema, taxonomy, registry, and validation that describe the Nextbridge
developer ecosystem — plus two generated artifacts: a compiled catalog and the
one canonical Claude Code marketplace.

This repository is not a product, a website, or a marketplace application. It is
a contract and three scripts.

---

## What is here

```
registry.yaml                     where each product fits          (authored)
taxonomy/capabilities.yaml        controlled capability vocabulary (authored)
schema/                           product, registry, taxonomy, catalog schemas
manifests/                        snapshots of each product's own manifest (synced)
catalog.json                      the merged view                  (generated)
.claude-plugin/marketplace.json   the canonical marketplace        (generated)
scripts/validate.mjs              three layers of validation
scripts/compile.mjs               produces both generated artifacts
scripts/sync.mjs                  refreshes manifests/ from the product repos
```

## The model

```
PRODUCT REPOSITORY               THIS REPOSITORY                 GENERATED
──────────────────────           ─────────────────────           ─────────────────
.nextbridge/product.yaml   ───►  manifests/<id>.yaml
  what the product is              registry.yaml           ───►  catalog.json
                                     family, positioning
.claude-plugin/plugin.json           marketplace.members   ───►  .claude-plugin/
  what the plugin contains           integrations: []              marketplace.json
  (product-owned, untouched)         solutions: []
                                   taxonomy/capabilities.yaml
```

Products define themselves. The ecosystem indexes them and decides positioning.
Everything downstream is compiled. Nothing is written in two places.

## Current state

All nine products are described. `integrations` and `solutions` are empty — and
the ecosystem is complete and useful in that state, by design.

| | |
|---|---|
| Products indexed | 9 |
| Products described | 9 |
| Capabilities in the taxonomy | 42 across 8 categories, every one claimed |
| Nextbridge-to-Nextbridge integrations | 0 |
| External integrations declared by products | 3 — Repomix, Graphify, Superpowers |
| Solutions | 0 |
| Plugins in the canonical marketplace | 2 — `code-comrades`, `graphpowers` |

With nothing pending, R-REF8 is now an error rather than a warning: a capability
no product claims is dead vocabulary and fails the build. Today none is orphaned.

Both plugins were installed from the compiled marketplace with
`claude plugin install <name>@nextbridge` and load with the component
inventories their manifests declare. The two per-product marketplaces they used
to publish (`code-comrades-marketplace`, `graphpowers-marketplace`) are deleted.

Zero integrations is a finding, not a gap: the Phase 0 audit established that no
Nextbridge product references any other. Rule R-REF5 therefore makes
`maturity: integrated` unreachable, which is what makes that level mean
something.

## Usage

```bash
npm ci

node scripts/validate.mjs              # layers 1 and 2, offline
node scripts/validate.mjs --repos ..   # adds layer 3 against local checkouts
node scripts/compile.mjs               # regenerate catalog and marketplace
node scripts/compile.mjs --check       # fail if either is out of date
node scripts/sync.mjs --repos ..       # refresh manifests/ from product repos
npm test
```

Exit codes are the API: `0` clean, `1` usage or internal error, `2` validation
errors or drift.

## Validation

Three layers. Layers 1 and 2 are offline and always run; layer 3 needs the
product repositories on disk.

**Layer 1 — structural.** JSON Schema over every authored and generated artifact.

**Layer 2 — referential.**

| Rule | What it enforces |
|---|---|
| R-TAX1 | Every capability belongs to a real category |
| R-REF1 | Every declared capability exists in the taxonomy |
| R-REF2 | `manifest_status` matches what is actually synced |
| R-REF3 | Integration endpoints resolve, or are marked `external` |
| R-REF4 | `status: verified` requires a `verification` block |
| R-REF5 | `maturity: integrated` requires a verified internal integration |
| R-REF6 | Solution references resolve |
| R-REF7 | Every product's family exists |
| R-REF8 | Unclaimed capabilities are reported |
| R-REF9 | Every product has a surface: at least one interface or one plugin |
| R-MK1 | Exactly one marketplace here, matching the registry |
| R-MK3 | Manifests and marketplace membership agree, both ways |
| R-MK4 | Plugin names are unique across the ecosystem |
| R-MK6 | A product may not declare its own marketplace |

**Layer 3 — repository consistency.**

| Rule | What it enforces |
|---|---|
| R-META1 | The declared repository matches the repository's own metadata |
| R-META2 | Declared packages exist and are publishable |
| R-META3 | Licence agrees, and a LICENSE file exists |
| R-META4 | Declared runtime floor matches `engines.node` / `requires-python` |
| R-META5 | `maturity: stable` requires observable CI |
| R-MK2 | No product repository ships a competing Nextbridge marketplace |
| R-MK5 | A declared plugin manifest exists and agrees on its name |
| R-MK7 | Declared component counts match the repository |
| R-SYNC1 | The snapshot in `manifests/` matches the product repository |

R-META1, R-META2 and R-META5 each catch a real defect found by hand during the
Phase 0 audit. The test suite proves that against the actual repositories.

## Anti-fragmentation

There is one Nextbridge Claude Code marketplace: `nextbridge`.

- A product declares its plugins in its own manifest with `marketplace: nextbridge`. Any other value is a validation error (**R-MK6**).
- No product repository may contain `.claude-plugin/marketplace.json` (**R-MK2**). It is a warning while a product has no manifest and an error once it joins the model, so consolidation enforces itself. No repository ships one today.
- Plugin names are globally unique (**R-MK4**).
- Membership and manifests must agree in both directions (**R-MK3**).
- Adding a plugin is two lines: one `plugins[]` entry in the product, one `members[]` entry here.

Marketplace membership is **distribution, not integration**. Two plugins sharing
a marketplace have no relationship in `catalog.json`, and nothing in the
marketplace path can write to `integrations`.

## Adding a product

1. Write `.nextbridge/product.yaml` in the product repository against `schema/product.v1.schema.json`.
2. Add or update that product's entry in `registry.yaml` with `repository`, `family`, and `manifest_status: present` (a new product has no existing entry to "set" a field on — it needs the whole entry).
3. `node scripts/sync.mjs --repos ..`
4. `node scripts/validate.mjs --repos ..`
5. `node scripts/compile.mjs`
6. Commit the manifest snapshot and both regenerated artifacts.

If a capability you need is missing from the taxonomy, add it there in the same
change — with a `note` if it sits close to an existing one.

## Not built here

No marketplace website or UI, no billing, no analytics, no health scores, no
certification, no ecosystem CLI, no product-to-product integrations. Each
becomes arguable when there is something real to build it on.

## Documentation

- [docs/ADDING-A-PRODUCT.md](docs/ADDING-A-PRODUCT.md) — the operational
  contract for adding or retiring a product or plugin.
- [manifests/README.md](manifests/README.md) — why `manifests/` is generated
  and must not be edited.
- [docs/PHASE-2-SPEC.md](docs/PHASE-2-SPEC.md) and
  [docs/PHASE-2-REPORT.md](docs/PHASE-2-REPORT.md) — the hardening phase.

## License

MIT © Nextbridge
