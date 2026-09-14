# Claude Code plugin/marketplace schema — verification record

**Purpose:** resolve Phase 1 open question **Q3** ("cross-repository `source` form in `marketplace.json`") against the official documentation rather than by inference.

**Verified:** 2026-09-10
**Sources:**

- `https://code.claude.com/docs/en/plugin-marketplaces` (marketplace.json schema)
- `https://code.claude.com/docs/en/plugins-reference` (plugin.json schema, component locations)

Note: `https://docs.claude.com/en/docs/claude-code/plugin-marketplaces` returns `301` to the `code.claude.com` host above.

---

## Q3 — RESOLVED

A cross-repository plugin source **is** supported and documented. The canonical Nextbridge marketplace can live in `nextbridgehq/ecosystem` and reference plugins that live in their own product repositories.

```json
{
  "name": "graphpowers",
  "source": { "source": "github", "repo": "nextbridgehq/graphpowers" }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string | Yes | Must be `"github"` |
| `repo` | string | Yes | `owner/repo` format |
| `ref` | string | No | Branch or tag; defaults to the repository default branch |
| `sha` | string | No | Full 40-character commit SHA |

The fallback design contemplated in the Phase 1 plan (vendoring or submodules inside the marketplace repository) is **not needed** and is abandoned.

Other documented source forms, recorded for completeness and not used by Nextbridge today: relative path (string, `./…`), `url` (arbitrary git), `git-subdir`, `npm`, `archive`, `command`.

---

## marketplace.json — fields relevant to the generated artifact

### Top level

| Field | Required | Decision for Nextbridge |
|---|---|---|
| `name` | Yes | `nextbridge`. **Must be kebab-case**, no spaces or control characters. A user may register only one marketplace per name — which is precisely why one canonical name matters |
| `owner` | Yes | `{ "name": "Nextbridge", "url": "https://github.com/nextbridgehq" }`. `email` and `url` are optional |
| `plugins` | Yes | Generated, one entry per `registry.yaml` `marketplace.members[]` entry |
| `description` | No | Emitted, from the registry |
| `version` | No | Not emitted — see D2 below |
| `$schema` | No | Not emitted. Claude Code ignores it at load time and no marketplace schema URL was verified |
| `metadata.pluginRoot` | No | Not used. Requires Claude Code ≥ 2.1.239 and only applies to bare relative source names |
| `renames` | No | Not used. It maps a former **plugin** name to a current one; Nextbridge plugin names are unchanged by consolidation. Requires Claude Code ≥ 2.1.193 |
| `allowCrossMarketplaceDependenciesOn` | No | Not used |

### Plugin entry

Required: `name` (kebab-case), `source`.

Optional fields the compiler emits: `description`, `author`, `homepage`, `repository`, `license`.

Optional fields the compiler deliberately does **not** emit:

| Field | Why not |
|---|---|
| `version` | Setting it pins the plugin, so users only receive updates when the string changes. Both existing plugins already set `version` in their own `plugin.json`, and the docs state `plugin.json` wins when both are set. Emitting it here would be a second source of truth with no effect |
| `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers` | These override component discovery. With `strict` at its default (`true`), `plugin.json` is the authority for component definitions — which is exactly the product-owns-its-plugin boundary the ecosystem model requires |
| `strict` | Left at its default `true`, deliberately |
| `displayName`, `category`, `tags`, `keywords`, `relevance`, `defaultEnabled`, `metadata` | Not needed for Phase 1. `displayName` on a marketplace entry takes precedence over `plugin.json`, so emitting it would override product-owned metadata |
| `headers`, `headersHelper` | Archive authentication only; not applicable |

---

## plugin.json — facts the ecosystem depends on

- `name` is the only required field.
- `version` is optional, and **setting it pins the plugin**. Both Nextbridge plugins set it (`code-comrades` `0.3.0`, `graphpowers` `0.3.1`).
- When a marketplace entry and `plugin.json` both set `version`, **`plugin.json` wins**.
- Component paths must be relative, start with `./` (the `skills` field also accepts `"."`), use forward slashes only, and may not traverse outside the plugin directory.
- `skills` **adds to** the default `skills/` scan. `commands`, `agents`, `workflows`, `outputStyles` **replace** their defaults. `hooks`, `mcpServers`, `lspServers` have their own merge rules.

### Default component locations (used by validation rule R-MK7)

| Component | Default location |
|---|---|
| Manifest | `.claude-plugin/plugin.json` |
| Skills | `skills/` (each `<name>/SKILL.md`) |
| Commands | `commands/` (flat `.md` files) |
| Agents | `agents/` |
| Workflows | `workflows/` |
| Output styles | `output-styles/` |
| Themes | `themes/` |
| Hooks | `hooks/hooks.json` |
| MCP servers | `.mcp.json` |
| LSP servers | `.lsp.json` |
| Monitors | `monitors/monitors.json` |

R-MK7 verifies the counts a product declares in `plugins[].components` against these default locations. A plugin that overrides a component path in `plugin.json` is out of scope for R-MK7 in v1 — neither Nextbridge plugin does so today, and the rule reports `skipped` rather than passing silently.

---

## Decisions arising from this verification

| ID | Decision | Rationale |
|---|---|---|
| **D1** | The canonical marketplace tracks each product's **default branch** — no `ref`, no `sha`, no entry `version` | Both plugins are pre-1.0 and already pin themselves through `plugin.json` `version`. Pinning in the marketplace as well would require the ecosystem repository to regenerate on every product release, coupling ecosystem releases to product releases for no user-visible gain. Revisit when a plugin reaches 1.0 |
| **D2** | The generated `marketplace.json` omits top-level `version` | Nothing consumes it, and it would need a release process the ecosystem repository does not yet have |
| **D3** | `strict` is left at its default (`true`) | Keeps `plugin.json` authoritative for components, matching the ownership split: products define plugins, the ecosystem curates membership |
| **D4** | `interfaces[].type` excludes `claude-code-plugin` and `gemini-cli-extension` entirely | The Phase 1 plan proposed keeping them in the vocabulary and rejecting duplicates with a rule. Removing them from the vocabulary makes the duplication structurally impossible instead, which is strictly stronger and needs no rule |

D1–D3 are recorded here rather than escalated because they follow directly from documented behaviour. D4 is a simplification within the approved anti-duplication intent. All four are reversible.
