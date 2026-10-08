# Phase 2 — Ecosystem Hardening (Report)

Status: implemented, and its one open blocker has since closed — see
[Post-Phase-2 closure](#post-phase-2-closure--graphpowers-release-blocker-resolved).
Closes the spec in [PHASE-2-SPEC.md](PHASE-2-SPEC.md).

Phase 1.5 proved the model. Phase 2 was supposed to prove the model stays
trustworthy while nine products evolve independently of it. It does — locally,
deterministically, and without network access. One thing it also proved is that
the ecosystem's *published* surface was not as healthy as its local state.
That finding is why this report originally did not end with the word "green" —
the addendum at the bottom records why it now does.

Read the three status lines in [Status](#status-three-lines-not-one) before
anything else. They are deliberately not collapsed into one.

---

## Status: three lines, not one

| # | What | State |
|---|---|---|
| 1 | **Ecosystem automated baseline** — `validate --repos ..`, `compile --check`, `sync --repos .. --check`, `npm test` | **GREEN** |
| 2 | **Isolation mechanism** — `CLAUDE_CONFIG_DIR` correctly isolates test installs from the developer's real configuration, which is left unaffected | **GREEN** |
| 3 | **Marketplace fresh-install verification** — `npm run verify:clean-env` | **GREEN** — was RED for `graphpowers@nextbridge` at the time this report was written; resolved post-Phase-2, see [closure addendum](#post-phase-2-closure--graphpowers-release-blocker-resolved) |

Line 3 was, at the time of writing, an external, GitHub-source problem: not
caused by anything in this repository and not fixable from this repository.
It was also a real release blocker — the original analysis is preserved
unedited in [Release blocker](#release-blocker--graphpowersnextbridge-does-not-install-cleanly)
below; its resolution is recorded separately in the closure addendum, not by
rewriting the history here.

---

## What was proved

### Level 1 — deterministic local

> `fixtures -> validate -> compile -> byte-for-byte comparison`
> No network, no git. Proves that the same inputs always produce the same two
> artifacts, and that a hand-edited artifact is rejected.

Proved by `test/fixture.test.mjs`, `test/lifecycle.test.mjs` and
`test/compile.test.mjs`, and reproducible by hand:

```
$ node scripts/compile.mjs --check
unchanged  catalog.json
unchanged  .claude-plugin/marketplace.json

9 of 9 products described, 2 plugin(s) in the "nextbridge" marketplace.
```

The named tests that carry this:

- `a fixture workspace reproduces the real ecosystem exactly`
- `the fixture catalog is byte-identical to the committed catalog`
- `a fixture can be mutated without touching the real tree`
- `compiling twice from a clean checkout is byte-identical`
- `a clean checkout reproduces the committed artifacts`
- `a hand-edited catalog.json is rejected with exit code 2`
- `a hand-edited marketplace.json is rejected with exit code 2`
- `compile refuses to write when validation fails`
- `validate without --repos skips layer 3 rather than passing it`

The last one matters more than it looks: an unrun layer is reported as
`skipped`, never as a pass.

```
$ node scripts/validate.mjs
SKIP   R-REPO    layer 3
         not run - pass --repos <dir> to check repository consistency

0 error(s), 0 warning(s), 1 skipped.
```

### Level 2 — disposable git lifecycle and repository drift

> `temporary git repos -> modify product -> sync -> PR-like diff -> validate -> compile`

Every drift scenario the spec's question 2 names is covered, and each one is
paired with a negative test proving a *legitimate* change does not fire the
rule. That pairing is what keeps the rules from becoming so strict that normal
product evolution is blocked:

| Drift caught | Paired legitimate change that must not fire |
|---|---|
| `R-META1 catches a repository that starts claiming a different owner` | `R-META1 stays quiet when a repository states its own URL in SSH form` |
| `R-META2 catches a declared npm package that the repository renamed` | `R-META2 stays quiet when a distribution package merely bumps its version` |
| `R-META3 catches a licence change the manifest did not follow` | `R-META3 warns, and does not error, when only the LICENSE file is missing` |
| `R-META4 catches a runtime floor the manifest did not follow` | `R-META4 treats ">=18" and ">=18.0.0" as the same floor` |
| `R-META5 catches a stable product that loses its CI` | `R-META5 accepts any workflow file, not one particular name` |
| `R-MK7 catches a skill added to the repository but not to the manifest` | `bumping a plugin.json version produces zero ecosystem drift anywhere` |
| `R-MK7 catches hooks disappearing from a plugin that declares them` | `R-MK5 and R-MK7 accept a correct declaration of the real code-comrades plugin` |
| `removing a plugin from a product removes it from the compiled marketplace` | `a product with no interfaces but one plugin is valid — the Code Comrades shape` |
| `adding an unreferenced capability is an R-REF8 error, not tolerated` | `adding a capability AND referencing it from a manifest is clean` |
| `renaming a capability id without migrating the manifest reference is an R-REF1 error` | `a capability rename migrated in both places validates and recompiles, and the renamed id reaches catalog.json` |
| `a missing repository is skipped, never silently passed` | — (the skip *is* the assertion) |

Spec question 1 — *does the registry stay synchronized?* — is proved end to end
by `test/sync-lifecycle.test.mjs`:

- `a product description change flows through sync, validation and compilation`
- `sync removes an orphan snapshot when a product goes back to pending`
- `a product whose product.yaml disappears is a hard sync failure, not a silent skip`

Spec question 4 — *is the snapshot boundary enforced?* — is proved by R-SYNC1
plus the recovery test `drift in the snapshot is recoverable by running sync`,
and documented in [manifests/README.md](../../manifests/README.md) and
`.gitattributes`. C2 in the spec is why the boundary is documented *outside*
the files: `sync.mjs` copies bytes, so a "do not edit" banner inside a snapshot
would itself be drift.

Spec question 5 — *is the operational contract written down?* — is
[ADDING-A-PRODUCT.md](../ADDING-A-PRODUCT.md), which was executed against a
disposable fixture before it was written. Two of its statements were corrected
because the fixture disagreed with the plan; see
[Plan versus implementation](#the-recurring-finding-implementation-is-ground-truth-the-plan-is-a-hypothesis).

### Failure recovery and the error contract

Exit codes are the API and the suite asserts it directly:

- `exit code 0 means clean`
- `exit code 1 means usage or internal error, never a validation failure`
- `exit code 2 means validation errors or drift`
- `every rule that can error names a subject and says what is wrong`
- `every rule id in rules.mjs appears in the ecosystem README`
- `drift in the snapshot is recoverable by running sync`
- `drift in a generated artifact is recoverable by running compile`

---

## What was explicitly not proved — Level 3

Phase 2 does not prove production CI. Stated verbatim:

> *"This proves the workflows' underlying commands and clean-checkout
> reproducibility. It does not prove GitHub PR execution. Actual GitHub CI
> execution will be verified once the ecosystem repository is pushed."*

[PHASE-2-SPEC.md](PHASE-2-SPEC.md) says the same thing in its own words under
*What "clean checkout" may and may not claim*: a fresh temporary copy of the
ecosystem fixture with the CI-equivalent commands run from that clean state
"proves **the workflows' underlying commands and clean-checkout
reproducibility**. It does **not** prove GitHub PR execution. Actual GitHub
Actions execution is verified only once the ecosystem repository is pushed."

Concretely, the following are **untested** and remain so:

- `actions/checkout@v4` and `actions/setup-node@v4` behaviour on a real runner
- `gh repo clone` of nine real `nextbridgehq` repositories in
  `repo-consistency.yml` and `sync.yml`
- `peter-evans/create-pull-request@v7` opening the scheduled sync PR
- the `git checkout -- catalog.json` restore at the end of `validate.yml`'s
  hand-edit step — this repository is not a git repository locally, so that
  line has never executed anywhere
- branch protection, required checks, and secrets (`ECOSYSTEM_READ_TOKEN`)

The commands *inside* those steps are all exercised locally.

---

## Release blocker — `graphpowers@nextbridge` does not install cleanly

> **Resolved post-Phase-2.** This section is preserved exactly as originally
> written — it was true when written and is the record of the investigation.
> See [Post-Phase-2 closure](#post-phase-2-closure--graphpowers-release-blocker-resolved)
> at the end of this report for the resolution.

**Local ecosystem state is clean. A fresh install of `graphpowers@nextbridge`
from the canonical marketplace is not.** `npm run verify:clean-env` installs the
compiled marketplace into a throwaway `CLAUDE_CONFIG_DIR` and checks that every
member plugin actually loads. Real output, today:

```
$ npm run verify:clean-env
claude 2.1.267 (Claude Code)
OK    code-comrades@nextbridge
  Skills (10)  changelog-fragment-extractor, code-commenter, dispatch, error-handling-auditor, import-sorter-cleaner, license-header-injector, readme-master, readme-per-folder, test-stub-generator, type-annotator
  Agents (1)  batch-file-worker
  Hooks (0)
  MCP servers (0)
FAIL  graphpowers@nextbridge installed but did not load:
❯ graphpowers@nextbridge
    Version: 0.3.1
    Scope: user
    Status: ✘ failed to load
    Error: Hook load failed: Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file <CLAUDE_CONFIG_DIR>\plugins\cache\nextbridge\graphpowers\0.3.1\hooks\hooks.json. The standard hooks/hooks.json is loaded automatically, so manifest.hooks should only reference additional…

verify-clean-env: 1 plugin(s) failed in a clean environment
```

Exit code 2.

### Why this is not an ecosystem-repository defect

`.claude-plugin/marketplace.json` installs `graphpowers` from its GitHub source:

```json
"source": { "repo": "nextbridgehq/graphpowers", "source": "github" }
```

The **local** checkout's `graphpowers/.claude-plugin/plugin.json` has no `hooks`
field. The **published** one does. Verified directly, by installing into an
isolated `CLAUDE_CONFIG_DIR` and reading what was fetched:

```
keys: name,version,description,author,hooks,license,keywords
hooks: "./hooks/hooks.json"
version: 0.3.1
```

This is [MARKETPLACE-CONSOLIDATION.md](MARKETPLACE-CONSOLIDATION.md)'s **defect
1**, recorded and fixed during Phase 1.5:

> `plugin.json` declared `"hooks": "./hooks/hooks.json"`, which Claude Code
> already loads by convention. The plugin was rejected at load time — including
> from its own `graphpowers-marketplace`, so this predates consolidation. The
> declaration is removed and the plugin now loads.

[PHASE-2-SPEC.md](PHASE-2-SPEC.md) lists the same failure mode among the
Phase-1.5 findings that motivated this phase: *"the GraphPowers plugin failed
to load from any marketplace, while schema validation passed."* So this is a
**regression of a fix that was applied but never published**, not a new defect.

One further detail sharpens it. The developer's existing install and a fresh
install resolve to the *same* upstream commit —
`45bbf22816d2f1e98e44d2c0a0e34f9799ed7539` — yet the cached copy in the
developer's real configuration has no `hooks` key and the freshly fetched copy
does. The Phase-1.5 fix was applied to the local plugin cache and the local
working copy, and never reached `github.com/nextbridgehq/graphpowers`. That is
exactly why the local environment looks healthy while a clean install fails,
and exactly why a developer-machine check would never have caught it.

### Ownership and disposition

- **Owner:** whoever maintains the published `nextbridgehq/graphpowers`
  repository. The fix is one line — delete `"hooks": "./hooks/hooks.json"` from
  `.claude-plugin/plugin.json` — and it must be *pushed*, then released.
- **Not owned here.** This repository has no write access to that remote, and
  Phase 2's constraints forbid connecting to the real `nextbridgehq` remotes.
- **Do not work around it.** Editing `marketplace.json` or weakening
  `verify-clean-env.mjs` would hide a live user-facing failure. Both were left
  untouched.
- **The ecosystem, and Phase 2, are not fully release-ready while this is
  true.** Everything in this repository is green; the product a user actually
  installs is not.

The permanent value of `scripts/verify-clean-env.mjs` is precisely this: no
schema check, no rule, and no `claude plugin validate` run catches it. Only a
real install from the real source does, and now that is one npm script.

Environment note: `verify-clean-env.mjs` sets
`CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`. Without it, `claude plugin install` clones
over SSH and fails on a machine with no GitHub SSH key, which is a different
failure with a similar shape — do not confuse the two.

---

## Gaps found

There are no `test.skip` entries anywhere in the suite — that plan hypothesis
was checked and is wrong; nothing is silently parked. The gaps below are the
substantive findings and rulings accumulated across the phase.

### G1 — R-META1 / R-META3 / R-META4 are satisfied by *any* package in the tree

**Status: deferred, not decided against. Recommendation: a future rule change.**

`layer3` collects every `package.json` under a product repository
(`collectPackageJson`, depth 4) plus `pyproject.toml`, and then asks whether
*any* of them satisfies the check:

```js
} else if (!candidates.includes(entry.repository)) {        // R-META1
if (licences.size > 0 && !licences.has(manifest.license)) { // R-META3
} else if (!found.includes(declared)) {                     // R-META4
```

Nothing scopes that collection to the packages the manifest actually declares
in `distribution[].packages`. In a monorepo, one healthy workspace package
therefore covers for a drifted sibling.

Demonstrated live, in a disposable fixture, against the real `repocode`
checkout. `@repocode/core` is one of the three packages
`manifests/repocode.yaml` names in `distribution[0].packages`. Changing *only*
that package to `"engines": { "node": ">=18.0.0" }` and `"license":
"Apache-2.0"`:

```
$ node scripts/validate.mjs --repos ..
SKIP   R-META4   product:code-comrades
         no requires-python declared

0 error(s), 0 warning(s), 1 skipped.
```

Neither R-META3 nor R-META4 fires, because `packages/cli` and `packages/mcp`
still say MIT and `>=20.0.0`. A declared, published package silently drifted its
licence and its runtime floor and the ecosystem reported it clean.

Scope, measured rather than assumed: `repocode` has **six** `package.json` files
on disk, of which `collectPackageJson` returns **five** —
`packages/core/tests/fixtures/simple-ts/package.json` sits one level past the
depth-4 walk and is not collected today. Of the five collected, only three
(`repocode`, `@repocode/core`, `@repocode/mcp`) are named by the manifest; the
root `repocode-monorepo` and `@repocode/github-action` are `private: true` and
contribute no licence, repository or engines values at all. The stray
test-fixture package is therefore *not* currently counted — but it is one
directory move away from being counted, which is part of the argument for
scoping the collection rather than relying on a depth limit.

**R-META2 is unaffected**: it already resolves each declared package by exact
name and checks that one package.

**Recommendation.** A future rule change should scope R-META1, R-META3 and
R-META4's candidate collection to the packages named in
`manifest.distribution[].packages` where a manifest declares any, falling back
to the current tree-wide behaviour where it declares none. That would make the
three rules mean what their messages already claim, and would stop any
test-fixture `package.json` from ever counting as first-party metadata. It is
**not** implemented here: Phase 2's constraints forbid adding or altering
validation rules, and doing it properly needs its own paired
drift/legitimate-evolution tests.

### G2 — the published GitHub sources are outside every check

**Status: real gap, structural. Recommendation: keep `verify:clean-env` and run
it in a publishing phase.**

Layer 3 validates *local checkouts*. The marketplace installs from *GitHub*.
Nothing before Task 9 compared the two, and the first time anything did, it
found a live failure (see [Release blocker](#release-blocker--graphpowersnextbridge-does-not-install-cleanly)).

`npm run verify:clean-env` closes the gap for plugin load, but only for plugins.
Local-versus-published divergence in a product's `product.yaml`, `package.json`
or LICENSE is still invisible until the repositories are actually pushed and
`repo-consistency.yml` clones them for real — which is Level 3, and out of
scope here.

### G3 — `test:hardening` duplicates 51 of the 111 tests in CI

**Status: accepted limitation, deliberate.** See [CI note](#ci-note--the-hardening-step-overlaps-with-unit-tests).

### G4 — `edge-compat-check` fails its own test suite on Windows

**Status: accepted, pre-existing, product decision.** Recorded as C5 in the
spec: *"Known, deliberately out of scope, and unchanged by this phase."* It is a
path-separator defect in the product, not in the ecosystem. The product's
`maturity: experimental` and its empty `.github/workflows/` are consistent with
each other and with R-META5, so the ecosystem describes it honestly today.
**Whose decision:** the `edge-compat-check` product owner.

### G5 — a `pending` registry entry quietly relaxes R-REF8 for everyone

**Status: accepted limitation, documented.** `R-REF8` reports an unclaimed
capability as a warning while *any* product is `manifest_status: pending`, and
as an error once none is:

```js
const allPending = Object.values(registry.products ?? {}).some((p) => p.manifest_status === 'pending');
```

That is intentional — it is what let the taxonomy grow through Phase 1 — but it
means a `pending` entry left in place indefinitely weakens the taxonomy check
for the whole ecosystem. Nothing is pending today, so R-REF8 is an error and
`the committed ecosystem passes layers 1 and 2 with no errors` means what it
says. **Recommendation:** no rule change; documented in
[ADDING-A-PRODUCT.md](../ADDING-A-PRODUCT.md) so the side effect is not a surprise.

### G6 — R-MK3 has no green intermediate state when retiring a plugin

**Status: accepted, by design. Documented, not changed.** R-MK3 closes in both
directions, so *every* ordering of "remove the plugin declaration" and "remove
the marketplace member" fails in between. Verified in a fixture — both orders
produce an R-MK3 error and `compile.mjs` refuses with exit 2. The plan's
retirement order ("remove the member first, recompile, then remove the plugin")
does not avoid this; nothing does. The real contract is that both edits are one
change, and that is what
[ADDING-A-PRODUCT.md](../ADDING-A-PRODUCT.md#retiring-a-plugin) now says.

### G7 — R-SCHEMA and R-REPO are not in the README's rule tables

**Status: minor, not fixed here (out of this task's file scope).** The README's
layer 1/2/3 tables were cross-checked line by line against `rules.mjs` and are
**not stale**: every named rule the code emits (R-TAX1, R-REF1-9, R-MK1-7,
R-META1-5, R-SYNC1) is documented with wording that matches the code's actual
behaviour. The two identifiers the tables do not name are `R-SCHEMA` (layer 1's
structural finding) and `R-REPO` (the `skipped` marker, emitted both by
`validate.mjs` when `--repos` is absent and by `layer3` per unavailable
repository). Neither matches the coverage test's `R-[A-Z]+\d+` pattern, so both
are legitimately outside that test. Both are now documented in
[ADDING-A-PRODUCT.md](../ADDING-A-PRODUCT.md#what-will-reject-you). Rewriting
README's rule tables was explicitly out of scope for this task.

---

## Maturity evidence

Evidence only. **No change to the maturity model** — O2 stays deferred, exactly
as the spec requires. This is the material a future `declared_maturity` /
computed `ecosystem_status` decision would need.

"Observable" means a rule or a file check can confirm it from the repository.
"Declared" means the manifest asserts it and nothing verifies it.

| Product | Declared maturity | CI observable | Tests observable | Repository metadata | Distribution machine-checkable |
|---|---|---|---|---|---|
| `repocode` | stable | yes — `ci.yml`, `release.yml` | yes — `packages/*/tests/*.test.ts`, `pnpm -r test` | yes — 3 workspace `package.json` declare the URL; the **root does not** | yes — npm `repocode`, `@repocode/core`, `@repocode/mcp` all resolve and are public |
| `block-builder` | stable | yes — `ci.yml`, `release.yml` | yes — `test/*.test.ts`, `vitest run` | yes — root `package.json` | yes — npm `@nextbridgehq/payload-block-builder` |
| `graphpowers` | stable | yes — `release-please.yml`, `tests.yml` | yes — `tests/` | yes — `pyproject.toml` `[project.urls] Homepage` only | **no** — channels are `github` and `gemini-cli-extension`; no rule checks either |
| `project-charter` | stable | yes — `ci.yml`, `publish.yml`, `release-please.yml` | yes — `tests/`, `pytest` configured | yes — `pyproject.toml` `Repository` | yes — PyPI `project-charter` matches `[project] name` |
| `code-comrades` | stable | yes — `tests.yml` | yes — `eval/`, `pytest.ini` | yes — **only** via `.claude-plugin/plugin.json`'s `repository`; no `package.json`, no `pyproject.toml` | **no** — `github` channel only. The plugin *is* checked, by R-MK5/R-MK7 and by `verify:clean-env` |
| `agent-loop-guard` | stable | yes — `ci.yml`, `release.yml` | yes — `test/`, `node --test` | yes — root `package.json` | yes — npm `agent-loop-guard` |
| `registry-guard` | stable | yes — `ci.yml` | yes — `test/`, six named test files | yes — root `package.json` | yes — npm `registry-guard` |
| `edge-compat-check` | **experimental** | **no** — `.github/workflows/` is empty | yes — `test/`, `node test/run.js` (fails on Windows, C5) | yes — root `package.json` | yes — npm `edge-compat-check` |
| `package-pilot` | stable | yes — `ci.yml`, `release.yml` | yes — `src/**/__tests__/*.test.tsx`, `vitest run` | yes — root `package.json` | **no** — `desktop-binaries` and `github`; no rule checks either |

What the table says, read as a whole:

- **`maturity: stable` is only partly observable.** R-META5 proves "at least one
  CI workflow file exists". It does not prove the workflow runs, passes, or
  tests anything. Eight of nine products claim `stable`; all eight have a
  workflow file; none of that is a statement about green builds.
- **`edge-compat-check` is the honest case.** It claims `experimental`, has no
  CI, and R-META5 would reject it the moment it claimed `stable`. The rule is
  load-bearing, not decorative.
- **"Tests present" is observable but not currently a rule.** Every product has
  test files. Nothing in `rules.mjs` checks for them. If a future maturity model
  wants "tested" as an observable property, that is a new rule and needs its
  own paired tests.
- **Three products have no machine-checkable distribution.** `graphpowers`,
  `code-comrades` and `package-pilot` distribute via channels
  (`github`, `gemini-cli-extension`, `desktop-binaries`) that no rule inspects.
  R-META2 only understands `npm` and `pypi`.
- **Two products carry their repository metadata somewhere unusual.**
  `code-comrades` declares it only in its Claude plugin manifest; `repocode`
  only in workspace packages, not at the monorepo root. R-META1's breadth is
  what makes both pass — the same breadth that G1 argues is too generous when
  scoped to package identity.

---

## The GraphPowers → Graphify canary

Still `status: supported`, not `verified`. Confirmed in
`manifests/graphpowers.yaml`, which states the reason itself:

```yaml
integrations:
  # Graphify produces the graph; this product only reads it, via the node-link
  # graph.json contract, without importing graphify. Not "verified": the canary
  # that would exercise a real graphify install lives at ci/upstream-watch.yml
  # and is not installed under .github/workflows, so nothing runs it.
  - to: graphify
    external: true
    type: graph-consumer
    interface: file
    status: supported
    contract:
      consumes: graphify-out/graph.json (networkx node-link, schema node-link-v1)
```

Confirmed on disk:

- `graphpowers/ci/upstream-watch.yml` — exists (alongside
  `graphpowers/ci/graphpowers-drift.yml`)
- `graphpowers/.github/workflows/` — contains only `release-please.yml` and
  `tests.yml`

So the workflow that would exercise the integration has never run. R-REF4 is
what keeps this honest: `status: verified` requires a `verification` block, so
the claim cannot be made without something to point at.

**Moving `ci/upstream-watch.yml` into `.github/workflows/` is a product-owner
decision, not an ecosystem one.** If it is made, and the workflow runs, adding a
`verification: { automated: true, workflow: upstream-watch.yml }` block and
flipping to `verified` would be the ecosystem's **first real
`supported` → `verified` transition** — and the first integration in the
registry backed by something that executes.

---

## CI note — the hardening step overlaps with "Unit tests"

`.github/workflows/validate.yml` gained exactly one step:

```yaml
      - name: Hardening suite
        run: npm run test:hardening
```

**This duplicates work, on purpose, and it is not an oversight.**
`npm test` is `node --test test/*.test.mjs` and globs all ten test files.
`npm run test:hardening` names eight of those same ten explicitly — every file
except `compile.test.mjs` and `validate.test.mjs`, the two pre-Phase-2 baseline
files. Measured:

```
$ npm test                  → tests 111, pass 111, fail 0
$ npm run test:hardening    → tests  51, pass  51, fail 0
```

So **51 of 111 tests run twice per CI job**, costing roughly 40 seconds.

The alternative was restructuring `package.json`'s `test` / `test:hardening`
script definitions so the two sets are disjoint. That was rejected: `npm test`
is named verbatim in the Global Constraints, in the baseline every task in this
phase was measured against, and in the existing workflow. Changing how it is
composed to save 40 seconds of CI trades a documented cost for an undocumented
risk. The benefit bought by the duplicate step is that a hardening regression
shows up as a distinctly named red step rather than as one failure inside a
111-test run.

If a future phase does restructure the scripts, the fix is to give
`test:hardening` its own directory or a test-name filter — not to delete the
step.

---

## Baseline after Phase 2

Run from `ecosystem/`, at the end of the phase, with every Phase 2 artifact in
place.

```
$ node scripts/validate.mjs --repos ..
SKIP   R-META4   product:code-comrades
         no requires-python declared

0 error(s), 0 warning(s), 1 skipped.
```
exit 0

```
$ node scripts/compile.mjs --check
unchanged  catalog.json
unchanged  .claude-plugin/marketplace.json

9 of 9 products described, 2 plugin(s) in the "nextbridge" marketplace.
```
exit 0

```
$ node scripts/sync.mjs --repos .. --check
unchanged  repocode
unchanged  block-builder
unchanged  graphpowers
unchanged  project-charter
unchanged  code-comrades
unchanged  agent-loop-guard
unchanged  registry-guard
unchanged  edge-compat-check
unchanged  package-pilot

0 change(s).
```
exit 0

```
$ npm test
ℹ tests 111
ℹ suites 0
ℹ pass 111
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
exit 0

```
$ npm run verify:clean-env
OK    code-comrades@nextbridge
FAIL  graphpowers@nextbridge installed but did not load
verify-clean-env: 1 plugin(s) failed in a clean environment
```
exit 2 — **expected and correct**, see
[Release blocker](#release-blocker--graphpowersnextbridge-does-not-install-cleanly).
The full output is quoted there, unedited.

Against the spec's recorded baseline (`60 pass, 0 fail`), the suite grew to 111
tests with the same four commands producing the same four results. Nothing
regressed.

---

## The recurring finding: implementation is ground truth, the plan is a hypothesis

This came up in nearly every task of the phase, and it is the most transferable
thing Phase 2 produced. A written plan describes what the author believed the
code did. The code is what it does. Three concrete cases:

1. **Task 7 — R-REF1 versus R-TAX1.** The plan's taxonomy-evolution test
   expected a capability pointing at an unknown *category* to be caught by the
   capability-reference rule. It is not: R-REF1 resolves a manifest's capability
   against the taxonomy, R-TAX1 resolves a taxonomy leaf's category. Different
   rules, different subjects. The test was corrected to assert the rule that
   actually fires.

2. **Task 8 — the layer3-only R-META1 mutation.** The plan's "every rule that
   can error names a subject" test mutated
   `registry.products['graphpowers'].repository` and called `layer1` + `layer2`.
   R-META1 lives in `layer3` and needs a checked-out repository, so the mutation
   produced **zero** ERROR findings and the assertion loop would have iterated
   zero times — a test that passes by doing nothing. Replaced with a `.family`
   mutation, which fires R-REF7 for real, plus an explicit non-vacuity
   assertion. The corrected test carries a comment explaining why.

3. **Task 9 — `plugin details` versus `plugin list`.** The clean-environment
   script was specified to read plugin load status from `claude plugin details`.
   `details` reports static manifest contents and stays silent about a plugin
   that installed fine and then failed to load. `claude plugin list` is the
   source of truth. Had the script shipped as specified, it would have reported
   `graphpowers@nextbridge` as healthy — and the release blocker in this report
   would still be undiscovered.

4. **Task 10 — the onboarding order in this phase's own plan.** The plan (and
   this report's brief) specified: add the registry entry with
   `manifest_status: pending`, run `sync`, then flip to `present`. Executed in a
   fixture, `sync.mjs` skips every product whose `manifest_status` is not
   `present`, so that sync copies nothing and the subsequent validate fails:

   ```
   ERROR  R-REF2    product:widget-lint
            manifest_status is "present" but manifests/ has no manifest
   ```

   [ADDING-A-PRODUCT.md](../ADDING-A-PRODUCT.md) documents the order that works —
   set `present`, *then* sync — and explains why, quoting the line of
   `sync.mjs` responsible.

The discipline that produced all four: run the thing before writing it down.

---

## Architectural decisions worth preserving

- **The SDD process was adapted to a git-less repository.** Neither
  `ecosystem/` nor any of the nine product directories is a git repository
  locally, by deliberate decision. No worktrees, no commits, no diffs: review
  packages are full file contents, and each task ends by re-running the
  four-command baseline instead of committing. Level 2's "disposable git
  lifecycle" uses `gitInit` on temporary fixture directories under
  `os.tmpdir()` only — the real tree is never initialised.

- **D1 — plugin implementation metadata is not ecosystem-owned.** The
  marketplace entry omits `version`; `plugin.json` in the product repository
  stays authoritative. Proved by `marketplace entries omit version, so
  plugin.json stays authoritative` and `bumping a plugin.json version produces
  zero ecosystem drift anywhere`. The cost of this decision is visible in the
  release blocker: the ecosystem cannot fix a defect in a published plugin
  manifest, only detect it.

- **`compile.mjs` enforces layers 1 and 2 unconditionally.** No `--repos`
  needed, and no flag to skip it. A catalog compiled from a registry that does
  not validate is worse than no catalog, so the compiler refuses with exit 2 —
  including on R-MK3, which is what stops a curated marketplace from being
  compiled out of an inconsistent registry.

- **C1 — `ROOT` is not parameterised for tests.** `paths` derives from
  `import.meta.url`, so a fixture ecosystem is validated by copying the whole
  tree and running the *copied* scripts as subprocesses. Adding a root
  parameter would have been a change to shipped code in service of tests.
  Copying a tree is not.

- **Every drift test is paired with a legitimate-evolution negative.** A rule
  that only ever proves it can fire is a rule nobody can tell is too strict. See
  the table in [Level 2](#level-2--disposable-git-lifecycle-and-repository-drift).

- **The snapshot boundary is enforced outside the snapshots (C2).** R-SYNC1
  compares bytes, so the "do not edit" notice lives in
  [manifests/README.md](../../manifests/README.md), `.gitattributes`, and this
  document — never inside a `manifests/*.yaml`.

---

## What Phase 2 intentionally did not build

Straight from [PHASE-2-SPEC.md](PHASE-2-SPEC.md)'s *Non-goals — explicitly out
of scope*, all of which held:

- **No integrations.** `registry.integrations` is still `[]`.
- **No solutions.** `registry.solutions` is still `[]`.
- **No marketplace UI, website, or CLI.**
- **No changes to `product.v1`.** The freeze in
  [SCHEMA-FREEZE.md](../SCHEMA-FREEZE.md) holds; `schema/product.v1.schema.json`
  was not touched.
- **No maturity model change.** O2 stays deferred. The maturity section above is
  evidence, not a model.
- **No git initialisation of the nine product directories**, and **no connection
  or push to the real `nextbridgehq` remotes.**

And, added by this phase's own constraints:

- **No new or altered validation rules.** `scripts/lib/rules.mjs` is unchanged
  by Phase 2. G1 is a recommendation, not a patch.
- **No Level 3.** GitHub Actions execution belongs to a publishing phase.

---

## Recommended next phase

Evidence-grounded, in the order the evidence supports:

1. **Resolve the `graphpowers` publish.** Push the Phase-1.5 `hooks` fix to
   `nextbridgehq/graphpowers`, cut a release, and re-run
   `npm run verify:clean-env` until it exits 0. This is the only item blocking a
   truthful "the canonical marketplace installs cleanly" claim, and it is one
   line of JSON.
2. **Push `ecosystem/` and prove Level 3.** Real `actions/checkout`, real
   `gh repo clone` of nine repositories, a real scheduled sync PR from
   `peter-evans/create-pull-request@v7`, and the `git checkout --` restore step
   in `validate.yml` executing for the first time. Add `verify:clean-env` to a
   scheduled workflow so the marketplace is re-proved without anyone
   remembering to.
3. **Decide the R-META1/3/4 distribution-scoping question (G1).** Either scope
   the candidate collection to `manifest.distribution[].packages`, with paired
   drift and legitimate-evolution tests, or record explicitly that monorepo
   any-of semantics are accepted and say so in the rule messages so nobody reads
   more into a green run than it means.
4. **Then, and only then, revisit O2 (maturity).** The evidence table above is
   the input. The honest conclusion it supports today is that `stable` means "a
   CI file exists", and that a computed `ecosystem_status` would need at least
   one new observable check — probably "tests present", possibly "last build
   green", which is only available after step 2.

Integrations and solutions remain correctly empty. Zero is a finding, not a gap.

---

## Post-Phase-2 closure — graphpowers release blocker resolved

Item 1 of the recommended next phase above, and G1, are both now done. This
addendum records the first and updates the ordering; it does not edit the
sections above, which stand as originally written.

**What was done**, outside this repository, against the real
`nextbridgehq/graphpowers`:

1. The stale local `graphpowers/` working copy (5 commits behind) was pulled
   to `origin/main` (`45bbf22816d2f1e98e44d2c0a0e34f9799ed7539`) — confirmed,
   before editing anything, that this commit still carried the redundant
   `"hooks": "./hooks/hooks.json"` declaration in `.claude-plugin/plugin.json`.
2. A branch (`fix/remove-redundant-hooks-declaration`) removed exactly that
   one line — verified before commit: valid JSON, clean `git diff --check`,
   `git diff --stat` showing exactly one file and one deleted line.
3. Pull request [nextbridgehq/graphpowers#5](https://github.com/nextbridgehq/graphpowers/pull/5)
   opened, reviewed, and **merged** by the repository owner. Merge commit
   `c42c173ac35ec6eb121b3782e14e2bafcd9e96e1`.
4. `release-please` did **not** run on the merge (its workflow has
   `paths-ignore: [".claude-plugin/**"]`, and the merge touched only a file
   under that path — GitHub never dispatches a run when every changed file is
   ignored). This is pre-existing repository configuration, not a defect.
   Investigated and confirmed harmless: `.claude-plugin/marketplace.json`'s
   `graphpowers` source has no `ref`/`sha` pin, so `claude plugin install`
   resolves the repository's default branch directly — the fix did not need a
   tagged release to reach a fresh install.
5. `npm run verify:clean-env` re-run from `ecosystem/`, against the now-merged
   `main`:

   ```
   $ npm run verify:clean-env
   claude 2.1.270 (Claude Code)
   OK    code-comrades@nextbridge
     Skills (10)  ...
   OK    graphpowers@nextbridge
     Skills (11)  ...
     Hooks (1)  SessionStart  (harness-only — no model context cost)

   Installed plugins:
     ❯ code-comrades@nextbridge   Version: 0.3.0   Status: ✔ enabled
     ❯ graphpowers@nextbridge     Version: 0.3.1   Status: ✔ enabled

   All 2 plugin(s) installed and loaded from a clean Claude environment.
   ```
   Exit code 0. No "Duplicate hooks file" error. The developer's real Claude
   configuration, `ecosystem/`, and the local `graphpowers/` working tree were
   all untouched by this verification run (isolated `CLAUDE_CONFIG_DIR`,
   cleaned up after).

**Evidentiary chain this establishes:** known broken published state → PR
against the real upstream repository → owner-merged → unpinned marketplace
source resolves the merge directly → fresh network install → actual plugin
load succeeds. This is the same class of proof `verify:clean-env` was built
for in Phase 2 — a real install from the real source, not a schema check —
now run against the corrected upstream state instead of the broken one.

**Result:** all three status lines in
[Status](#status-three-lines-not-one) are GREEN.
🔴 marketplace-release-ready → 🟢.

**G1 status:** also closed, separately, before this addendum was written. See
`G1-METADATA-SCOPING-SPEC.md` and `G1-IMPLEMENTATION-PLAN.md` in this
directory. R-META1/R-META3/R-META4 now validate each declared npm package
independently (no any-of masking across monorepo siblings); fallback behavior
for products declaring no npm packages is unchanged. 115/115 tests pass; the
Phase 2 baseline (`validate`/`compile`/`sync`) is unchanged against all 9 real
products.

### Recommended next phase — revised

The original four-item list above is superseded by this ordering, now that
items 1 and 3 are done:

1. ~~Resolve the `graphpowers` publish.~~ **Done** — see above.
2. ~~Decide the R-META1/3/4 distribution-scoping question (G1).~~ **Done** —
   see above.
3. **Push `ecosystem/` and prove Level 3.** Real `actions/checkout`, real
   `gh repo clone` of the nine product repositories, a real scheduled sync PR
   from `peter-evans/create-pull-request@v7`, and the `git checkout --`
   restore step in `validate.yml` executing for the first time. Add
   `verify:clean-env` to a scheduled workflow so the marketplace stays
   re-proved without anyone remembering to run it by hand. This is now the
   only remaining item from the original list, and the largest — it reverses
   a deliberate no-git-locally decision made across Phases 1–2 for
   `ecosystem/` itself (the nine product directories' own git status is
   unaffected; `graphpowers/` was already, separately, a real git working
   copy pointing at its own upstream, which is what made this addendum's fix
   possible).
4. **Then, and only then, revisit O2 (maturity).** Unchanged from the original
   recommendation — still gated on step 3, for the same reason: a computed
   `ecosystem_status` needs at least one new observable check (most likely
   "tests present" or "last build green"), and "last build green" only
   exists once step 3 gives the ecosystem a real CI history to read.
