import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, run, readFixture, writeFixture, ECOSYSTEM_ROOT } from './lib/fixture.mjs';

/* ── Exit codes are the API ───────────────────────────────────────────── */

test('exit code 0 means clean', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    assert.equal(run(ws, ['scripts/validate.mjs']).code, 0);
  } finally { ws.cleanup(); }
});

test('exit code 1 means usage or internal error, never a validation failure', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    assert.equal(run(ws, ['scripts/sync.mjs']).code, 1);
    assert.match(run(ws, ['scripts/sync.mjs']).stderr, /usage:/);

    writeFixture(ws, 'registry.yaml', 'this: is: not: valid: yaml:\n');
    const broken = run(ws, ['scripts/validate.mjs']);
    assert.equal(broken.code, 1, broken.stdout + broken.stderr);
    assert.match(broken.stderr, /^validate: /m);
  } finally { ws.cleanup(); }
});

test('exit code 2 means validation errors or drift', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'catalog.json', `${readFixture(ws, 'catalog.json')}\n`);
    assert.equal(run(ws, ['scripts/compile.mjs', '--check']).code, 2);
  } finally { ws.cleanup(); }
});

test('a manifest whose id does not match its filename is a schema error', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'manifests/misnamed.yaml', readFixture(ws, 'manifests/graphpowers.yaml'));
    const r = run(ws, ['scripts/validate.mjs', '--json']);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    const hits = JSON.parse(r.stdout).errors.filter((f) => f.rule === 'R-SCHEMA');
    assert.ok(hits.some((f) => f.subject === 'manifests/misnamed.yaml'), JSON.stringify(hits));
  } finally { ws.cleanup(); }
});

test('an unparseable manifest is reported alongside every other finding', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'manifests/broken.yaml', 'this: is: not: valid: yaml:\n');
    writeFixture(ws, 'manifests/misnamed.yaml', readFixture(ws, 'manifests/graphpowers.yaml'));
    const r = run(ws, ['scripts/validate.mjs', '--json']);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    const subjects = JSON.parse(r.stdout).errors.map((f) => f.subject);
    assert.ok(subjects.includes('manifests/broken.yaml'), JSON.stringify(subjects));
    assert.ok(subjects.includes('manifests/misnamed.yaml'), JSON.stringify(subjects));
  } finally { ws.cleanup(); }
});

test('compile reports an unreadable input as a one-line usage error', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'registry.yaml', 'this: is: not: valid: yaml:\n');
    const r = run(ws, ['scripts/compile.mjs', '--check']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^compile: /m);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  } finally { ws.cleanup(); }
});

test('a structurally broken manifest reports its schema error instead of crashing layer 3', () => {
  const ws = makeWorkspace({ products: ['graphpowers'] });
  try {
    const original = readFixture(ws, 'manifests/graphpowers.yaml');
    const broken = original.replace(/^    path: \.\n/m, '');
    assert.notEqual(broken, original, 'fixture no longer has a plugin path line to remove');
    writeFixture(ws, 'manifests/graphpowers.yaml', broken);

    const r = run(ws, ['scripts/validate.mjs', '--repos', '..', '--json']);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.errors.some((f) => f.rule === 'R-SCHEMA'), JSON.stringify(out.errors));
    assert.ok(
      out.skipped.some((f) => f.rule === 'R-REPO' && f.subject === 'layer 3' && /layer 1 failed/.test(f.message)),
      JSON.stringify(out.skipped),
    );
  } finally { ws.cleanup(); }
});

test('without --repos, a layer 1 failure still reports the usual layer 3 skip', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'manifests/misnamed.yaml', readFixture(ws, 'manifests/graphpowers.yaml'));
    const out = JSON.parse(run(ws, ['scripts/validate.mjs', '--json']).stdout);
    const skip = out.skipped.filter((f) => f.rule === 'R-REPO' && f.subject === 'layer 3');
    assert.equal(skip.length, 1, JSON.stringify(skip));
    assert.match(skip[0].message, /--repos-dir/);
  } finally { ws.cleanup(); }
});

/* ── Every finding must be actionable ─────────────────────────────────── */

test('every rule that can error names a subject and says what is wrong', async () => {
  const { layer1, layer2, ERROR } = await import('../scripts/lib/rules.mjs');
  const { paths, readYaml, loadManifests } = await import('../scripts/lib/io.mjs');
  const registry = readYaml(paths.registry);
  const taxonomy = readYaml(paths.taxonomy);
  const manifests = loadManifests();

  // Break one thing at a time and inspect the shape of what comes back.
  // CORRECTED from the plan: mutating `.repository` is a no-op here because
  // R-META1 lives in layer3 (needs a real repo checkout via --repos), which
  // this test deliberately does not run. `.family` is checked by R-REF7 in
  // layer2 and fires for real. See ledger for the verification.
  const broken = structuredClone(registry);
  broken.products['graphpowers'].family = 'bogus-family-xyz';
  const findings = [...layer1({ registry: broken, taxonomy, manifests }), ...layer2({ registry: broken, taxonomy, manifests })];

  for (const f of findings.filter((x) => x.severity === ERROR)) {
    assert.ok(f.rule?.startsWith('R-'), `finding has no rule id: ${JSON.stringify(f)}`);
    assert.ok(f.subject?.length > 0, `${f.rule} has no subject`);
    assert.ok(f.message?.length > 15, `${f.rule} message is too terse to act on: "${f.message}"`);
    assert.doesNotMatch(f.message, /^(invalid|error|failed)\.?$/i, `${f.rule} message says nothing`);
  }

  // Non-vacuous: this test exists to check real ERROR findings, not an
  // empty loop. Confirm the mutation actually produced at least one.
  assert.ok(findings.some((f) => f.severity === ERROR), 'mutation produced no ERROR findings - test would be vacuous');
});

test('every rule id in rules.mjs appears in the ecosystem README', () => {
  const rules = readFileSync(join(ECOSYSTEM_ROOT, 'scripts', 'lib', 'rules.mjs'), 'utf8');
  const readme = readFileSync(join(ECOSYSTEM_ROOT, 'README.md'), 'utf8');
  const ids = [...new Set(rules.match(/R-[A-Z]+\d+/g) ?? [])].sort();
  const undocumented = ids.filter((id) => !readme.includes(id));
  assert.deepEqual(undocumented, [], `undocumented rules: ${undocumented.join(', ')}`);
});

/* ── Recovery: every failure has a stated way back to green ───────────── */

test('drift in the snapshot is recoverable by running sync', () => {
  const ws = makeWorkspace();
  try {
    writeFixture(ws, 'manifests/registry-guard.yaml', `${readFixture(ws, 'manifests/registry-guard.yaml')}\n# hand edited\n`);
    const before = run(ws, ['scripts/validate.mjs', '--repos', '..']);
    assert.equal(before.code, 2);
    assert.match(before.stdout, /run scripts\/sync\.mjs/);

    assert.equal(run(ws, ['scripts/sync.mjs', '--repos', '..']).code, 0);
    assert.equal(run(ws, ['scripts/validate.mjs', '--repos', '..']).code, 0);
  } finally { ws.cleanup(); }
});

test('drift in a generated artifact is recoverable by running compile', () => {
  const ws = makeWorkspace({ products: [] });
  try {
    writeFixture(ws, 'catalog.json', '{}\n');
    const before = run(ws, ['scripts/compile.mjs', '--check']);
    assert.equal(before.code, 2);
    assert.match(before.stderr, /Run `node scripts\/compile\.mjs`/);

    assert.equal(run(ws, ['scripts/compile.mjs']).code, 0);
    assert.equal(run(ws, ['scripts/compile.mjs', '--check']).code, 0);
  } finally { ws.cleanup(); }
});
