# Validation Hardening Design

**Date:** 2026-10-08
**Scope:** Six defects found in the 2026-10-08 architecture review. Each fix is
small and carries one test that fails before the fix.

## Goal

Make validation report what is true. Today several checks pass silently,
crash, or test something other than what they claim.

## Fixes

### 1. `readPyproject` misreads the last section

`scripts/lib/io.mjs` `readPyproject` ends a section with `(?=^\[|\Z)`.
JavaScript has no `\Z`; it matches a literal `Z`. Effects:

- `[project]` as the final section: the regex fails, every field is `null`.
  R-META1/3/4 (Python) skip silently. R-META2 (PyPI) reports a false error
  `pyproject.toml names "(none)"`.
- A `Z` inside the section truncates it.

**Fix:** replace the lookahead with `(?=^\[|(?![\s\S]))` (next header or end
of input).

### 2. Python version floor ignores the minor version

`versionFloor` returns the major only. `>=3.10` and `>=3.12` both yield `3`, so
R-META4 accepts any Python 3 floor.

**Fix:** add `pythonFloor(range)` to `io.mjs`. It returns `"<major>.<minor>"`,
minor defaulting to `0`, or `null` when unreadable. `>=3` and `>=3.0` compare
equal. R-META4's Python branch uses it, and its messages print the
`major.minor` strings. Node keeps `versionFloor`: there the major floor is the
intended comparison.

### 3. Manifest filename check never fires

`loadManifests` keys each manifest by `doc.id`. `layer1` then checks
`doc.id !== key`, which is only true when `id` is missing. A file `foo.yaml`
with `id: bar` passes; two files with the same `id` silently overwrite.

**Fix:** key by filename without `.yaml`. The existing layer 1 check then
reports the mismatch as `R-SCHEMA`. `sync.mjs` always writes `<id>.yaml`, so
correct snapshots are unaffected.

### 4. Layer 3 runs on structurally broken manifests

`validate.mjs` skips layer 2 when layer 1 has errors, but always runs layer 3.
A manifest that fails the schema (for example a plugin without `path`) makes
layer 3 throw. The run exits `1` with a TypeError and the schema findings are
lost.

**Fix:** when layer 1 has errors and a repos directory is given, do not run
layer 3. Add `{ rule: 'R-REPO', severity: 'skipped', subject: 'layer 3',
message: 'not run - layer 1 failed' }`. Exit code follows the existing
contract: `2` because errors exist.

### 5. Clone failure passes repo-consistency CI

`.github/workflows/repo-consistency.yml` turns a failed clone into a warning.
Layer 3 then marks the product skipped and exits `0`. A missing or expired
`ECOSYSTEM_READ_TOKEN` makes the whole layer vacuous and green.

**Fix:** a failed clone emits `::error::could not clone <repo>` and the step
exits `1` after trying every repository (so the log lists all failures, not
only the first). Local runs keep the `skipped` behaviour for absent
checkouts; this changes CI only.

### 6. Fixture patching breaks on Windows CRLF checkouts

`test/lib/fixture.mjs` `patchProduct` passes raw file text to the mutator.
On a Windows checkout with `core.autocrlf=true` fixtures have CRLF, so
`sync-lifecycle.test.mjs` fails to find its LF anchor text.

**Fix:** `patchProduct` normalises `\r\n` to `\n` before calling the mutator,
matching `readFixture`. `.gitattributes` stays unchanged.

## Tests

| Fix | Test | Fails before fix because |
|-----|------|--------------------------|
| 1 | `test/io.test.mjs`: `[project]` last section returns its fields; a `Z` in a value does not truncate | fields are `null` / truncated |
| 2 | `test/io.test.mjs`: `pythonFloor('>=3.10') !== pythonFloor('>=3.12')`; `pythonFloor('>=3') === pythonFloor('>=3.0')`; non-string returns `null` | function missing |
| 2 | `test/drift-repository-fixture.test.mjs`: manifest `runtime.python: ">=3.12"` against fixture `requires-python = ">=3.9"` yields R-META4 error | major-only compare passes |
| 3 | `test/error-contract.test.mjs`: workspace with `manifests/misnamed.yaml` holding `id: graphpowers` → `validate --json` exit 2 with R-SCHEMA on `manifests/misnamed.yaml` | no finding |
| 4 | `test/error-contract.test.mjs`: workspace manifest with a plugin missing `path`, `validate --repos .. --json` → exit 2, R-SCHEMA present, R-REPO skipped `layer 3` | exit 1, TypeError |
| 6 | existing `sync-lifecycle.test.mjs` on Windows | already failing |

Fix 5 is a workflow change with no automated test. Verify by reading the diff.

## Out of scope

Review findings 7–11 and the nits: duplicate CI test runs, unreadable-file
crashes, partial sync writes, `sync.mjs` CLI flags, `plugin.manifest` path
pattern, dead code. Separate pass.

## Acceptance

- `npm test` passes on Windows and Linux.
- `npm run check` exits 0; `catalog.json` and the marketplace are unchanged.
