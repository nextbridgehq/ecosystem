# Marketplace consolidation — record

**Done:** 2026-09-10
**Scope:** `code-comrades` and `graphpowers` moved from two per-product
marketplaces to the one canonical `nextbridge` marketplace.

---

## What changed

| Repository | Before | After |
|---|---|---|
| `code-comrades` | `.claude-plugin/marketplace.json` declaring `code-comrades-marketplace` | Deleted. `.nextbridge/product.yaml` declares the plugin; membership lives in `registry.yaml` |
| `graphpowers` | `.claude-plugin/marketplace.json` declaring `graphpowers-marketplace` | Deleted. Same model |
| `ecosystem` | `marketplace.members: []`, generated marketplace with zero plugins | Two members; the generated marketplace carries both plugins |

Neither `plugin.json` moved, and neither was rewritten to point at the
ecosystem. The product still owns what its plugin *is*; the ecosystem owns
whether it is *published*, and the marketplace document is compiled from both.

## Order of operations

The sequence mattered, and it was followed exactly:

1. Manifests written in both product repositories, with `marketplace: nextbridge`.
2. Both added to `registry.yaml` — `manifest_status: present` and a
   `marketplace.members` entry each — then synced and compiled.
3. **Installation verified from the compiled marketplace** (below).
4. **Only then** the two per-product `marketplace.json` files were deleted and
   both READMEs and CHANGELOGs updated.

Between steps 2 and 4, layer 3 validation was legitimately red: R-MK2 escalates
from warning to error the moment a product with a stray marketplace gains a
manifest. That window is the rule doing its job, and it was not suppressed,
weakened, or bypassed. `compile.mjs` still ran, because it gates on layers 1
and 2 only and R-MK2 is a layer 3 rule.

## Installation verification

Run against the real compiled `marketplace.json` with `claude` 2.1.267.

```
claude plugin validate .claude-plugin/marketplace.json   → Validation passed
claude plugin marketplace add ./                         → added marketplace: nextbridge
claude plugin install code-comrades@nextbridge           → installed (scope: user)
claude plugin install graphpowers@nextbridge             → installed (scope: user)
```

`claude plugin details` then reported, from the installed plugins:

| Plugin | Skills | Agents | Hooks | Manifest declares |
|---|---|---|---|---|
| `code-comrades` 0.3.0 | 10 | 1 | 0 | skills 10, agents 1, hooks false |
| `graphpowers` 0.3.1 | 11 | 0 | 1 (SessionStart) | skills 11, agents 0, hooks true |

The descriptions shown by the CLI are the ones the compiler took from each
product manifest, so the whole path — product manifest, registry membership,
compiled marketplace, installed plugin — is verified end to end, not asserted.

## Three defects the verification found

**1. `graphpowers` failed to load, from either marketplace.**

```
Hook load failed: Duplicate hooks file detected: ./hooks/hooks.json resolves to
already-loaded file ...\hooks\hooks.json. The standard hooks/hooks.json is loaded
automatically, so manifest.hooks should only reference additional hook files.
```

`plugin.json` declared `"hooks": "./hooks/hooks.json"`, which Claude Code
already loads by convention. The plugin was rejected at load time — including
from its own `graphpowers-marketplace`, so this predates consolidation. The
declaration is removed and the plugin now loads.

Worth noting: `claude plugin validate` passes on the broken manifest. Only an
actual install surfaced it, which is why "verify installation" is a step and
not a formality.

**2. `code-comrades` documented a Python floor it never supported.**

The README said 3.8+. `scripts/verify.py` annotates with PEP 585 builtin
generics (`dict[str, Any]`) that are evaluated at import time, so the code
cannot run on 3.8. Corrected to 3.9 in the README, the new CI matrix, and the
product manifest.

**3. Fragmented marketplaces had already drifted.**

The two per-product marketplaces, as configured on a real developer machine,
served `code-comrades` 0.2.0 and `graphpowers` 0.1.0 while the repositories were
at 0.3.0 and 0.3.1. Consolidation is not only tidiness: two publication paths
had produced two stale ones.

## Follow-on repository changes

- `code-comrades/.github/workflows/tests.yml` — the repository had 145 passing
  tests under `scripts/` and no workflow running them, which is what R-META5
  caught the moment its manifest landed. The suite runs on 3.9 and 3.12.

## One prediction the evidence overturned

`NINE-PRODUCT-REPRESENTATION.md` expected the GraphPowers → Graphify
integration to be the portfolio's first `status: verified`, backed by
`ci/upstream-watch.yml`. That workflow is **not installed**: it sits in `ci/`
with a header saying to copy it into `.github/workflows/` when publishing, and
`.github/workflows/` contains only `tests.yml` and `release-please.yml`. Nothing
runs the canary that would exercise a real Graphify install, so the manifest
declares `status: supported`, not `verified`. The repository's own tests do
guard the `graph.json` node-link contract, but against fixtures, not against
Graphify.

Moving `ci/upstream-watch.yml` into `.github/workflows/` would make `verified`
truthful. That is a product-repository decision, not an ecosystem one, and it
has not been made here.

## State immediately after consolidation

```
node scripts/validate.mjs --repos ..   → 0 errors, 15 warnings (all R-REF8), 1 skip
node scripts/compile.mjs               → 4 of 9 described, 2 plugins in "nextbridge"
npm test                               → 57 passing
```

The remaining five manifests landed after this, one at a time; the end state is
all nine described, 0 errors and 0 warnings, and the same two plugins in the
marketplace. Marketplace membership did not change: seven of the nine products
ship no plugin, and distribution is not integration.

## For the reader installing today

The `github` plugin source clones over **SSH by default**. Without a GitHub SSH
key on the machine, the install fails with `Permission denied (publickey)` even
though both repositories are public. Set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`,
which is how both installs above were performed.
