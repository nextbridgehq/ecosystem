# How all nine products are represented

**Status: complete.** All nine products have a manifest in their own repository,
are `manifest_status: present` in the registry, and validate clean across all
three layers against their real repositories.

This began as the plan for the seven that were pending. It is kept as the record
of what each one actually exercised, with the plan's predictions left visible
where the evidence overturned them.

---

## Status

| Product | Family | Manifest | Blockers |
|---|---|---|---|
| `repocode` | agent-development-environment | **present** | — |
| `block-builder` | content-management | **present** | — |
| `graphpowers` | agent-development-environment | **present** | — (consolidated) |
| `code-comrades` | agent-development-environment | **present** | — (consolidated; CI added) |
| `project-charter` | agent-development-environment | **present** | R-META1 fired; `pyproject.toml` URLs corrected to `nextbridgehq` |
| `agent-loop-guard` | agent-runtime-safety | **present** | — |
| `registry-guard` | dependency-risk | **present** | — |
| `edge-compat-check` | dependency-risk | **present** | — |
| `package-pilot` | package-development-workflow | **present** | R-META2 avoided by declaring no npm channel; R-META1 skipped until `repository` was added to `package.json` |

Three of the seven were expected to fail layer 3 on the day their manifest
landed. `code-comrades` did, on R-META5, and the gap was closed by adding CI.
That is the point: the validation rules turn the audit's hand-found defects into
a blocking checklist rather than a document nobody rereads.

Consolidation of the two plugin repositories is complete and verified — see
[MARKETPLACE-CONSOLIDATION.md](MARKETPLACE-CONSOLIDATION.md), including three
defects the install verification found that no rule could have.

---

## Per-product outline

Each entry names what the manifest will exercise that nothing has yet, and the
schema surface it will be the first to use.

### graphpowers — landed
- **First use of:** `runtime.python`, a real `plugins[]` entry, `distribution.channel: gemini-cli-extension`.
- **Not** `runtime.host`: the bridge is a standalone CLI as well as a plugin, so it is not hosted the way Block Builder is. `code-comrades`, which has no surface outside Claude Code, uses `runtime.host` instead.
- **Interfaces:** `cli` (13 bridge commands).
- **Plugins:** `graphpowers` on `claude-code`; a second entry on `gemini-cli` if Q10 resolves that way.
- **Distribution:** `github`; **not** npm or PyPI — it declares a PyPI-shaped package but has no publish workflow.
- **Integrations:** two `external: true` entries — Graphify (`graph-consumer`, `file`) and Superpowers (`methodology-extension`, `plugin`). Both are `supported`, **not** `verified`: the canary that would exercise a real Graphify install lives at `ci/upstream-watch.yml` and is not installed under `.github/workflows/`, so nothing runs it. The portfolio still has no `verified` integration and R-REF4 is still unexercised by a real manifest.
- **Marketplace:** `.claude-plugin/marketplace.json` deleted after installation was verified from `nextbridge`.

### code-comrades — landed
- **First use of:** a product with **no package manifest at all** — GitHub-only distribution — and the first `interfaces: []`.
- **Interfaces:** `[]`. Its only surface is the plugin, declared once in `plugins[]`. This is the first manifest to exercise the empty-interfaces case that O1 resolved (option c) and that R-REF9 now guards.
- **Plugins:** `code-comrades` on `claude-code`, 10 skills + 1 agent — confirmed by `claude plugin details` against the installed plugin.
- **Blockers, both cleared:** the stray marketplace is deleted, and `.github/workflows/tests.yml` now runs the existing 145-test suite, so R-META5 passes.

### project-charter — landed
- **First use of:** `interfaces[].type: pre-commit-hook`, `distribution.channel: pypi`, `distribution.channel: smithery`, `runtime.python`.
- **Interfaces:** `cli` (8 commands), `mcp` (9 tools, 5 resources, 5 prompts), `library`, `pre-commit-hook`.
- **Not a plugin.** It ships four skills inside its Python wheel and has no `.claude-plugin/`. `plugins: []`. This is the case that proves the model does not infer a plugin from a `skills/` directory.
- **Blocker, cleared:** R-META1 failed on the first validation run; `[project.urls]` now points at `nextbridgehq`. `smithery.yaml` exists but publishes no registry id, so the `smithery` channel is **not** declared.
- **Confirmed:** 8 CLI commands, 9 MCP tools, 5 resources, 5 prompts, 4 skills inside the wheel and no `.claude-plugin/`.

### agent-loop-guard — landed
- **First use of:** a product whose only interface is `library`.
- **Distribution:** npm, `github`.
- **Notable:** `integrations: []` and `plugins: []` — deliberately framework-agnostic, so it integrates with nothing by design. A second demonstration that empty lists are a complete description.

### registry-guard — landed
- **Interfaces:** `cli`, `library`. **Distribution:** npm, `github`.
- **Capabilities:** `package-verification`, `typosquat-detection`, `lifecycle-script-inspection`.
- **Notable:** no release workflow. `maturity: stable` still passes R-META5, which only requires CI. That is open question O2, deferred by decision.

### edge-compat-check — landed
- **First use of:** `maturity: experimental`.
- **Interfaces:** `cli`, `library`. **Distribution:** npm, `github`.
- **Notable:** versioned `1.0.0` but experimental by process — no CI, no CHANGELOG, no release workflow, and a Windows path-separator defect in its public JSON `location` field. `node test/run.js` still fails on Windows with `pnpm results should retain physical locations`. R-META5 would fail a `stable` claim here, and `experimental` is the honest value. The defect itself is a code fix in the product, outside this phase's scope.

### package-pilot — landed
- **First use of:** `interfaces[].type: desktop-app`, `distribution.channel: desktop-binaries`, `runtime.language: mixed`.
- **Interfaces:** `desktop-app` only.
- **Confirmed:** the manifest declares `desktop-binaries` (all three platforms, via GitHub Releases) and `github`, and no npm channel, so R-META2 never fires — the rule only fires on a claim the repository contradicts. The release workflow builds on macOS, Linux, and Windows, which is where the platform list comes from.

---

## Open questions this raises

**O1 — RESOLVED (2026-09-10): option (c).**
A product is valid when it declares at least one `interfaces[]` entry **or** at
least one `plugins[]` entry. `interfaces.minItems` is now `0`, and new layer 2
rule **R-REF9** rejects a product with neither. No `plugin` interface type was
added and no plugin is declared twice. Recorded as amendment A1 in
[SCHEMA-FREEZE.md](SCHEMA-FREEZE.md); v1-compatible, because it only loosens a
schema constraint and replaces it with a stricter rule.

`code-comrades` therefore has `interfaces: []`, legitimately.

**O2 — DEFERRED (2026-09-10), by decision.**
R-META5 keeps requiring only observable CI for `maturity: stable`. Strengthening
it to also require release automation is revisited after all nine products are
represented, not before — the evidence for whether it is the right bar is the
set of nine manifests, and only two exist.

---

## Sequence for Phase 1.5

1. ~~Resolve **O1**~~ — done: option (c), `minItems: 0` plus rule R-REF9.
2. Fix the metadata blockers in the product repositories: ~~`code-comrades` CI~~ (done), `project-charter` URLs, and confirm `package-pilot`'s distribution shape.
3. ~~Consolidate the marketplaces~~ — done, in that order, and verified by installing both plugins from the compiled marketplace.
4. ~~Write the remaining five manifests, one at a time, validating after each~~ — done, in that order.
5. ~~When all nine are `present`, R-REF8 escalates from warning to error~~ — it has. Every one of the 42 capabilities is claimed by at least one product, so the escalation passed on the first run and pruned nothing. The taxonomy was sized correctly by the audit.

## What the five taught

- **The schema needed nothing new.** No field, no enum value, no escape hatch. Five products spanning Python, a Tauri desktop app, two npm libraries, and a governance engine all fit the vocabulary the audit produced from evidence.
- **`smithery` and `verified` are still unexercised**, and both for the same honest reason: the evidence for them does not exist yet. See [SCHEMA-FREEZE.md](SCHEMA-FREEZE.md).
- **Two rules fired on real defects and were then satisfied by fixing the repository, not the rule**: R-META1 on `project-charter`'s `saadat-dev` URLs, R-META5 on `code-comrades`'s missing CI.
- **One rule went quiet for the wrong reason.** R-META1 *skipped* `package-pilot`, because its `package.json` declared no repository URL at all. A skip is not a pass, which is why the rule reports it; `repository`, `homepage`, and `bugs` were added, and the rule now actually checks something.
