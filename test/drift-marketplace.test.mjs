import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, run, readFixture, patchJson, patchProduct } from './lib/fixture.mjs';

function findings(ws) {
  const r = run(ws, ['scripts/validate.mjs', '--repos', '..', '--json']);
  assert.ok(r.stdout.length > 0, `validate produced no JSON: ${r.stderr}`);
  return { ...JSON.parse(r.stdout), code: r.code };
}
const errorsFor = (f, id) => f.errors.filter((x) => x.rule === id);

test('R-MK2 errors when a described product reintroduces its own marketplace', () => {
  const ws = makeWorkspace({ products: ['graphpowers'] });
  try {
    const dir = join(ws.repo('graphpowers'), '.claude-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'marketplace.json'),
      `${JSON.stringify({ name: 'graphpowers-marketplace', owner: { name: 'Nextbridge' }, plugins: [] }, null, 2)}\n`, 'utf8');
    const hits = errorsFor(findings(ws), 'R-MK2');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /graphpowers-marketplace/);
    assert.match(hits[0].message, /canonical marketplace is "nextbridge"/);
  } finally {
    ws.cleanup();
  }
});

test('R-MK5 catches a plugin renamed in plugin.json but not in the manifest', () => {
  const ws = makeWorkspace({ products: ['code-comrades'] });
  try {
    patchJson(ws, 'code-comrades', '.claude-plugin/plugin.json', (p) => ({ ...p, name: 'code-comrades-v2' }));
    const hits = errorsFor(findings(ws), 'R-MK5');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /code-comrades-v2/);
  } finally {
    ws.cleanup();
  }
});

test('R-MK7 catches a skill added to the repository but not to the manifest', () => {
  const ws = makeWorkspace({ products: ['code-comrades'] });
  try {
    const dir = join(ws.repo('code-comrades'), 'skills', 'brand-new-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: brand-new-skill\ndescription: x\n---\n', 'utf8');
    const hits = errorsFor(findings(ws), 'R-MK7');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /skills/);
  } finally {
    ws.cleanup();
  }
});

test('R-MK7 catches hooks disappearing from a plugin that declares them', () => {
  const ws = makeWorkspace({ products: ['graphpowers'] });
  try {
    rmSync(join(ws.repo('graphpowers'), 'hooks'), { recursive: true, force: true });
    const hits = errorsFor(findings(ws), 'R-MK7');
    assert.ok(hits.some((h) => /hooks/.test(h.message)), JSON.stringify(hits));
  } finally {
    ws.cleanup();
  }
});

test('the compiled marketplace carries exactly the registry members', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const market = JSON.parse(readFixture(ws, '.claude-plugin/marketplace.json'));
    assert.equal(market.name, 'nextbridge');
    assert.deepEqual(market.plugins.map((p) => p.name).sort(), ['code-comrades', 'graphpowers']);
  } finally {
    ws.cleanup();
  }
});

// T5-note: the brief's original sixth test asserted that the compiled
// marketplace's plugin `version` tracks a bumped product-manifest version.
// That claim has no home to live in. There is no `version` field anywhere in
// product.v1 (schema.mjs and product.yaml carry none), and buildMarketplace
// (scripts/lib/build.mjs, comment near line 103) deliberately never emits a
// `version` for a plugin entry - "setting it pins the plugin, and plugin.json
// wins anyway (D1)". buildCatalog carries no product-level version either.
// A real `version` field DOES exist one layer down, inside each product's own
// .claude-plugin/plugin.json (code-comrades: 0.3.0, graphpowers: 0.3.1) - but
// projecting that into the marketplace is exactly the invariant assigned to
// Task 6 (plugin.json version bump -> zero ecosystem drift, because D1), not
// this task. Do not "fix" this by adding a version field to build.mjs or to
// the schema - that would be a product decision, not a hardening step, and it
// would recreate the exact pinning problem D1 exists to avoid.
//
// Retargeted to `license`: a field buildMarketplace genuinely emits
// (`license: doc.license`) and buildCatalog also carries through to the
// product entry. This proves the same underlying claim the original test
// wanted - that the compiled artifacts regenerate from a manifest edit rather
// than staying frozen - through a field that actually exists, and it is a
// different field from Task 3's `description.short` scenario: this is a new,
// independent claim about `license` propagating through both compiled
// artifacts, not a restatement of Task 3 under a new name.
test('the compiled marketplace and catalog track the product manifest\'s own fields, not a hardcoded value', () => {
  const ws = makeWorkspace();
  try {
    patchProduct(ws, 'graphpowers', '.nextbridge/product.yaml',
      (t) => t.replace(/^license:\s*MIT\s*$/m, 'license: Apache-2.0'));

    assert.equal(run(ws, ['scripts/sync.mjs', '--repos', '..']).code, 0);
    // No --repos: layer 3 (repository consistency) never runs. This is a
    // pure layer 1/2 + compile check - a licence edit confined to
    // .nextbridge/product.yaml must not trip any layer-1/2 rule on its own.
    assert.equal(run(ws, ['scripts/validate.mjs', '--json']).code, 0);
    assert.equal(run(ws, ['scripts/compile.mjs']).code, 0);

    const catalog = JSON.parse(readFixture(ws, 'catalog.json'));
    const market = JSON.parse(readFixture(ws, '.claude-plugin/marketplace.json'));

    assert.equal(catalog.products.find((p) => p.id === 'graphpowers').license, 'Apache-2.0');
    assert.equal(market.plugins.find((p) => p.name === 'graphpowers').license, 'Apache-2.0');
  } finally {
    ws.cleanup();
  }
});
