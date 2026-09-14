import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { paths, readYaml, loadManifests } from '../scripts/lib/io.mjs';
import { layer1, layer2, layer3, ERROR, WARN } from '../scripts/lib/rules.mjs';

/* The nine product repositories sit beside the ecosystem repository in this
   workspace. Layer 3 tests run against the real ones, so a rule that claims to
   catch a Phase 0 audit defect is proved against the repository that has it. */
const REPOS = resolve(paths.registry, '..', '..');

const registry = readYaml(paths.registry);
const taxonomy = readYaml(paths.taxonomy);
const manifests = loadManifests();

const clone = (v) => structuredClone(v);
const rules = (findings, rule) => findings.filter((f) => f.rule === rule);
const errorsOf = (findings) => findings.filter((f) => f.severity === ERROR);

/** A manifest shaped like a real one, for mutation in negative tests. */
const baseManifest = () => clone(manifests.repocode.doc);

const withManifests = (entries) =>
  Object.fromEntries(entries.map((doc) => [doc.id, { file: `${doc.id}.yaml`, doc }]));

/* ── The committed state ──────────────────────────────────────────────── */

test('the committed ecosystem passes layers 1 and 2 with no errors', () => {
  const findings = [...layer1({ registry, taxonomy, manifests }), ...layer2({ registry, taxonomy, manifests })];
  assert.deepEqual(errorsOf(findings), []);
});

test('the committed ecosystem passes layer 3 against the real repositories', () => {
  const findings = layer3({ registry, manifests, reposDir: REPOS });
  assert.deepEqual(errorsOf(findings), []);
});

test('all nine products are indexed and all nine are described', () => {
  const ids = Object.keys(registry.products);
  assert.equal(ids.length, 9);
  assert.deepEqual(ids.filter((id) => registry.products[id].manifest_status !== 'present'), []);
  assert.deepEqual(Object.keys(manifests).sort(), ids.slice().sort());
});

test('the canonical marketplace has exactly one member per published plugin', () => {
  const declared = Object.entries(manifests).flatMap(([id, { doc }]) =>
    (doc.plugins ?? []).filter((p) => p.status === 'published' && p.host === 'claude-code')
      .map((p) => `${id}/${p.name}`));
  const members = registry.marketplace.members.map((m) => `${m.product}/${m.plugin}`);
  assert.deepEqual(members.slice().sort(), declared.slice().sort());
});

test('integrations and solutions are empty, and that is a valid ecosystem', () => {
  assert.deepEqual(registry.integrations, []);
  assert.deepEqual(registry.solutions, []);
  const findings = layer2({ registry, taxonomy, manifests });
  assert.deepEqual(errorsOf(findings), []);
});

/* ── Layer 1: structure ───────────────────────────────────────────────── */

test('R-SCHEMA rejects a manifest missing a required field', () => {
  const doc = baseManifest();
  delete doc.problem;
  const findings = layer1({ registry, taxonomy, manifests: withManifests([doc]) });
  assert.ok(rules(findings, 'R-SCHEMA').length > 0);
});

test('R-SCHEMA rejects an unknown interface type', () => {
  const doc = baseManifest();
  doc.interfaces = [{ type: 'vscode-extension' }];
  assert.ok(rules(layer1({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-SCHEMA').length > 0);
});

test('R-SCHEMA rejects a mistyped interface: mcp without a transport', () => {
  const doc = baseManifest();
  doc.interfaces = [{ type: 'mcp', command: 'npx' }];
  assert.ok(rules(layer1({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-SCHEMA').length > 0);
});

test('a Claude plugin cannot be declared as an interface (structural anti-duplication)', () => {
  const doc = baseManifest();
  doc.interfaces = [{ type: 'claude-code-plugin', command: 'x' }];
  assert.ok(rules(layer1({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-SCHEMA').length > 0);
});

test('a claude-code-marketplace distribution row cannot be hand-authored (R-DIST1)', () => {
  const doc = baseManifest();
  doc.distribution = [{ channel: 'claude-code-marketplace', marketplace: 'nextbridge' }];
  assert.ok(rules(layer1({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-SCHEMA').length > 0);
});

test('a claude-code plugin without a marketplace field is rejected', () => {
  const doc = baseManifest();
  doc.plugins = [{
    name: 'thing', host: 'claude-code', path: '.', manifest: '.claude-plugin/plugin.json',
    components: { skills: 1 }, status: 'published',
  }];
  assert.ok(rules(layer1({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-SCHEMA').length > 0);
});

/* ── Layer 2: referential ─────────────────────────────────────────────── */

test('R-REF1 catches a capability that is not in the taxonomy', () => {
  const doc = baseManifest();
  doc.capabilities.core = ['repository-understanding'];
  const findings = layer2({ registry, taxonomy, manifests: withManifests([doc]) });
  assert.equal(rules(findings, 'R-REF1').length, 1);
});

test('R-REF2 catches a registry entry claiming a manifest that is not synced', () => {
  const mfs = clone(manifests);
  delete mfs['project-charter'];
  const findings = layer2({ registry, taxonomy, manifests: mfs });
  assert.equal(rules(findings, 'R-REF2').length, 1);
});

test('R-REF2 catches a synced manifest whose registry entry is still pending', () => {
  const reg = clone(registry);
  reg.products.repocode.manifest_status = 'pending';
  assert.equal(rules(layer2({ registry: reg, taxonomy, manifests }), 'R-REF2').length, 1);
});

test('R-REF3 catches an integration target that is neither known nor external', () => {
  const doc = baseManifest();
  doc.integrations = [{ to: 'some-other-tool', type: 'config-import', interface: 'file', status: 'supported' }];
  assert.equal(rules(layer2({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-REF3').length, 1);
});

test('R-REF4 catches status "verified" with no verification block', () => {
  const doc = baseManifest();
  doc.integrations = [{ to: 'repomix', external: true, type: 'config-import', interface: 'file', status: 'verified' }];
  assert.equal(rules(layer2({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-REF4').length, 1);
});

test('R-REF5 makes maturity "integrated" unreachable without a verified internal integration', () => {
  const doc = baseManifest();
  doc.maturity = 'integrated';
  assert.equal(rules(layer2({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-REF5').length, 1);
});

test('R-REF5 accepts "integrated" once a verified internal integration exists', () => {
  const doc = baseManifest();
  doc.maturity = 'integrated';
  doc.integrations = [{
    to: 'block-builder', type: 'context-provider', interface: 'cli', status: 'verified',
    verification: { automated: true, workflow: '.github/workflows/integration.yml' },
  }];
  assert.equal(rules(layer2({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-REF5').length, 0);
});

test('R-REF6 catches a solution reference that does not resolve', () => {
  const reg = clone(registry);
  reg.solutions = [{ $ref: 'solutions/dependency-risk-check.yaml' }];
  assert.equal(rules(layer2({ registry: reg, taxonomy, manifests }), 'R-REF6').length, 1);
});

test('R-REF7 catches an unknown family', () => {
  const reg = clone(registry);
  reg.products.repocode.family = 'ai-engineering';
  assert.equal(rules(layer2({ registry: reg, taxonomy, manifests }), 'R-REF7').length, 1);
});

test('every capability in the taxonomy is claimed by at least one product', () => {
  assert.deepEqual(rules(layer2({ registry, taxonomy, manifests }), 'R-REF8'), []);
});

/* With all nine described, R-REF8 is an error, not a warning: a capability
   nothing claims is now dead vocabulary rather than an unwritten manifest. */
test('R-REF8 is an error once every product is described', () => {
  const tax = clone(taxonomy);
  tax.capabilities['nothing-claims-this'] = { name: 'Orphan', category: 'cross-cutting' };
  const hits = rules(layer2({ registry, taxonomy: tax, manifests }), 'R-REF8');
  assert.deepEqual(hits.map((h) => h.subject), ['capability:nothing-claims-this']);
  assert.equal(hits[0].severity, ERROR);
});

test('R-REF8 falls back to a warning while any product is still pending', () => {
  const reg = clone(registry);
  reg.products['package-pilot'].manifest_status = 'pending';
  const mfs = clone(manifests);
  delete mfs['package-pilot'];
  const tax = clone(taxonomy);
  tax.capabilities['nothing-claims-this'] = { name: 'Orphan', category: 'cross-cutting' };
  const hits = rules(layer2({ registry: reg, taxonomy: tax, manifests: mfs }), 'R-REF8');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.severity === WARN));
});

test('a plugin-only product may have interfaces: [] (O1, decision c)', () => {
  const doc = baseManifest();
  doc.interfaces = [];
  doc.plugins = [{
    name: 'plugin-only-product', host: 'claude-code', path: '.',
    manifest: '.claude-plugin/plugin.json', marketplace: 'nextbridge',
    components: { skills: 1 }, status: 'published',
  }];
  const only = withManifests([doc]);
  assert.deepEqual(errorsOf(layer1({ registry, taxonomy, manifests: only })), []);
  assert.deepEqual(rules(layer2({ registry, taxonomy, manifests: only }), 'R-REF9'), []);
});

test('R-REF9 refuses a product with neither an interface nor a plugin', () => {
  const doc = baseManifest();
  doc.interfaces = [];
  doc.plugins = [];
  const findings = rules(layer2({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-REF9');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, ERROR);
});

test('R-REF9 refuses a product with interfaces: [] and no plugins key at all', () => {
  const doc = baseManifest();
  doc.interfaces = [];
  delete doc.plugins;
  assert.equal(rules(layer2({ registry, taxonomy, manifests: withManifests([doc]) }), 'R-REF9').length, 1);
});

/* ── Layer 2: marketplace anti-fragmentation ──────────────────────────── */

const pluginManifest = (over = {}) => ({
  ...baseManifest(),
  id: 'code-comrades',
  plugins: [{
    name: 'code-comrades', host: 'claude-code', path: '.',
    manifest: '.claude-plugin/plugin.json', marketplace: 'nextbridge',
    components: { skills: 10, agents: 1, commands: 0, hooks: false, mcp: false },
    status: 'published',
    ...over,
  }],
});

test('R-MK6 refuses a product that declares its own marketplace', () => {
  const doc = pluginManifest({ marketplace: 'code-comrades-marketplace' });
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  assert.equal(rules(layer2({ registry: reg, taxonomy, manifests: withManifests([doc]) }), 'R-MK6').length, 1);
});

test('R-MK4 refuses two products claiming the same plugin name', () => {
  const a = pluginManifest();
  const b = { ...pluginManifest(), id: 'graphpowers' };
  const findings = layer2({ registry, taxonomy, manifests: withManifests([a, b]) });
  assert.equal(rules(findings, 'R-MK4').length, 1);
});

test('R-MK3 catches a published plugin missing from marketplace membership', () => {
  const doc = pluginManifest();
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const findings = layer2({ registry: reg, taxonomy, manifests: withManifests([doc]) });
  assert.equal(rules(findings, 'R-MK3').length, 1);
});

test('R-MK3 catches a marketplace member with no matching plugin', () => {
  const reg = clone(registry);
  reg.marketplace.members = [{ product: 'graphpowers', plugin: 'graphpowers' }];
  assert.equal(rules(layer2({ registry: reg, taxonomy, manifests }), 'R-MK3').length, 1);
});

test('R-MK3 is satisfied when manifest and membership agree', () => {
  const doc = pluginManifest();
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  reg.marketplace.members = [{ product: 'code-comrades', plugin: 'code-comrades' }];
  const findings = layer2({ registry: reg, taxonomy, manifests: withManifests([doc]) });
  assert.equal(rules(findings, 'R-MK3').length, 0);
});

/* ── Layer 3: repository consistency, against the real repositories ───── */

/* project-charter's pyproject.toml pointed at saadat-dev; Phase 1.5 corrected it
   to nextbridgehq. The rule is proved by claiming the wrong owner for a real
   repository, which is exactly the shape of the defect it caught. */
test('R-META1 catches a repository URL mismatch (the project-charter defect)', () => {
  const reg = clone(registry);
  reg.products['project-charter'].repository = 'saadat-dev/project-charter';
  const doc = { ...baseManifest(), id: 'project-charter', distribution: [] };
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: REPOS });
  const hits = rules(findings, 'R-META1');
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
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: REPOS });
  const hits = rules(findings, 'R-META2');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /"private": true/);
});

/* code-comrades had this gap and now has .github/workflows/tests.yml.
   edge-compat-check still has no workflow at all, so the rule keeps a real
   repository to prove itself against. */
test('R-META5 catches maturity "stable" in a repository with no CI (edge-compat-check)', () => {
  const reg = clone(registry);
  reg.products['edge-compat-check'].manifest_status = 'present';
  const doc = { ...baseManifest(), id: 'edge-compat-check', maturity: 'stable' };
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: REPOS });
  assert.equal(rules(findings, 'R-META5').length, 1);
});

test('R-META5 accepts "stable" now that code-comrades runs CI', () => {
  const findings = layer3({ registry, manifests, reposDir: REPOS });
  assert.deepEqual(rules(findings, 'R-META5').filter((f) => f.severity === ERROR), []);
});

test('R-META4 catches a declared Node floor the repository does not support', () => {
  const reg = clone(registry);
  const doc = baseManifest();
  doc.runtime.node = '>=18';
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: REPOS });
  // G1: strict per-package mode reports one finding per declared npm package,
  // no any-of collapsing. repocode declares three (cli, core, mcp), and all
  // three package.json files independently pin engines.node >=20.0.0, so a
  // >=18 floor produces three independent R-META4 errors, not one.
  assert.equal(rules(findings, 'R-META4').length, 3);
});

/* No real repository ships its own marketplace any more: Phase 1.5 consolidation
   deleted both. The rule is therefore proved against a throwaway repository that
   has the defect, plus a standing assertion that no real one does. */
const strayMarketplaceRepo = (id) => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-mk2-'));
  mkdirSync(join(dir, id, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, id, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: `${id}-marketplace`, owner: { name: 'Nextbridge' }, plugins: [] }));
  return dir;
};

test('no product repository ships a competing marketplace any more', () => {
  assert.deepEqual(rules(layer3({ registry, manifests, reposDir: REPOS }), 'R-MK2'), []);
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
    const findings = layer3({
      registry, manifests: withManifests([pluginManifest()]), reposDir: dir,
    });
    const hits = rules(findings, 'R-MK2').filter((h) => h.subject === 'product:code-comrades');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, ERROR);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── Layer 3: the plugin model, exercised against the real plugin repos ─
   Neither Phase 1 product ships a plugin, so the plugin schema is proved here
   against code-comrades and graphpowers as fixtures. No manifest is written
   into either repository; that is Phase 1.5. */

test('R-MK5 and R-MK7 accept a correct declaration of the real code-comrades plugin', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const findings = layer3({
    registry: reg, manifests: withManifests([pluginManifest()]), reposDir: REPOS,
  });
  assert.deepEqual(rules(findings, 'R-MK5'), []);
  assert.deepEqual(rules(findings, 'R-MK7'), []);
});

test('R-MK7 catches a component count that does not match the repository', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const doc = pluginManifest({ components: { skills: 3, agents: 1, hooks: false, mcp: false } });
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: REPOS });
  const hits = rules(findings, 'R-MK7');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /declares 3 skills but the repository has 10/);
});

test('R-MK7 accepts the real graphpowers plugin: 11 skills, hooks, no agents', () => {
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
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: REPOS });
  assert.deepEqual(rules(findings, 'R-MK7'), []);
  assert.deepEqual(rules(findings, 'R-MK5'), []);
});

test('R-MK5 catches a plugin name that disagrees with its plugin.json', () => {
  const reg = clone(registry);
  reg.products['code-comrades'].manifest_status = 'present';
  const doc = pluginManifest({ name: 'comrades' });
  const findings = layer3({ registry: reg, manifests: withManifests([doc]), reposDir: REPOS });
  assert.equal(rules(findings, 'R-MK5').length, 1);
});
