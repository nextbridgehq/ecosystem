import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, run, readFixture, writeFixture, ECOSYSTEM_ROOT } from './lib/fixture.mjs';

const committed = (rel) => readFileSync(join(ECOSYSTEM_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('compiling twice from a clean checkout is byte-identical', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    assert.equal(run(ws, ['scripts/compile.mjs']).code, 0);
    const first = { catalog: readFixture(ws, 'catalog.json'), market: readFixture(ws, '.claude-plugin/marketplace.json') };
    assert.equal(run(ws, ['scripts/compile.mjs']).code, 0);
    assert.equal(readFixture(ws, 'catalog.json'), first.catalog);
    assert.equal(readFixture(ws, '.claude-plugin/marketplace.json'), first.market);
  } finally {
    ws.cleanup();
  }
});

test('a clean checkout reproduces the committed artifacts', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    assert.equal(run(ws, ['scripts/compile.mjs']).code, 0);
    assert.equal(readFixture(ws, 'catalog.json'), committed('catalog.json'));
    assert.equal(readFixture(ws, '.claude-plugin/marketplace.json'), committed('.claude-plugin/marketplace.json'));
  } finally {
    ws.cleanup();
  }
});

test('a hand-edited catalog.json is rejected with exit code 2', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'catalog.json', `${readFixture(ws, 'catalog.json')}\n`);
    const r = run(ws, ['scripts/compile.mjs', '--check']);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /DRIFT {6}catalog\.json/);
    assert.match(r.stderr, /Run `node scripts\/compile\.mjs`/);
  } finally {
    ws.cleanup();
  }
});

test('a hand-edited marketplace.json is rejected with exit code 2', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const market = JSON.parse(readFixture(ws, '.claude-plugin/marketplace.json'));
    market.plugins[0].description = 'hand edited';
    writeFixture(ws, '.claude-plugin/marketplace.json', `${JSON.stringify(market, null, 2)}\n`);
    const r = run(ws, ['scripts/compile.mjs', '--check']);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /DRIFT {6}\.claude-plugin\/marketplace\.json/);
  } finally {
    ws.cleanup();
  }
});

test('validate without --repos skips layer 3 rather than passing it', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    const r = run(ws, ['scripts/validate.mjs', '--json']);
    assert.equal(r.code, 0);
    const { skipped } = JSON.parse(r.stdout);
    assert.ok(skipped.some((f) => f.rule === 'R-REPO'), 'layer 3 was not reported as skipped');
  } finally {
    ws.cleanup();
  }
});

test('compile refuses to write when validation fails', () => {
  // registry.yaml never lists capability references (those live only in
  // manifests/*.yaml and taxonomy/capabilities.yaml), so there is no
  // "    - graph" style line to break here. Instead break a cross-reference
  // that does live in registry.yaml: a product's family. R-REF7 requires
  // every product.family to name a family declared under registry.yaml's
  // own families: block, so pointing one at a family that does not exist is
  // a real, minimal validation failure entirely within this file.
  const ws = makeWorkspace({ products: [] });
  try {
    const before = readFixture(ws, 'catalog.json');
    const registry = readFixture(ws, 'registry.yaml');
    const firstFamily = registry.match(/^ +family: ([a-z][a-z0-9-]*)$/m);
    assert.ok(firstFamily, 'no product family reference found to break');
    writeFixture(ws, 'registry.yaml', registry.replace(firstFamily[0], firstFamily[0].replace(firstFamily[1], 'not-a-real-family')));
    const r = run(ws, ['scripts/compile.mjs']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /refusing to compile/);
    assert.match(r.stderr, /R-REF7/);
    assert.equal(readFixture(ws, 'catalog.json'), before, 'catalog.json was written despite validation failing');
  } finally {
    ws.cleanup();
  }
});
