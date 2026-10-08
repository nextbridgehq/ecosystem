import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeWorkspace, run, patchJson, FIXTURES_ROOT } from './lib/fixture.mjs';
import { paths, readYaml, loadManifests } from '../scripts/lib/io.mjs';
import { layer3, ERROR, WARN } from '../scripts/lib/rules.mjs';

const registry = readYaml(paths.registry);
const manifests = loadManifests();

const clone = (v) => structuredClone(v);
const rules = (findings, r) => findings.filter((x) => x.rule === r);
const baseManifest = () => clone(manifests.repocode.doc);
const withManifests = (entries) =>
  Object.fromEntries(entries.map((doc) => [doc.id, { file: `${doc.id}.yaml`, doc }]));

const pluginManifest = (overrides = {}) => ({
  ...baseManifest(),
  id: 'code-comrades',
  interfaces: [],
  plugins: [{
    name: 'code-comrades',
    host: 'claude-code',
    path: '.',
    manifest: '.claude-plugin/plugin.json',
    marketplace: 'nextbridge',
    components: { skills: 10, agents: 1, commands: 0, hooks: false, mcp: false },
    status: 'published',
    ...overrides,
  }],
});

const strayMarketplaceRepo = (id) => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-mk2-'));
  mkdirSync(join(dir, id, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, id, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: `${id}-marketplace`, owner: { name: 'Nextbridge' }, plugins: [] }));
  return dir;
};

/** Every finding validate.mjs produces for a fixture, parsed. */
function findings(ws) {
  const r = run(ws, ['scripts/validate.mjs', '--repos', '..', '--json']);
  assert.ok(r.stdout.length > 0, `validate produced no JSON: ${r.stderr}`);
  return { ...JSON.parse(r.stdout), code: r.code };
}
const rule = (f, id) => [...f.errors, ...f.warnings, ...f.skipped].filter((x) => x.rule === id);
const errorsFor = (f, id) => f.errors.filter((x) => x.rule === id);

/* ── In-Memory Rule Verification against Synthetic Fixtures ──────────── */

test('R-META1 catches a repository URL mismatch against fixture (the project-charter defect)', () => {
  const reg = clone(registry);
  reg.products['project-charter'].repository = 'saadat-dev/project-charter';
  const doc = { ...baseManifest(), id: 'project-charter', distribution: [] };
  const res = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(res, 'R-META1');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /nextbridgehq\/project-charter/);
});

test('R-META2 catches a product distributed on npm while marked private (the package-pilot case)', () => {
  const reg = clone(registry);
  reg.products['package-pilot'].manifest_status = 'present';
  const doc = {
    ...baseManifest(), id: 'package-pilot',
    distribution: [{ channel: 'npm', packages: ['package-pilot'], access: 'public' }],
  };
  const res = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(res, 'R-META2');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /"private": true/);
});

test('R-META5 catches maturity "stable" in a repository with no CI (edge-compat-check fixture)', () => {
  const reg = clone(registry);
  reg.products['edge-compat-check'].manifest_status = 'present';
  const doc = { ...baseManifest(), id: 'edge-compat-check', maturity: 'stable' };
  const res = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.equal(rules(res, 'R-META5').length, 1);
});

test('R-META5 accepts "stable" when repository runs CI (code-comrades fixture)', () => {
  const res = layer3({ registry, manifests, reposDir: FIXTURES_ROOT });
  assert.deepEqual(rules(res, 'R-META5').filter((f) => f.severity === ERROR), []);
});

test('R-META4 catches a declared Node floor the repository does not support (repocode fixture)', () => {
  const reg = clone(registry);
  const doc = baseManifest();
  doc.runtime.node = '>=18';
  const res = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.equal(rules(res, 'R-META4').length, 3);
});

test('R-META4 catches a Python floor that differs only in the minor version (graphpowers fixture)', () => {
  const doc = { ...baseManifest(), id: 'graphpowers', runtime: { python: '>=3.12' } };
  const res = layer3({ registry, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(res, 'R-META4').filter((f) => f.severity === ERROR);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0].message, /3\.12/);
  assert.match(hits[0].message, /3\.9/);
});

test('R-META4 accepts a Python floor that matches requires-python (graphpowers fixture)', () => {
  const doc = { ...baseManifest(), id: 'graphpowers', runtime: { python: '>=3.9' } };
  const res = layer3({ registry, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.deepEqual(rules(res, 'R-META4'), []);
});

test('no synthetic product fixture ships a competing marketplace', () => {
  assert.deepEqual(rules(layer3({ registry, manifests, reposDir: FIXTURES_ROOT }), 'R-MK2'), []);
});

test('R-MK2 warns about a stray marketplace in a repository with no manifest', () => {
  const dir = strayMarketplaceRepo('project-charter');
  try {
    const hits = rules(layer3({ registry, manifests: {}, reposDir: dir }), 'R-MK2');
    assert.deepEqual(hits.map((h) => h.subject), ['product:project-charter']);
    assert.equal(hits[0].severity, WARN);
    assert.match(hits[0].message, /project-charter-marketplace/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-MK2 escalates to an error once the product has a manifest', () => {
  const dir = strayMarketplaceRepo('code-comrades');
  try {
    const res = layer3({
      registry, manifests: withManifests([pluginManifest()]), reposDir: dir,
    });
    const hits = rules(res, 'R-MK2').filter((h) => h.subject === 'product:code-comrades');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, ERROR);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-MK5 and R-MK7 accept a correct declaration of the code-comrades plugin fixture', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const res = layer3({
    registry: reg, manifests: withManifests([pluginManifest()]), reposDir: FIXTURES_ROOT,
  });
  assert.deepEqual(rules(res, 'R-MK5'), []);
  assert.deepEqual(rules(res, 'R-MK7'), []);
});

test('R-MK7 catches a component count that does not match the repository fixture', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const doc = pluginManifest({ components: { skills: 3, agents: 1, hooks: false, mcp: false } });
  const res = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(res, 'R-MK7');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /declares 3 skills but the repository has 10/);
});

test('R-MK7 accepts the real graphpowers plugin structure against fixture: 11 skills, hooks', () => {
  const reg = clone(registry);
  reg.products.graphpowers.manifest_status = 'present';
  const doc = {
    ...baseManifest(), id: 'graphpowers',
    plugins: [{
      name: 'graphpowers', host: 'claude-code', path: '.',
      manifest: '.claude-plugin/plugin.json', marketplace: 'nextbridge',
      components: { skills: 11, agents: 0, commands: 0, hooks: true, mcp: false },
      status: 'published',
    }],
  };
  const res = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.deepEqual(rules(res, 'R-MK7'), []);
  assert.deepEqual(rules(res, 'R-MK5'), []);
});

test('R-MK5 rejects a plugin manifest path that leaves the repository', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  // The sibling fixture exists, so an unchecked join would read it.
  const doc = pluginManifest({ manifest: '../graphpowers/.claude-plugin/plugin.json' });
  const res = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  const hits = rules(res, 'R-MK5');
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0].message, /outside the repository/);
  assert.deepEqual(rules(res, 'R-MK7'), []);
});

test('R-MK5 catches a plugin name that disagrees with its plugin.json fixture', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const doc = pluginManifest({ name: 'comrades' });
  const res = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: FIXTURES_ROOT });
  assert.equal(rules(res, 'R-MK5').length, 1);
});

/* ── Workspace Drift Mutation Tests ──────────────────────────────────── */

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

test('R-META2 catches a declared npm package that the repository renamed', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, name: '@repocode/renamed' }));
    const hits = errorsFor(findings(ws), 'R-META2');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /@repocode\/core/);
  } finally {
    ws.cleanup();
  }
});

test('R-META2 catches a distribution package that becomes private', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, private: true }));
    const hits = errorsFor(findings(ws), 'R-META2');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /"private": true/);
  } finally {
    ws.cleanup();
  }
});

test('R-META2 stays quiet when a distribution package merely bumps its version', () => {
  const ws = makeWorkspace({ products: ['repocode'] });
  try {
    patchJson(ws, 'repocode', 'packages/core/package.json', (p) => ({ ...p, version: '9.9.9' }));
    assert.deepEqual(findings(ws).errors, []);
  } finally {
    ws.cleanup();
  }
});

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

test('a missing repository is skipped, never silently passed', () => {
  const ws = makeWorkspace({ products: ['graphpowers'] });
  try {
    const f = findings(ws);
    assert.equal(f.code, 0);
    const skips = f.skipped.filter((x) => x.rule === 'R-REPO');
    assert.equal(skips.length, 8, `expected 8 unavailable repositories, got ${skips.length}`);
    assert.ok(
      !skips.some((s) => s.subject === 'product:graphpowers'),
      'graphpowers repository was copied into the fixture and should not be skipped',
    );
  } finally {
    ws.cleanup();
  }
});
