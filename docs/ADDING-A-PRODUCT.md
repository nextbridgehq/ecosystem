# Adding a product

The operational contract. Everything here was executed against a disposable
copy of this repository and nine real product checkouts before it was written
down; the commands and the failure messages are the ones the code actually
produces.

Adding a product is a procedure, not an act of architecture. If you find
yourself changing `schema/product.v1.schema.json` or `scripts/lib/rules.mjs` to
make a product fit, stop — that is a different conversation.

---

## The five-minute version

A product that already has `.nextbridge/product.yaml` in its own repository,
checked out next to this one:

```bash
cd ecosystem

# 1. add the product to registry.yaml: repository, family, manifest_status: present
# 2. then:
node scripts/sync.mjs --repos ..        # copy product.yaml into manifests/
node scripts/validate.mjs --repos ..    # layers 1, 2 and 3
node scripts/compile.mjs                # regenerate catalog.json + marketplace
```

Exit codes are the API: `0` clean, `1` usage or internal error, `2` validation
errors or drift.

---

## Adding a product

### 1. Write `.nextbridge/product.yaml` in the product repository

The product owns this file. The ecosystem never writes to it.

`schema/product.v1.schema.json` requires exactly these twelve fields:

```
schema  id  name  description  problem  user  capabilities
interfaces  distribution  runtime  license  maturity
```

`plugins` and `integrations` are optional; absent or empty is normal and valid.

A minimal, valid manifest:

```yaml
schema: nextbridge.dev/product/v1

id: widget-lint
name: Widget Lint

description:
  short: >-
    Command line linter for widget definition files.

problem: >-
  Widget definitions drift from the schema they claim to follow and nothing
  catches it until runtime.

user:
  - javascript-developer

capabilities:
  core:
    - schema-validation

interfaces:
  - type: cli
    command: widget-lint

distribution:
  - channel: npm
    packages:
      - widget-lint

runtime:
  language: typescript
  node: ">=20"

license: MIT

maturity: stable
```

Constraints worth knowing before you write it:

- `id` must be the key you will use in `registry.yaml`, and must match the
  snapshot filename (`manifests/<id>.yaml`).
- every entry in `capabilities.core` and `capabilities.secondary` must already
  exist in `taxonomy/capabilities.yaml` (**R-REF1**). If a capability you need
  is missing, add it to the taxonomy in the same change, with a `note` if it
  sits close to an existing leaf.
- `interfaces: []` is legal. A Claude Code plugin is **not** an interface — it
  is declared once in `plugins[]`. But a product needs at least one surface:
  one `interfaces[]` entry or one `plugins[]` entry (**R-REF9**).
- `distribution` needs at least one channel. `claude-code-marketplace` is not a
  channel you may write: the compiler generates that row from `plugins[]`.
- `maturity: stable` requires at least one workflow file in the repository's
  `.github/workflows/` (**R-META5**). `maturity: integrated` additionally
  requires a *verified* integration with another Nextbridge product
  (**R-REF5**) — unreachable today, by design.
- `license` must match what the repository's own `package.json` / `pyproject.toml`
  declares (**R-META3**), and `runtime.node` / `runtime.python` must match
  `engines.node` / `requires-python` (**R-META4**).

### 2. Add the product's entry to `registry.yaml`

A genuinely new product has no entry to flip a field on. It needs the whole
entry, and `schema/registry.v1.schema.json` requires all three fields:

```yaml
products:
  widget-lint:
    repository: nextbridgehq/widget-lint
    family: dependency-risk
    manifest_status: pending
```

`family` must be a key of `registry.families` (**R-REF7**). `repository` must
match what the repository's own metadata declares (**R-META1**), and its
`repo` half is the directory name `--repos` looks for on disk.

`manifest_status: pending` means *indexed but not yet described*. It is a real,
useful state: `node scripts/validate.mjs` passes with the product listed and no
manifest synced. Use it when the registry entry lands before the product's own
manifest does.

> While any product is `pending`, rule **R-REF8** reports an unclaimed
> capability as a warning instead of an error (`rules.mjs`, `allPending`). That
> is deliberate, but it means a `pending` entry left in place indefinitely
> quietly relaxes the taxonomy check for the whole ecosystem.

### 3. Set `manifest_status: present`, then sync

**Order matters, and not in the obvious way.** `scripts/sync.mjs` skips every
product whose `manifest_status` is not `present`:

```js
if (entry.manifest_status !== 'present') continue;   // sync.mjs
```

So syncing while the entry still says `pending` copies nothing, and flipping to
`present` without syncing afterwards fails:

```
$ node scripts/validate.mjs --repos ..
ERROR  R-REF2    product:widget-lint
         manifest_status is "present" but manifests/ has no manifest
```

Set `manifest_status: present` **first**, then:

```bash
node scripts/sync.mjs --repos ..
```

```
added      widget-lint

1 change(s).
```

`--repos ..` is the directory that contains the product checkouts, not the
product directory itself. `sync.mjs` reads
`<repos>/<repo-name>/.nextbridge/product.yaml` and writes
`manifests/<id>.yaml` byte for byte.

### 4. Validate against the real repositories

```bash
node scripts/validate.mjs --repos ..
```

```
SKIP   R-META4   product:code-comrades
         no requires-python declared

0 error(s), 0 warning(s), 1 skipped.
```

Without `--repos`, only layers 1 and 2 run; layer 3 (everything that compares
the manifest to the repository it describes) is reported as skipped. CI runs
both forms, in two different workflows.

### 5. Compile

```bash
node scripts/compile.mjs
```

```
updated    catalog.json
unchanged  .claude-plugin/marketplace.json

10 of 10 products described, 2 plugin(s) in the "nextbridge" marketplace.
```

`compile.mjs` re-runs layers 1 and 2 itself and refuses to write anything if
they fail — no `--repos` needed and no way to compile a broken registry.

Commit the snapshot in `manifests/` and both regenerated artifacts together.
`node scripts/compile.mjs --check` in CI is what keeps the committed copies
honest.

---

## Adding a plugin

A plugin is two declarations that must agree: one in the product, one here.

### 1. In the product repository

The plugin's own manifest (`.claude-plugin/plugin.json` for Claude Code) must
exist and its `name` must match (**R-MK5**). Then declare it in
`.nextbridge/product.yaml`:

```yaml
plugins:
  - name: widget-lint
    host: claude-code
    path: .
    manifest: .claude-plugin/plugin.json
    marketplace: nextbridge
    components:
      skills: 2
      agents: 0
      commands: 0
      hooks: false
      mcp: false
    status: published
```

- `name` is globally unique across the ecosystem (**R-MK4**) and is what users
  type after `@` when installing.
- `marketplace` must be `nextbridge`. Any other value is an error
  (**R-MK6**) — this is the anti-fragmentation field.
- `path` is the plugin root relative to the repository root; `.` means the
  repository root. `manifest` is relative to the repository root too.

`components` is verified against the repository by **R-MK7**, and the five
fields are not checked the same way (`rules.mjs`, `COMPONENT_DIRS` and the
block that follows):

| field | how it is counted |
|---|---|
| `skills` | entries under `<path>/skills/` that contain a `SKILL.md` |
| `agents` | `*.md` files directly under `<path>/agents/` |
| `commands` | `*.md` files directly under `<path>/commands/` |
| `hooks` | **boolean**: does `<path>/hooks/hooks.json` exist, or does the plugin manifest declare `hooks`? |
| `mcp` | **boolean**: does `<path>/.mcp.json` exist, or does the plugin manifest declare `mcpServers`? |

Counts, not names — names change every release. Omit a field and it is not
checked. If the plugin manifest overrides `skills`, `agents` or `commands`
paths, R-MK7 reports `skipped` for that plugin rather than counting the
conventional directories.

### 2. In this repository

Syncing the product's new declaration is not enough. A plugin a product
declares does **not** reach the marketplace until the ecosystem curates it:

```bash
node scripts/sync.mjs --repos ..
node scripts/validate.mjs --repos ..
```

```
ERROR  R-MK3     registry.yaml
         published plugin "widget-lint/widget-lint" is not a member of the canonical marketplace
```

`compile.mjs` refuses too, with exit 2. Add the membership pointer to
`registry.yaml`:

```yaml
marketplace:
  members:
    - product: code-comrades
      plugin: code-comrades
    - product: graphpowers
      plugin: graphpowers
    - product: widget-lint
      plugin: widget-lint
```

Members are pointers only — `{product, plugin}`. Every descriptive field in
`marketplace.json` is resolved from the product manifest by the compiler and is
never stored here. Then:

```bash
node scripts/validate.mjs --repos ..    # 0 error(s)
node scripts/compile.mjs                # 3 plugin(s) in the "nextbridge" marketplace
```

**R-MK3 closes in both directions**: a published plugin that is not a member is
an error, and a member that no product declares is an error. The two edits are
one change.

Marketplace membership is distribution, not integration. Two plugins sharing a
marketplace have no relationship in `catalog.json`.

---

## Retiring

### Retiring a plugin

Because R-MK3 closes both ways, there is no ordering that keeps every
intermediate state green — verified in a fixture, both orders fail in between:

```
# plugin declaration removed first, still a member:
ERROR  R-MK3  marketplace member "widget-lint/widget-lint" does not resolve:
              product "widget-lint" declares no published claude-code plugin named "widget-lint"

# member removed first, still declared:
ERROR  R-MK3  published plugin "widget-lint/widget-lint" is not a member of the
              canonical marketplace
```

So make both edits before you validate:

1. In the product repository, remove the `plugins[]` entry (or the whole
   plugin).
2. In this repository, in the same change: remove the `members[]` entry from
   `registry.yaml` **and** run `node scripts/sync.mjs --repos ..` to pick up
   the product's edit.
3. `node scripts/validate.mjs --repos ..` → `0 error(s)`.
4. `node scripts/compile.mjs` → the plugin is gone from `marketplace.json`.

If the product's repository lands its half first, this repository's scheduled
`repo-consistency` run will go red on R-SYNC1 until step 2 is merged. That is
the system working: a product removing a published plugin is a reviewable
ecosystem event.

Setting `status: deprecated` instead of deleting the entry does not avoid this:
R-MK3 only counts plugins with `status: published`, so a deprecated plugin that
is still a member fails exactly the same way.

### Retiring a product

1. Remove the product's entry from `registry.products` in `registry.yaml`.
2. `node scripts/sync.mjs --repos ..` — it removes the now-orphaned snapshot
   itself:

   ```
   removed    widget-lint.yaml

   1 change(s).
   ```

   Do not delete `manifests/<id>.yaml` by hand. Leaving it there while the
   registry entry is gone is an error (**R-REF2**: *manifest exists but the
   product is not indexed in registry.yaml*).
3. If the product had a plugin in the marketplace, remove its `members[]` entry
   in the same change (**R-MK3**).
4. `node scripts/validate.mjs --repos ..` then `node scripts/compile.mjs`.

---

## What will reject you

Every rule in `scripts/lib/rules.mjs`, what trips it, and the one command that
fixes it. Severity is what the rule emits today; `skipped` means the rule had
nothing to check, which is never a pass and never a failure.

### Layer 1 — structural (offline, always runs)

| Rule | What trips it | Fix |
|---|---|---|
| R-SCHEMA | A document fails its JSON Schema, or `manifests/<file>` has an `id` that is not its filename | Fix the document against `schema/*.schema.json`, then `node scripts/sync.mjs --repos ..` |

### Layer 2 — referential (offline, always runs)

| Rule | What trips it | Fix |
|---|---|---|
| R-TAX1 | A capability names a category that is not in `taxonomy/capabilities.yaml` | Add the category, or point the capability at a real one |
| R-REF1 | A manifest claims a capability the taxonomy does not define | Add the leaf to `taxonomy/capabilities.yaml`, or fix the spelling in the product's `product.yaml` |
| R-REF2 | `manifest_status: present` with no snapshot; `pending` with a snapshot; a snapshot whose product is not in `registry.yaml` | Set `manifest_status: present`, then `node scripts/sync.mjs --repos ..` |
| R-REF3 | An integration's `from`/`to` is neither a known product id nor marked `external: true` | Fix the id, or add `external: true` |
| R-REF4 | An integration claims `status: verified` with no `verification` block | Add `verification: { automated: true, ... }`, or drop to `supported` |
| R-REF5 | `maturity: integrated` with no verified internal integration | Use `stable`. `integrated` is unreachable while `integrations` is empty, by design |
| R-REF6 | A `registry.solutions` `$ref` does not resolve under `solutions/` | Fix the reference. `solutions` is `[]` today |
| R-REF7 | A product's `family` is not a key of `registry.families` | Use an existing family, or add one with a named audience |
| R-REF8 | A taxonomy capability no product claims. **Warning** while any product is `pending`, **error** once none is | Claim it from a product, or delete the dead vocabulary |
| R-REF9 | A product declares no `interfaces[]` and no `plugins[]` | Give it a surface. Both empty means the product has no user-facing form |
| R-MK1 | `.claude-plugin/marketplace.json`'s `name` is not the registry's `marketplace.id`. `skipped` when it has not been generated yet | `node scripts/compile.mjs` |
| R-MK3 | A published plugin that is not a marketplace member, or a member no product declares | Edit both halves in one change, then `node scripts/sync.mjs --repos ..` and `node scripts/compile.mjs` |
| R-MK4 | Two products declare the same plugin name | Rename one. Plugin names are globally unique |
| R-MK6 | A `claude-code` plugin declares a `marketplace` other than `nextbridge` | Set `marketplace: nextbridge` in the product's `product.yaml` |

### Layer 3 — repository consistency (needs `--repos <dir>`)

| Rule | What trips it | Fix |
|---|---|---|
| R-REPO | Not a rule: a `skipped` marker. Emitted per product when its directory is not under `--repos`, and once by `validate.mjs` when `--repos` is absent | Check the repository out next to `ecosystem/`, or pass `--repos ..` |
| R-META1 | `registry.yaml`'s `repository` matches no repository URL found in any `package.json`, `pyproject.toml` or `.claude-plugin/plugin.json`. `skipped` when the repository declares none at all | Fix `repository` in `registry.yaml`, or add the URL to the repository's own metadata |
| R-META2 | A declared npm package has no `package.json` of that name, or is `"private": true`; a declared PyPI package is not what `pyproject.toml` names | Fix `distribution[].packages` in the product's `product.yaml`, or publish the package for real |
| R-META3 | The manifest's `license` matches no licence the repository declares (**error**); no `LICENSE`/`LICENSE.md` exists (**warning**) | Align the SPDX id in `product.yaml` with the repository, and add a LICENSE file |
| R-META4 | `runtime.node` disagrees with every `engines.node` found, or `runtime.python` disagrees with `requires-python`. `skipped` when the repository declares neither | Align the floor in `product.yaml` with the repository, or vice versa |
| R-META5 | `maturity: stable` with no `*.yml`/`*.yaml` in `.github/workflows/` | Install a CI workflow, or drop to `maturity: experimental` |
| R-MK2 | A product repository contains `.claude-plugin/marketplace.json`. **Warning** while the product has no manifest, **error** once it has one | Delete the per-product marketplace. There is one Nextbridge marketplace |
| R-MK5 | A declared plugin manifest does not exist, or its `name` disagrees with the `plugins[]` entry | Fix `manifest`/`name` in `product.yaml`, or the plugin's own manifest |
| R-MK7 | A declared `components` count or boolean does not match the repository. `skipped` when the plugin manifest overrides component paths | Update `components` in `product.yaml` to what the repository actually ships |
| R-SYNC1 | `manifests/<id>.yaml` differs from the product repository's `.nextbridge/product.yaml`, or that file is missing | `node scripts/sync.mjs --repos ..` |

---

## What you must never do

- **Edit `manifests/*.yaml`.** They are byte-for-byte generated snapshots.
  R-SYNC1 turns a hand edit into a validation error, so it does not survive CI.
  See [manifests/README.md](../manifests/README.md).
- **Edit `catalog.json` or `.claude-plugin/marketplace.json`.** Both are
  generated. `node scripts/compile.mjs --check` fails on a hand edit, and CI
  proves that on every run by hand-editing one on purpose.
- **Add a second marketplace to a product repository.** R-MK2 warns while a
  product is undescribed and errors once it has a manifest, so consolidation
  enforces itself. R-MK6 refuses any `marketplace` value but `nextbridge`.
- **Change `product.v1` to fit one product.** The schema freeze in
  [SCHEMA-FREEZE.md](SCHEMA-FREEZE.md) holds until a real product proves the
  schema insufficient — and that is a phase, not a patch.
- **Expect `--check` to miss a hand edit.** It will not. `sync --repos .. --check`
  and `compile --check` both exit 2 on drift, and both run in CI.
