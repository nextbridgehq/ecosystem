import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, run, patchJson } from './lib/fixture.mjs';
import { WARN } from '../scripts/lib/rules.mjs';

/** Every finding validate.mjs produces for a fixture, parsed. */
function findings(ws) {
  const r = run(ws, ['scripts/validate.mjs', '--repos', '..', '--json']);
  assert.ok(r.stdout.length > 0, `validate produced no JSON: ${r.stderr}`);
  return { ...JSON.parse(r.stdout), code: r.code };
}
const rule = (f, id) => [...f.errors, ...f.warnings, ...f.skipped].filter((x) => x.rule === id);
const errorsFor = (f, id) => f.errors.filter((x) => x.rule === id);

/* ── R-META1: repository identity drift ───────────────────────────────── */

test('R-META1 catches a repository that starts claiming a different owner', () => {
  const ws = makeWorkspace({ products: ['package-pilot'] });
  try {
    patchJson(ws, 'package-pilot', 'package.json', (p) => ({
      ...p, repository: { type: 'git', url: 'git+https://github.com/someone-else/package-pilot.git' },
    }));
    const hits = errorsFor(findings(ws), 'R-META1');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /someone-else\/package-pilot/);
  } finally {
    ws.cleanup();
  }
});

// T4-1: the brief's negative added a package.json `homepage`, which R-META1
// never reads (it only reads `homepage` from pyproject.toml) and package-pilot
// already has one, so that test could never fail. Instead, change the SAME
// identity into its SSH form. normalizeRepoRef's `github.com:` branch resolves
// it to the same "owner/repo" the registry declares, so this is legitimate
// maintainer behaviour (switching remote URL style) that must stay quiet.
test('R-META1 stays quiet when a repository states its own URL in SSH form', () => {
  const ws = makeWorkspace({ products: ['package-pilot'] });
  try {
    patchJson(ws, 'package-pilot', 'package.json', (p) => ({
      ...p, repository: { type: 'git', url: 'git@github.com:nextbridgehq/package-pilot.git' },
    }));
    assert.deepEqual(findings(ws).errors, []);
  } finally {
    ws.cleanup();
  }
});

/* ── R-META2: distribution drift ──────────────────────────────────────── */

// T4-2: the brief mutated repocode's ROOT package.json ("repocode-monorepo"),
// which is private and not a declared distribution package, so both of its
// tests were vacuous no-ops hidden behind `if` guards. repocode declares three
// npm packages (repocode, @repocode/core, @repocode/mcp), each backed by its
// own workspace package.json. Target those instead, unconditionally.

test('R-META2 catches a declared npm package that the repository renamed', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, name: `${p.name}-renamed` }));
    const hits = errorsFor(findings(ws), 'R-META2');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /"@repocode\/core"/);
  } finally {
    ws.cleanup();
  }
});

test('R-META2 catches a distribution package that becomes private', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/mcp/package.json', (p) => ({ ...p, private: true }));
    const hits = errorsFor(findings(ws), 'R-META2');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /@repocode\/mcp/);
    assert.match(hits[0].message, /private/);
  } finally {
    ws.cleanup();
  }
});

// T4-3: R-META2 had no legitimate-evolution pair in the brief, though the
// brief's own introduction says every drift test is paired. A version bump on
// a workspace package is ordinary evolution and must not trip anything.
test('R-META2 stays quiet when a distribution package merely bumps its version', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, version: '9.9.9' }));
    assert.deepEqual(findings(ws).errors, []);
  } finally {
    ws.cleanup();
  }
});

/* ── R-META3: licence drift ───────────────────────────────────────────── */

test('R-META3 catches a licence change the manifest did not follow', () => {
  const ws = makeWorkspace({ products: ['package-pilot'] });
  try {
    patchJson(ws, 'package-pilot', 'package.json', (p) => ({ ...p, license: 'GPL-3.0-only' }));
    const hits = errorsFor(findings(ws), 'R-META3');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /GPL-3\.0-only/);
  } finally {
    ws.cleanup();
  }
});

test('R-META3 warns, and does not error, when only the LICENSE file is missing', () => {
  const ws = makeWorkspace({ products: ['package-pilot'] });
  try {
    for (const name of ['LICENSE', 'LICENSE.md']) {
      rmSync(join(ws.repo('package-pilot'), name), { force: true });
    }
    const f = findings(ws);
    assert.deepEqual(f.errors, []);
    assert.ok(rule(f, 'R-META3').some((h) => h.severity === WARN && /LICENSE/.test(h.message)));
  } finally {
    ws.cleanup();
  }
});

/* ── R-META4: runtime drift ───────────────────────────────────────────── */

// T4-4: package-pilot declares neither runtime.node nor engines.node, making
// the brief's pair vacuous. agent-loop-guard is the first product
// (alphabetically) whose manifest declares runtime.node ("`>=18`") and whose
// single package.json also declares engines.node ("`>=18`").

test('R-META4 catches a runtime floor the manifest did not follow', () => {
  const ws = makeWorkspace({ products: ['agent-loop-guard'] });
  try {
    patchJson(ws, 'agent-loop-guard', 'package.json', (p) => ({ ...p, engines: { ...p.engines, node: '>=22' } }));
    const hits = errorsFor(findings(ws), 'R-META4');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /22/);
  } finally {
    ws.cleanup();
  }
});

test('R-META4 treats ">=18" and ">=18.0.0" as the same floor', () => {
  const ws = makeWorkspace({ products: ['agent-loop-guard'] });
  try {
    patchJson(ws, 'agent-loop-guard', 'package.json', (p) => ({ ...p, engines: { ...p.engines, node: '>=18.0.0' } }));
    assert.deepEqual(findings(ws).errors, []);
  } finally {
    ws.cleanup();
  }
});

/* ── G1: per-package independent validation (no any-of masking) ────────── */

// G1: repocode declares three independent npm packages (repocode,
// @repocode/core, @repocode/mcp), each with its own repository/license/
// engines.node field. Mutating only @repocode/core must not be maskable by
// its healthy siblings. Against today's any-of Set-based check, each of
// these four tests currently produces ZERO findings — that is the gap this
// plan closes. Once rules.mjs implements strict per-package validation
// (Task 2), each test's real assertions below must pass.

test('R-META1 catches one declared sibling package disagreeing on repository even when the others agree', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({
      ...p, repository: { type: 'git', url: 'https://github.com/someone-else/repocode.git' },
    }));
    const hits = errorsFor(findings(ws), 'R-META1');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /@repocode\/core/);
    assert.match(hits[0].message, /someone-else\/repocode/);
    assert.doesNotMatch(hits[0].message, /"repocode"/);
    assert.doesNotMatch(hits[0].message, /@repocode\/mcp/);
  } finally {
    ws.cleanup();
  }
});

test('R-META3 catches one declared sibling package disagreeing on licence even when the others agree', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, license: 'Apache-2.0' }));
    const hits = errorsFor(findings(ws), 'R-META3');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /@repocode\/core/);
    assert.match(hits[0].message, /Apache-2\.0/);
    assert.doesNotMatch(hits[0].message, /@repocode\/mcp/);
  } finally {
    ws.cleanup();
  }
});

test('R-META4 catches one declared sibling package disagreeing on runtime floor even when the others agree', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, engines: { ...p.engines, node: '>=18.0.0' } }));
    const hits = errorsFor(findings(ws), 'R-META4');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /@repocode\/core/);
    assert.match(hits[0].message, /18/);
    assert.doesNotMatch(hits[0].message, /@repocode\/mcp/);
  } finally {
    ws.cleanup();
  }
});

test('R-META3 reports two independent errors when two declared sibling packages both disagree on licence', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, license: 'Apache-2.0' }));
    patchJson(ws, 'repocode', 'packages/mcp/package.json', (p) => ({ ...p, license: 'Apache-2.0' }));
    const hits = errorsFor(findings(ws), 'R-META3');
    assert.equal(hits.length, 2, JSON.stringify(hits));
    const named = hits.map((h) => h.message).join('\n');
    assert.match(named, /@repocode\/core/);
    assert.match(named, /@repocode\/mcp/);
  } finally {
    ws.cleanup();
  }
});

/* ── R-META5: the CI claim behind "stable" ────────────────────────────── */

test('R-META5 catches a stable product that loses its CI', () => {
  const ws = makeWorkspace({ products: ['code-comrades'] });
  try {
    rmSync(join(ws.repo('code-comrades'), '.github', 'workflows'), { recursive: true, force: true });
    const hits = errorsFor(findings(ws), 'R-META5');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /stable/);
  } finally {
    ws.cleanup();
  }
});

test('R-META5 accepts any workflow file, not one particular name', () => {
  const ws = makeWorkspace({ products: ['code-comrades'] });
  try {
    const dir = join(ws.repo('code-comrades'), '.github', 'workflows');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'anything-at-all.yaml'), 'name: x\non: push\njobs: {}\n', 'utf8');
    assert.deepEqual(findings(ws).errors, []);
  } finally {
    ws.cleanup();
  }
});

/* ── The repository going away entirely ───────────────────────────────── */

test('a missing repository is skipped, never silently passed', () => {
  const ws = makeWorkspace({ products: ['graphpowers'] });
  try {
    const f = findings(ws);
    assert.equal(f.code, 0);
    const skips = f.skipped.filter((x) => x.rule === 'R-REPO');
    assert.equal(skips.length, 8, `expected 8 unavailable repositories, got ${skips.length}`);
    // T4-6: prove the one repository that WAS copied into the fixture was
    // actually checked, not accidentally swept up as "unavailable" too.
    assert.ok(
      !skips.some((s) => s.subject === 'product:graphpowers'),
      'graphpowers repository was copied into the fixture and should not be skipped',
    );
  } finally {
    ws.cleanup();
  }
});
