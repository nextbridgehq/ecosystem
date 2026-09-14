# manifests/ — generated snapshots. Do not edit.

Every `*.yaml` in this directory is a byte-for-byte copy of a product's own
`.nextbridge/product.yaml`, written by `scripts/sync.mjs`.

- **`product.yaml` in the product repository is authoritative.**
- **`manifests/<id>.yaml` is a cache.**

To change what a product declares, change it in the product repository and run:

```bash
node scripts/sync.mjs --repos ..
node scripts/validate.mjs --repos ..
node scripts/compile.mjs
```

Editing a file here directly makes the ecosystem disagree with the product it
describes. Rule **R-SYNC1** turns that disagreement into a validation error, so
a hand edit does not survive CI — it just wastes a review cycle.

The snapshot exists so that `catalog.json` is reproducible from this repository
alone, with no network access at compile time.
