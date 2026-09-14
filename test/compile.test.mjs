import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paths, readYaml, readJson, loadManifests, stableStringify } from '../scripts/lib/io.mjs';
import { buildCatalog, buildMarketplace } from '../scripts/lib/build.mjs';

const registry = readYaml(paths.registry);
const taxonomy = readYaml(paths.taxonomy);
const manifests = loadManifests();
const clone = (v) => structuredClone(v);

/* The committed state IS the consolidated one: code-comrades and graphpowers
   both declare a plugin, both are members of the one marketplace. Tests that
   need a variant clone it and mutate the clone. */
function withConsolidatedMarketplace() {
  return { registry: clone(registry), manifests: clone(manifests) };
}

/** The pre-consolidation state: a marketplace with no members at all. */
function withEmptyMarketplace() {
  const reg = clone(registry);
  reg.marketplace.members = [];
  const mfs = clone(manifests);
  for (const entry of Object.values(mfs)) entry.doc.plugins = [];
  return { registry: reg, manifests: mfs };
}

/* ── The committed state ──────────────────────────────────────────────── */

test('the committed generated artifacts are up to date', () => {
  const catalog = stableStringify(buildCatalog({ registry, taxonomy, manifests }));
  const marketplace = stableStringify(buildMarketplace({ registry, manifests }));
  assert.equal(readFileSync(paths.catalog, 'utf8').replace(/\r\n/g, '\n'), catalog);
  assert.equal(readFileSync(paths.marketplace, 'utf8').replace(/\r\n/g, '\n'), marketplace);
});

test('compilation is deterministic', () => {
  const once = stableStringify(buildCatalog({ registry, taxonomy, manifests }));
  const twice = stableStringify(buildCatalog({ registry, taxonomy, manifests }));
  assert.equal(once, twice);
  assert.ok(!once.includes('generatedAt'), 'no timestamp may enter the output');
});

test('an empty marketplace is still a valid, complete marketplace document', () => {
  const { registry: reg, manifests: mfs } = withEmptyMarketplace();
  const m = buildMarketplace({ registry: reg, manifests: mfs });
  assert.equal(m.name, 'nextbridge');
  assert.equal(typeof m.owner.name, 'string');
  assert.deepEqual(m.plugins, []);
});

test('the committed marketplace carries exactly the two consolidated plugins', () => {
  const m = readJson(paths.marketplace);
  assert.equal(m.name, 'nextbridge');
  assert.deepEqual(m.plugins.map((p) => p.name), ['code-comrades', 'graphpowers']);
});

test('the catalog is useful with integrations and solutions empty', () => {
  const c = readJson(paths.catalog);
  assert.deepEqual(c.integrations, []);
  assert.deepEqual(c.solutions, []);
  assert.equal(c.products.length, 9);
  assert.equal(c.products.filter((p) => p.described).length, 9);
  assert.ok(Object.keys(c.capabilities).length > 30);
  assert.ok(Object.keys(c.families).length === 5);
});

test('the catalog describes all nine products and keeps the ecosystem-owned facts', () => {
  const c = readJson(paths.catalog);
  assert.equal(c.products.length, 9);
  assert.deepEqual(c.products.filter((p) => !p.described), []);
  for (const p of c.products) {
    assert.ok(p.repository && p.family, 'every product carries its ecosystem-owned facts');
    assert.ok(p.capabilities.core.length > 0, 'a described product claims at least one capability');
  }
});

/* An indexed-but-undescribed product still has to be a complete catalog row.
   Nothing is pending today, so the shape is proved against a synthetic one. */
test('an indexed product with no manifest still carries repository and family', () => {
  const reg = clone(registry);
  reg.products['package-pilot'].manifest_status = 'pending';
  const mfs = clone(manifests);
  delete mfs['package-pilot'];
  const c = buildCatalog({ registry: reg, taxonomy, manifests: mfs });
  const p = c.products.find((x) => x.id === 'package-pilot');
  assert.equal(p.described, false);
  assert.ok(p.repository && p.family);
  assert.equal(p.capabilities, undefined, 'an undescribed product claims nothing');
});

test('the catalog computes which products hold each capability', () => {
  const c = readJson(paths.catalog);
  assert.deepEqual(c.capabilities['context-selection'].products, ['graphpowers', 'repocode']);
  assert.deepEqual(c.capabilities['visual-schema-design'].products, ['block-builder']);
  assert.deepEqual(c.capabilities['code-generation'].products, ['block-builder', 'code-comrades']);
  assert.deepEqual(c.capabilities['loop-detection'].products, ['agent-loop-guard']);
  assert.deepEqual(c.capabilities['package-verification'].products, ['registry-guard']);
});

test('the taxonomy stores no product list of its own', () => {
  for (const cap of Object.values(taxonomy.capabilities)) {
    assert.equal(cap.products, undefined, 'the product list is computed, never stored');
  }
});

/* ── Marketplace generation, proved against the real plugin repositories ─ */

test('a consolidated marketplace uses the documented cross-repository github source', () => {
  const m = buildMarketplace({ registry, manifests });

  assert.equal(m.name, 'nextbridge');
  assert.equal(m.plugins.length, 2);

  const cc = m.plugins.find((p) => p.name === 'code-comrades');
  assert.deepEqual(cc.source, { source: 'github', repo: 'nextbridgehq/code-comrades' });
  assert.equal(cc.homepage, 'https://github.com/nextbridgehq/code-comrades#readme');
  assert.equal(cc.repository, 'https://github.com/nextbridgehq/code-comrades');
  assert.equal(cc.author.name, 'Nextbridge');

  const gp = m.plugins.find((p) => p.name === 'graphpowers');
  assert.deepEqual(gp.source, { source: 'github', repo: 'nextbridgehq/graphpowers' });
});

test('marketplace entries omit version, so plugin.json stays authoritative', () => {
  const { registry: reg, manifests: mfs } = withConsolidatedMarketplace();
  for (const p of buildMarketplace({ registry: reg, manifests: mfs }).plugins) {
    assert.equal(p.version, undefined);
    assert.equal(p.strict, undefined);
    assert.equal(p.skills, undefined);
    assert.equal(p.displayName, undefined);
  }
});

test('marketplace order follows registry membership, which is the curation decision', () => {
  const { registry: reg, manifests: mfs } = withConsolidatedMarketplace();
  reg.marketplace.members.reverse();
  const names = buildMarketplace({ registry: reg, manifests: mfs }).plugins.map((p) => p.name);
  assert.deepEqual(names, ['graphpowers', 'code-comrades']);
});

test('a plugin in a subdirectory uses the documented git-subdir source', () => {
  const { registry: reg, manifests: mfs } = withConsolidatedMarketplace();
  mfs.graphpowers.doc.plugins[0].path = './plugins/graphpowers';
  const gp = buildMarketplace({ registry: reg, manifests: mfs }).plugins.find((p) => p.name === 'graphpowers');
  assert.deepEqual(gp.source, {
    source: 'git-subdir', url: 'nextbridgehq/graphpowers', path: 'plugins/graphpowers',
  });
});

test('one product may contribute several plugins', () => {
  const { registry: reg, manifests: mfs } = withConsolidatedMarketplace();
  mfs.graphpowers.doc.plugins.push({
    name: 'graphpowers-ci', host: 'claude-code', path: './ci',
    manifest: 'ci/.claude-plugin/plugin.json', marketplace: 'nextbridge',
    components: { skills: 0 }, status: 'published',
  });
  reg.marketplace.members.push({ product: 'graphpowers', plugin: 'graphpowers-ci' });
  const m = buildMarketplace({ registry: reg, manifests: mfs });
  assert.equal(m.plugins.filter((p) => p.repository.endsWith('/graphpowers')).length, 2);
});

test('the marketplace distribution row is derived from plugins, not authored', () => {
  const { registry: reg, manifests: mfs } = withConsolidatedMarketplace();
  const c = buildCatalog({ registry: reg, taxonomy, manifests: mfs });
  const gp = c.products.find((p) => p.id === 'graphpowers');
  const row = gp.distribution.find((d) => d.channel === 'claude-code-marketplace');
  assert.deepEqual(row, { channel: 'claude-code-marketplace', marketplace: 'nextbridge', plugins: ['graphpowers'] });
});

test('a product with no plugins gets no marketplace distribution row', () => {
  const c = readJson(paths.catalog);
  for (const id of ['repocode', 'block-builder']) {
    const p = c.products.find((x) => x.id === id);
    assert.equal(p.distribution.some((d) => d.channel === 'claude-code-marketplace'), false);
  }
});

test('a deprecated plugin leaves the marketplace distribution row', () => {
  const { registry: reg, manifests: mfs } = withConsolidatedMarketplace();
  mfs.graphpowers.doc.plugins[0].status = 'deprecated';
  const c = buildCatalog({ registry: reg, taxonomy, manifests: mfs });
  const gp = c.products.find((p) => p.id === 'graphpowers');
  assert.equal(gp.distribution.some((d) => d.channel === 'claude-code-marketplace'), false);
});
