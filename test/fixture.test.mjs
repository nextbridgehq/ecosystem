import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, run, readFixture, patchProduct, ALL_PRODUCTS, ECOSYSTEM_ROOT } from './lib/fixture.mjs';

test('a fixture workspace reproduces the real ecosystem exactly', () => {
  const ws = makeWorkspace();
  try {
    assert.equal(ALL_PRODUCTS.length, 9);
    for (const name of ALL_PRODUCTS) assert.ok(existsSync(ws.repo(name)), `missing ${name}`);
    assert.ok(existsSync(join(ws.eco, 'node_modules', 'js-yaml')), 'node_modules not linked');

    const validate = run(ws, ['scripts/validate.mjs', '--repos', '..']);
    assert.equal(validate.code, 0, validate.stdout + validate.stderr);
    assert.match(validate.stdout, /0 error\(s\), 0 warning\(s\), 1 skipped\./);

    const compile = run(ws, ['scripts/compile.mjs', '--check']);
    assert.equal(compile.code, 0, compile.stdout + compile.stderr);
    assert.match(compile.stdout, /unchanged {2}catalog\.json/);

    const sync = run(ws, ['scripts/sync.mjs', '--repos', '..', '--check']);
    assert.equal(sync.code, 0, sync.stdout + sync.stderr);
    assert.match(sync.stdout, /0 change\(s\)\./);
  } finally {
    ws.cleanup();
  }
});

test('the fixture catalog is byte-identical to the committed catalog', () => {
  const ws = makeWorkspace();
  try {
    assert.equal(run(ws, ['scripts/compile.mjs']).code, 0);
    const real = readFileSync(join(ECOSYSTEM_ROOT, 'catalog.json'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(readFixture(ws, 'catalog.json'), real);
  } finally {
    ws.cleanup();
  }
});

test('a fixture can be mutated without touching the real tree', () => {
  const ws = makeWorkspace({ products: ['graphpowers'] });
  const realBefore = readFileSync(join(ECOSYSTEM_ROOT, '..', 'graphpowers', '.nextbridge', 'product.yaml'), 'utf8');
  try {
    patchProduct(ws, 'graphpowers', '.nextbridge/product.yaml', (t) => `${t}\n# fixture mutation\n`);
    const after = readFileSync(join(ECOSYSTEM_ROOT, '..', 'graphpowers', '.nextbridge', 'product.yaml'), 'utf8');
    assert.equal(after, realBefore, 'the real product.yaml was modified');
  } finally {
    ws.cleanup();
  }
});
