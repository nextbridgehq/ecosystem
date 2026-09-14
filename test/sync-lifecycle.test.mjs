import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, run, readFixture, patchProduct, gitInit, gitDiffStat } from './lib/fixture.mjs';

const MARKER = 'now with live drift telemetry';

const OLD_SHORT = `  short: >-
    Bridges a Graphify knowledge graph into agent development workflows:
    blast radius, context packs, drift, and graph-first debugging.`;

const NEW_SHORT = `  short: >-
    Bridges a Graphify knowledge graph into agent development workflows,
    ${MARKER} for graph-first debugging.`;

/* The full lifecycle, exactly as the sync workflow runs it:
     product change -> sync detects -> reviewable diff -> validate -> compile */
test('a product description change flows through sync, validation and compilation', () => {
  const ws = makeWorkspace();
  gitInit(ws.eco);
  try {
    assert.equal(gitDiffStat(ws.eco), '', 'fixture had an unexpected diff right after gitInit');

    // 1. The product changes on its own.
    patchProduct(ws, 'graphpowers', '.nextbridge/product.yaml', (t) => {
      assert.ok(t.includes(OLD_SHORT), 'description.short block did not match the expected fixture text');
      return t.replace(OLD_SHORT, NEW_SHORT);
    });

    // 2. sync --check detects it and exits 2 without writing.
    const detected = run(ws, ['scripts/sync.mjs', '--repos', '..', '--check']);
    assert.equal(detected.code, 2, detected.stdout + detected.stderr);
    assert.match(detected.stdout, /DRIFT {6}graphpowers/);
    assert.doesNotMatch(readFixture(ws, 'manifests/graphpowers.yaml'), new RegExp(MARKER));

    // 3. R-SYNC1 makes the stale snapshot an ecosystem error, not a silent pass.
    const stale = run(ws, ['scripts/validate.mjs', '--repos', '..', '--json']);
    assert.equal(stale.code, 2);
    const staleFindings = JSON.parse(stale.stdout).errors;
    assert.equal(staleFindings.length, 1, `expected exactly one error, got ${JSON.stringify(staleFindings)}`);
    assert.equal(staleFindings[0].rule, 'R-SYNC1');
    assert.equal(staleFindings[0].subject, 'product:graphpowers');

    // 4. sync writes the snapshot.
    const synced = run(ws, ['scripts/sync.mjs', '--repos', '..']);
    assert.equal(synced.code, 0, synced.stdout + synced.stderr);
    assert.match(synced.stdout, /updated {4}graphpowers/);
    assert.match(readFixture(ws, 'manifests/graphpowers.yaml'), new RegExp(MARKER));

    // 5. The ecosystem validates again.
    const revalidated = run(ws, ['scripts/validate.mjs', '--repos', '..']);
    assert.equal(revalidated.code, 0, revalidated.stdout + revalidated.stderr);

    // 6. compile --check now reports drift in the generated artifacts.
    assert.equal(run(ws, ['scripts/compile.mjs', '--check']).code, 2);
    assert.equal(run(ws, ['scripts/compile.mjs']).code, 0);
    assert.match(readFixture(ws, '.claude-plugin/marketplace.json'), new RegExp(MARKER));
    assert.match(readFixture(ws, 'catalog.json'), new RegExp(MARKER));

    // 7. What a reviewer would see: a diff confined to the snapshot and the artifacts.
    const changed = gitDiffStat(ws.eco);
    assert.match(changed, /manifests\/graphpowers\.yaml/);
    assert.match(changed, /catalog\.json/);
    assert.match(changed, /marketplace\.json/);
    assert.doesNotMatch(changed, /registry\.yaml/);
    assert.doesNotMatch(changed, /schema\//);
  } finally {
    ws.cleanup();
  }
});

test('sync removes an orphan snapshot when a product goes back to pending', () => {
  const ws = makeWorkspace();
  try {
    const registry = readFixture(ws, 'registry.yaml');
    const pending = registry.replace(
      /(^ {2}registry-guard:\n(?: {4}.*\n)*?) {4}manifest_status: present$/m,
      '$1    manifest_status: pending');
    assert.notEqual(pending, registry, 'registry-guard manifest_status was not rewritten');
    writeFileSync(join(ws.eco, 'registry.yaml'), pending, 'utf8');

    const snapshot = join(ws.eco, 'manifests', 'registry-guard.yaml');
    assert.equal(existsSync(snapshot), true, 'the registry-guard snapshot must exist before sync removes it');

    const r = run(ws, ['scripts/sync.mjs', '--repos', '..']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /removed {4}registry-guard\.yaml/);
    assert.equal(existsSync(snapshot), false, 'sync reported the snapshot removed but it is still on disk');
  } finally {
    ws.cleanup();
  }
});

test('a product whose product.yaml disappears is a hard sync failure, not a silent skip', () => {
  const ws = makeWorkspace();
  try {
    rmSync(join(ws.repo('registry-guard'), '.nextbridge', 'product.yaml'));
    const r = run(ws, ['scripts/sync.mjs', '--repos', '..', '--check']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /registry-guard: missing/);
  } finally {
    ws.cleanup();
  }
});
