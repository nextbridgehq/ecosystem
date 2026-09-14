# Generated directory

`marketplace.json` in this directory is **generated** by `scripts/compile.mjs`
from `registry.yaml` and the product manifests in `manifests/`.

Do not edit it by hand. CI runs `node scripts/compile.mjs --check` and fails if
the committed file differs from what the compiler produces.

To change what appears in the canonical Nextbridge Claude Code marketplace:

1. The owning product declares the plugin in its own `.nextbridge/product.yaml`
   under `plugins[]`, with `marketplace: nextbridge`.
2. Add a `{product, plugin}` entry to `marketplace.members` in `registry.yaml`.
3. Run `node scripts/compile.mjs` and commit the result.

There is exactly one Nextbridge marketplace. A product repository must not
contain its own `.claude-plugin/marketplace.json`; rule R-MK2 enforces this.

## Installing from it

```bash
claude plugin marketplace add nextbridgehq/ecosystem
claude plugin install code-comrades@nextbridge
claude plugin install graphpowers@nextbridge
```

Every entry uses the documented `{"source": "github", "repo": "owner/repo"}`
form, which Claude Code clones over **SSH by default**. On a machine with no
GitHub SSH key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` for the install command.
