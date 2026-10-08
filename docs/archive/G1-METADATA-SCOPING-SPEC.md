# G1 — Per-Package Metadata Scoping (Spec)

Status: approved, not yet implemented. Addresses gap **G1** recorded in
[PHASE-2-REPORT.md](PHASE-2-REPORT.md#g1--r-meta1--r-meta3--r-meta4-are-satisfied-by-any-package-in-the-tree).

## The defect this closes

R-META1 (repository identity), R-META3 (licence), and R-META4 (runtime floor,
node branch) currently validate a *monorepo* by collecting every package.json
under the repository (`collectPackageJson`, depth 4) and asking whether **any**
of them agrees with the manifest — a `Set`-membership / any-of check.

Demonstrated live against `repocode` (declares three npm packages:
`repocode`, `@repocode/core`, `@repocode/mcp`, each with its own `repository`,
`license`, and `engines.node` field): mutating **only** `@repocode/core`'s
licence to `Apache-2.0` and its `engines.node` to `>=18.0.0`, while `repocode`
(cli) and `@repocode/mcp` still say `MIT` / `>=20.0.0`, produces **zero**
errors. The healthy siblings mask the drifted one.

Scoping the candidate collection to `manifest.distribution[].packages` (the
literal G1 recommendation text) does **not** by itself close this: the three
packages above are exactly the three already-declared packages. The mask is
caused by any-of/`Set` semantics, not by unrelated tree noise. The real fix is
per-package independent validation.

## Scope

- `ecosystem/scripts/lib/rules.mjs` only.
- Three branches, each independently:
  - R-META1's npm-derived repository-identity check
  - R-META3's npm-derived licence check
  - R-META4's `engines.node` branch
- **Not touched:** `io.mjs` / `collectPackageJson` (collector stays exactly as
  broad as it is today — see [Collector stays broader](#the-collector-stays-broader-than-the-manifest-and-that-is-fine));
  R-META2 (already correct — resolves each declared package by exact name);
  R-META4's `python`/`requires-python` branch; R-META3's LICENSE-file-existence
  `WARN`; R-META1's `pyproject.toml`/`plugin.json` singleton candidates;
  schema, taxonomy, sync, compile, maturity model, integrations, solutions.

## Selection

```
declaredNpm = Set(
  manifest.distribution
    .filter(d => d.channel === 'npm')
    .flatMap(d => d.packages ?? [])
)
```

Exact string membership only — **no normalization**. `repocode`,
`@repocode/core`, and `@repocode/mcp` are three distinct, independent names;
nothing coerces them toward equivalence.

- `declaredNpm.size > 0` → **strict mode** (below).
- `declaredNpm.size === 0` → **fallback mode**: the existing implementation,
  unchanged. This is a compatibility invariant, not a suggestion — see
  [Fallback is frozen](#fallback-mode-is-frozen).

## Strict mode

For each name in `declaredNpm`, find the matching entry in `pkgs` (collected
package.json files) by exact `json.name` equality. For each match:

- **R-META1** — normalize its `repository` field (same `normalizeRepoRef` used
  today). If it resolves to a non-null ref and that ref `!== entry.repository`,
  emit one `R-META1` `ERROR` naming that package.
- **R-META3** — if it declares a `license` field and that value
  `!== manifest.license`, emit one `R-META3` `ERROR` naming that package.
- **R-META4** — if it declares `engines.node` and `versionFloor(that)` differs
  from `versionFloor(manifest.runtime.node)`, emit one `R-META4` `ERROR`
  naming that package.

**Core invariant — independent evaluation, no collapsing:**

> Each declared npm package is evaluated independently. A mismatch in one
> package MUST NOT satisfy, suppress, or collapse a mismatch in — or the
> absence of a mismatch in — another package.

Concretely: if both `@repocode/core` and `@repocode/mcp` have the wrong
licence, the expected result is **two** `R-META3` errors, one per package, not
one. There is no `Set` anywhere in strict mode — every declared package gets
its own pass/fail.

**SKIP semantics**, precise per field, not "all declared packages lack
everything":

| Condition (per rule, per field) | Result |
|---|---|
| A declared package exists and its field is present and matches | no finding |
| A declared package exists and its field is present and disagrees | `ERROR`, naming that package |
| A declared package exists but the field is absent on it | no finding for *that* package (silent — matches today's per-field-optional behavior; it contributes nothing to decide pass/fail) |
| **None** of the declared npm packages carry the relevant field at all | **R-META1 / R-META4:** `SKIP`, same messages as today (`"repository declares no repository URL anywhere"` / `"no engines.node declared anywhere in the repository"`). **R-META3 has no `SKIP` branch today** — zero licence fields found means silent pass, no finding at all; strict mode preserves that (do not invent a new `SKIP` for R-META3) |
| A declared name has no matching entry in `pkgs` at all | contributes nothing here — already reported by R-META2 as a missing/renamed package; strict mode does not duplicate that finding |

This preserves each rule's existing field-specific pass/skip/error semantics;
the only thing that changes is *which packages count as candidates* and *that
each is judged on its own*, not merged into a shared set.

## Fallback mode is frozen

> When `declaredNpm.size === 0`, the existing candidate selection and
> validation behavior MUST remain byte-for-byte unchanged.

```
declared npm packages
        │
        ├── > 0 ── strict declared-package validation (per-package, independent)
        │
        └── = 0 ── existing fallback path, untouched
```

This is what keeps `code-comrades`, `graphpowers`, and `package-pilot` (all of
which declare zero npm packages) validating exactly as they do today, and it
is what the six existing `package-pilot` / `agent-loop-guard` tests in
`test/drift-repository.test.mjs` already prove by construction: those tests
must keep passing byte-identical after this change, because `package-pilot`
declares no npm packages (pure fallback) and `agent-loop-guard` declares
exactly one (strict mode with a single candidate, which degenerates to the
same observable result as today's any-of check over one candidate).

## The collector stays broader than the manifest, and that is fine

`collectPackageJson` keeps collecting every package.json in the tree,
unscoped. Strict mode does not require `declaredNpm` to equal the collected
set — it only asks, of what was collected, which entries are *authoritative*
for these three checks. A repository is free to contain extra tooling
packages (`repocode-monorepo` root, `@repocode/github-action`) that are
collected but simply never consulted by R-META1/R-META3/R-META4, because
they're not named in `distribution[].packages`. This is deliberate: it keeps
the data-flow architecture (collect broad, validate narrow) and avoids turning
this task into a `collectPackageJson` redesign.

## Error contract

Severity, exit codes, and `subject` (`product:<id>`) are unchanged. Only the
`message` text changes, to name the specific declared package:

```
R-META1  registry says "nextbridgehq/repocode" but declared package
         "@repocode/core" declares "someone-else/repocode"

R-META3  manifest licence "MIT" does not match declared package
         "@repocode/core"'s licence "Apache-2.0"

R-META4  manifest node floor 20 does not match declared package
         "@repocode/core"'s engines.node floor 18
```

## Tests

Extend `test/drift-repository.test.mjs`. Three new repro-closing tests, one
per rule, using the `repocode` fixture (3 declared npm packages):

- `R-META1 catches one declared sibling package disagreeing on repository even when the others agree`
- `R-META3 catches one declared sibling package disagreeing on licence even when the others agree`
- `R-META4 catches one declared sibling package disagreeing on runtime floor even when the others agree`

Each test mutates **only** `packages/core/package.json` and asserts all of:

1. exactly one finding total for that rule
2. the finding is an `ERROR` (not `WARN`/`SKIP`)
3. the finding names `@repocode/core` (package attribution, not just "some
   package is wrong")
4. the finding does **not** name `repocode` (cli)
5. the finding does **not** name `@repocode/mcp`
6. (documented in a comment) this exact mutation currently produces zero
   findings before this change — that's the gap being closed

Point 3–5 together prove per-package attribution, not merely "detected a bad
package somewhere."

A fourth test makes the no-collapsing invariant executable, not just
documented:

- `R-META3 reports two independent errors when two declared sibling packages both disagree on licence`

Mutate both `packages/core/package.json` and `packages/mcp/package.json` to
the same wrong licence, `repocode` (cli) untouched. Assert exactly **two**
`R-META3` errors, one naming `@repocode/core` and one naming `@repocode/mcp`,
neither suppressing the other.

**Regression guard — existing six tests unchanged:**

- `R-META1 catches a repository that starts claiming a different owner` (package-pilot, fallback mode)
- `R-META1 stays quiet when a repository states its own URL in SSH form` (package-pilot, fallback mode)
- `R-META3 catches a licence change the manifest did not follow` (package-pilot, fallback mode)
- `R-META3 warns, and does not error, when only the LICENSE file is missing` (package-pilot, fallback mode, untouched WARN path)
- `R-META4 catches a runtime floor the manifest did not follow` (agent-loop-guard, strict mode with one candidate)
- `R-META4 treats ">=18" and ">=18.0.0" as the same floor` (agent-loop-guard, strict mode with one candidate)

These must all still pass, with no changes to their assertions. If any of them
requires a change to keep passing, that is a signal the fallback/degenerate-
strict invariant above has been violated.

## Non-goals

- No change to `collectPackageJson` / the collection layer.
- No change to `product.v1` schema or the taxonomy.
- No change to Python-side checks (R-META4 python branch, `py.repository` /
  `py.license` inside R-META1/R-META3) — `readPyproject` only ever reads one
  root file, so no monorepo masking is possible there today.
- No change to the LICENSE-file-existence `WARN`.
- No change to maturity model, integrations, or solutions (still out of scope
  per Phase 2's constraints, unaffected by this task).
- No restructuring of `manifest.distribution[]` shape.
