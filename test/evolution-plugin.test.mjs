import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { makeWorkspace, run, readFixture, writeFixture, patchJson } from './lib/fixture.mjs';

const editYaml = (ws, rel, mutate) => {
  const doc = yaml.load(readFixture(ws, rel));
  mutate(doc);
  writeFixture(ws, rel, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
};

function findings(ws) {
  const r = run(ws, ['scripts/validate.mjs', '--json']);
  assert.ok(r.stdout.length > 0, `validate produced no JSON: ${r.stderr}`);
  return { ...JSON.parse(r.stdout), code: r.code };
}
const errorsFor = (f, id) => f.errors.filter((x) => x.rule === id);

test('removing a plugin from a product removes it from the compiled marketplace', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    editYaml(ws, 'manifests/graphpowers.yaml', (d) => { d.plugins = []; });
    editYaml(ws, 'registry.yaml', (d) => {
      d.marketplace.members = d.marketplace.members.filter((m) => m.product !== 'graphpowers');
    });
    assert.equal(run(ws, ['scripts/compile.mjs']).code, 0);
    const market = JSON.parse(readFixture(ws, '.claude-plugin/marketplace.json'));
    assert.deepEqual(market.plugins.map((p) => p.name), ['code-comrades']);
  } finally {
    ws.cleanup();
  }
});

// Plan under-asserted this as "produced no error" (f.errors.length > 0). The
// real rule that fires is R-MK3's second direction (a marketplace member
// whose declared plugin no longer exists) - tightened here per the global
// constraint that rule ids and exit codes are the contract, not prose.
test('a registry member whose plugin no longer exists is an error, not an empty entry', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    editYaml(ws, 'manifests/graphpowers.yaml', (d) => { d.plugins = []; });
    const f = findings(ws);
    assert.equal(f.code, 2, JSON.stringify(f.errors));
    const hits = errorsFor(f, 'R-MK3');
    assert.equal(hits.length, 1, JSON.stringify(f.errors));
    assert.match(hits[0].message, /marketplace member "graphpowers\/graphpowers" does not resolve/);
  } finally {
    ws.cleanup();
  }
});

test('a product with no interfaces and no plugins is rejected by R-REF9', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    editYaml(ws, 'manifests/graphpowers.yaml', (d) => { d.plugins = []; d.interfaces = []; });
    editYaml(ws, 'registry.yaml', (d) => {
      d.marketplace.members = d.marketplace.members.filter((m) => m.product !== 'graphpowers');
    });
    const f = findings(ws);
    assert.equal(f.code, 2, JSON.stringify(f.errors));
    const hits = errorsFor(f, 'R-REF9');
    assert.equal(hits.length, 1, JSON.stringify(hits));
  } finally {
    ws.cleanup();
  }
});

test('a product with no interfaces but one plugin is valid — the Code Comrades shape', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const doc = yaml.load(readFixture(ws, 'manifests/code-comrades.yaml'));
    assert.deepEqual(doc.interfaces, [], 'code-comrades no longer has the empty-interfaces shape');
    assert.ok((doc.plugins ?? []).length >= 1);
    const f = findings(ws);
    assert.equal(f.code, 0, JSON.stringify(f.errors));
    assert.deepEqual(errorsFor(f, 'R-REF9'), []);
  } finally {
    ws.cleanup();
  }
});

test('two products cannot publish plugins with the same name', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    editYaml(ws, 'manifests/graphpowers.yaml', (d) => { d.plugins[0].name = 'code-comrades'; });
    editYaml(ws, 'registry.yaml', (d) => {
      for (const m of d.marketplace.members) if (m.product === 'graphpowers') m.plugin = 'code-comrades';
    });
    const f = findings(ws);
    assert.equal(f.code, 2);
    const hits = errorsFor(f, 'R-MK4');
    assert.equal(hits.length, 1, `expected exactly one R-MK4, got ${JSON.stringify(f.errors)}`);
    assert.match(hits[0].message, /plugin name "code-comrades" is already used by "(graphpowers|code-comrades)"/);
  } finally {
    ws.cleanup();
  }
});

// Plan hypothesis error, verified empirically (see task-6-report.md): the plan
// assumed compile.mjs would succeed with exit 0 and simply leave the new
// plugin out of the marketplace, treating R-MK3 as something only --repos /
// layer3 enforces. It is not - R-MK3 lives in layer2, which compile.mjs always
// runs once layer1 is clean (scripts/compile.mjs lines 34-40), no --repos
// required. A published claude-code plugin declared in a manifest without a
// matching registry.marketplace member makes R-MK3's first direction fire,
// and compile.mjs refuses to compile at all: exit 2, neither artifact
// written. That is a stronger, better invariant than the plan described (a
// silent no-op), so the test is corrected to assert the refusal rather than
// a quiet success.
//
// Also corrected: the plan's plugin object omits `marketplace`, which
// schema/product.v1.schema.json requires whenever host is "claude-code" (the
// plugin $def's allOf/then). Without it, layer1 fails first with R-SCHEMA
// and R-MK3 (a layer2 rule) never even runs - confirmed empirically by
// probing both variants directly. Adding `marketplace: 'nextbridge'` makes
// the manifest schema-valid so the test actually exercises the registry-
// membership invariant (R-MK3) it is named for, rather than a schema error.
test('adding a plugin requires a registry member before it reaches the marketplace', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const beforeCatalog = readFixture(ws, 'catalog.json');
    const beforeMarket = readFixture(ws, '.claude-plugin/marketplace.json');
    editYaml(ws, 'manifests/repocode.yaml', (d) => {
      d.plugins = [{
        name: 'repocode', host: 'claude-code', status: 'published',
        path: '.', manifest: '.claude-plugin/plugin.json', marketplace: 'nextbridge',
        components: { skills: 0, agents: 0, commands: 0, hooks: false, mcp: false },
      }];
    });
    const r = run(ws, ['scripts/compile.mjs']);
    assert.equal(r.code, 2, `expected compile.mjs to refuse; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /R-MK3/);
    assert.match(r.stderr, /repocode\/repocode/);
    assert.equal(readFixture(ws, 'catalog.json'), beforeCatalog, 'catalog.json must not be written on a refused compile');
    assert.equal(readFixture(ws, '.claude-plugin/marketplace.json'), beforeMarket, 'marketplace.json must not be written on a refused compile');
  } finally {
    ws.cleanup();
  }
});

// Test 7 (required, not in the original plan): bumping a plugin's own
// plugin.json version must produce zero ecosystem drift anywhere. product.v1
// has no version concept, and neither buildCatalog nor buildMarketplace
// (scripts/lib/build.mjs) ever reads plugin.json - the catalog's plugins[]
// comes from the manifest's own plugins array (no version field in that
// shape either), and the marketplace entry is built from registry.yaml
// membership plus the manifest's declared plugin. sync.mjs only ever reads
// product.yaml, never plugin.json, so the sync boundary doesn't see it
// either. This test proves that structural fact by following a real mutation
// through the full lifecycle rather than only asserting "no error is thrown".
test('bumping a plugin.json version produces zero ecosystem drift anywhere', () => {
  const ws = makeWorkspace();
  try {
    // 1. Premise: the fixture starts clean.
    const preSync = run(ws, ['scripts/sync.mjs', '--repos', '..', '--check']);
    assert.equal(preSync.code, 0, preSync.stdout + preSync.stderr);
    assert.match(preSync.stdout, /^0 change\(s\)\.$/m);

    const preValidate = findingsRepos(ws);
    assert.equal(preValidate.code, 0, JSON.stringify(preValidate.errors));
    assert.equal(preValidate.errors.length, 0);
    assert.equal(preValidate.warnings.length, 0);

    // 2. Mutate ONLY the plugin's own version, nothing else.
    const pluginJsonPath = join(ws.repo('graphpowers'), '.claude-plugin', 'plugin.json');
    const before = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
    assert.equal(before.version, '0.3.1', 'fixture premise: graphpowers plugin.json starts at 0.3.1');
    patchJson(ws, 'graphpowers', '.claude-plugin/plugin.json', (p) => ({ ...p, version: '0.3.2' }));

    // 3. sync --check stays clean: plugin.json is not part of the sync boundary.
    const postSync = run(ws, ['scripts/sync.mjs', '--repos', '..', '--check']);
    assert.equal(postSync.code, 0, postSync.stdout + postSync.stderr);
    assert.match(postSync.stdout, /^0 change\(s\)\.$/m);

    // 4. validate --repos .. (full layer 1+2+3) stays clean.
    const postValidate = findingsRepos(ws);
    assert.equal(postValidate.code, 0, JSON.stringify(postValidate.errors));
    assert.equal(postValidate.errors.length, 0);
    assert.equal(postValidate.warnings.length, 0);

    // 5. compile --check reports both artifacts unchanged - byte-identical
    //    to what is already on disk in the fixture.
    const compiled = run(ws, ['scripts/compile.mjs', '--check']);
    assert.equal(compiled.code, 0, compiled.stdout + compiled.stderr);
    assert.match(compiled.stdout, /unchanged {2}catalog\.json/);
    assert.match(compiled.stdout, /unchanged {2}\.claude-plugin\/marketplace\.json/);

    // 6. Direct content check: the bumped version string does not leak into
    //    either compiled artifact anywhere in its text.
    const catalogText = readFixture(ws, 'catalog.json');
    const marketText = readFixture(ws, '.claude-plugin/marketplace.json');
    assert.ok(!catalogText.includes('0.3.2'), 'catalog.json must not contain the bumped plugin version');
    assert.ok(!marketText.includes('0.3.2'), 'marketplace.json must not contain the bumped plugin version');
  } finally {
    ws.cleanup();
  }
});

function findingsRepos(ws) {
  const r = run(ws, ['scripts/validate.mjs', '--repos', '..', '--json']);
  assert.ok(r.stdout.length > 0, `validate produced no JSON: ${r.stderr}`);
  return { ...JSON.parse(r.stdout), code: r.code };
}
