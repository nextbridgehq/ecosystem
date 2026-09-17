# Synthetic Product Fixtures

These fixtures are **synthetic test stubs**, NOT clones of production repositories.
They provide the minimum metadata files required to test Layer 3 validation rules deterministically, offline, and without network or external repository dependencies.

## Invariant
Fixtures are read-only test inputs. All mutation occurs exclusively inside temporary workspace copies created by `makeWorkspace()`. Never mutate files in this directory.

## Product Coverage
- `repocode`: Multi-package monorepo (cli, core, mcp) with engines.node >=20.0.0.
- `code-comrades`: Claude Code plugin with 10 skills, hooks, and CI workflow.
- `graphpowers`: Python project with pyproject.toml repo URL, 11 skills, hooks.
- `package-pilot`: Private npm package (`"private": true`).
- `project-charter`: Python project with pyproject.toml repo URL.
- `edge-compat-check`: Product intentionally lacking CI workflow (negative test for R-META5).
- `agent-loop-guard`, `block-builder`, `registry-guard`: Standard products with package.json and CI workflows.
