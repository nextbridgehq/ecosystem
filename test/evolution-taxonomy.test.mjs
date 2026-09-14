import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { makeWorkspace, run, readFixture, writeFixture } from './lib/fixture.mjs';

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

const capabilityIds = (ws) =>
  Object.keys(yaml.load(readFixture(ws, 'taxonomy/capabilities.yaml')).capabilities);

test('baseline taxonomy is clean: 42 capabilities, R-TAX1/R-REF1/R-REF8 all empty', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    assert.equal(capabilityIds(ws).length, 42);
    const f = findings(ws);
    assert.equal(f.code, 0, JSON.stringify(f.errors));
    assert.deepEqual(errorsFor(f, 'R-TAX1'), []);
    assert.deepEqual(errorsFor(f, 'R-REF1'), []);
    assert.deepEqual(errorsFor(f, 'R-REF8'), []);
  } finally {
    ws.cleanup();
  }
});

// Plan hypothesis error, corrected per the controller's pre-flight
// investigation: R-REF8 escalates to ERROR (not a tolerated no-op) once no
// product in registry.yaml is manifest_status "pending" — which is this
// ecosystem's real, current state (all 9 products are "present"). Adding a
// taxonomy capability nobody references is therefore invalid, not "the
// taxonomy may lead" as the plan assumed.
test('adding an unreferenced capability is an R-REF8 error, not tolerated', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    editYaml(ws, 'taxonomy/capabilities.yaml', (d) => {
      d.capabilities['phase-two-probe'] = { name: 'Phase Two Probe', category: 'cross-cutting' };
    });
    const f = findings(ws);
    assert.equal(f.code, 2, JSON.stringify(f.errors));
    const hits = errorsFor(f, 'R-REF8');
    assert.equal(hits.length, 1, JSON.stringify(f.errors));
    assert.equal(hits[0].subject, 'capability:phase-two-probe');
    assert.match(hits[0].message, /orphaned: no product claims this capability/);
  } finally {
    ws.cleanup();
  }
});

// Paired negative for the above: the same addition is legitimate once some
// product actually claims the new capability.
test('adding a capability AND referencing it from a manifest is clean', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    editYaml(ws, 'taxonomy/capabilities.yaml', (d) => {
      d.capabilities['phase-two-probe'] = { name: 'Phase Two Probe', category: 'cross-cutting' };
    });
    editYaml(ws, 'manifests/graphpowers.yaml', (d) => {
      d.capabilities.secondary.push('phase-two-probe');
    });
    const f = findings(ws);
    assert.equal(f.code, 0, JSON.stringify(f.errors));
    assert.deepEqual(errorsFor(f, 'R-REF8'), []);
    assert.deepEqual(errorsFor(f, 'R-REF1'), []);
  } finally {
    ws.cleanup();
  }
});

// Plan hypothesis error, corrected: the scenario ("a product manifest points
// at a taxonomy id that no longer exists") is R-REF1's job (layer2, cross-
// artifact reference check), not R-TAX1's (which only checks a taxonomy
// capability's own category field against known categories - see
// scripts/lib/rules.mjs lines 62-78).
test('removing a capability a product still declares is an R-REF1 error', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const doc = yaml.load(readFixture(ws, 'manifests/graphpowers.yaml'));
    const victim = doc.capabilities.core[0];
    assert.equal(victim, 'graph-impact-analysis', 'fixture premise: graphpowers core[0]');

    editYaml(ws, 'taxonomy/capabilities.yaml', (d) => {
      delete d.capabilities[victim];
    });
    const f = findings(ws);
    assert.equal(f.code, 2, JSON.stringify(f.errors));
    const hits = errorsFor(f, 'R-REF1');
    assert.equal(hits.length, 1, JSON.stringify(f.errors));
    assert.equal(hits[0].subject, 'product:graphpowers');
    assert.match(hits[0].message, new RegExp(`capability "${victim}" is not in the taxonomy`));
  } finally {
    ws.cleanup();
  }
});

test('renaming a capability id without migrating the manifest reference is an R-REF1 error', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const doc = yaml.load(readFixture(ws, 'manifests/code-comrades.yaml'));
    const victim = doc.capabilities.core[0];
    assert.equal(victim, 'batch-file-processing', 'fixture premise: code-comrades core[0]');

    editYaml(ws, 'taxonomy/capabilities.yaml', (d) => {
      const entry = d.capabilities[victim];
      delete d.capabilities[victim];
      d.capabilities[`${victim}-renamed`] = entry;
    });
    // Manifest is deliberately left untouched - this is the "unmigrated" case.
    const f = findings(ws);
    assert.equal(f.code, 2, JSON.stringify(f.errors));
    const hits = errorsFor(f, 'R-REF1');
    assert.equal(hits.length, 1, JSON.stringify(f.errors));
    assert.equal(hits[0].subject, 'product:code-comrades');
    assert.match(hits[0].message, new RegExp(`capability "${victim}" is not in the taxonomy`));
  } finally {
    ws.cleanup();
  }
});

test('a capability rename migrated in both places validates and recompiles, and the renamed id reaches catalog.json', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const doc = yaml.load(readFixture(ws, 'manifests/code-comrades.yaml'));
    const victim = doc.capabilities.core[0];
    const renamed = `${victim}-renamed`;

    editYaml(ws, 'taxonomy/capabilities.yaml', (d) => {
      const entry = d.capabilities[victim];
      delete d.capabilities[victim];
      d.capabilities[renamed] = entry;
    });
    editYaml(ws, 'manifests/code-comrades.yaml', (d) => {
      d.capabilities.core = d.capabilities.core.map((c) => (c === victim ? renamed : c));
    });

    const f = findings(ws);
    assert.equal(f.code, 0, JSON.stringify(f.errors));
    assert.deepEqual(errorsFor(f, 'R-REF1'), []);
    assert.deepEqual(errorsFor(f, 'R-TAX1'), []);
    assert.deepEqual(errorsFor(f, 'R-REF8'), []);

    const compiled = run(ws, ['scripts/compile.mjs']);
    assert.equal(compiled.code, 0, compiled.stdout + compiled.stderr);

    const catalog = JSON.parse(readFixture(ws, 'catalog.json'));
    const codeComrades = catalog.products.find((p) => p.id === 'code-comrades');
    assert.ok(codeComrades, 'code-comrades must be present in catalog.json');
    const ids = [...codeComrades.capabilities.core, ...codeComrades.capabilities.secondary].map((c) => c.id);
    assert.ok(ids.includes(renamed), `expected "${renamed}" in code-comrades' compiled capabilities, got ${JSON.stringify(ids)}`);
    assert.ok(!ids.includes(victim), `old id "${victim}" must not survive the migrated rename`);
  } finally {
    ws.cleanup();
  }
});

// Controller-recommended addition (not from the plan): R-TAX1 is otherwise
// only ever asserted empty in this file. This proves it actually fires.
test('R-TAX1 fires when a capability points at an unknown category', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const doc = yaml.load(readFixture(ws, 'taxonomy/capabilities.yaml'));
    const [victim] = Object.keys(doc.capabilities);

    editYaml(ws, 'taxonomy/capabilities.yaml', (d) => {
      d.capabilities[victim].category = 'not-a-real-category';
    });
    const f = findings(ws);
    assert.equal(f.code, 2, JSON.stringify(f.errors));
    const hits = errorsFor(f, 'R-TAX1');
    assert.equal(hits.length, 1, JSON.stringify(f.errors));
    assert.equal(hits[0].subject, `capability:${victim}`);
    assert.match(hits[0].message, /unknown category "not-a-real-category"/);
  } finally {
    ws.cleanup();
  }
});
