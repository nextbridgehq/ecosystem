import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paths, readYaml, loadManifests } from '../scripts/lib/io.mjs';
import { layer3, ERROR } from '../scripts/lib/rules.mjs';
import { resolveLiveRepos, formatSkipMessage } from './lib/repos.mjs';

test('Tier 3 — Live repository integration', (t) => {
  const resolution = resolveLiveRepos();

  if (!resolution.available) {
    const msg = formatSkipMessage(resolution.reason);
    console.log(msg);
    t.skip(resolution.reason);
    return;
  }

  const registry = readYaml(paths.registry);
  const manifests = loadManifests();

  const findings = layer3({
    registry,
    manifests,
    reposDir: resolution.reposDir,
  });

  const errors = findings.filter((f) => f.severity === ERROR);
  assert.deepEqual(errors, [], `Layer 3 errors found: ${JSON.stringify(errors, null, 2)}`);

  console.log(
    `✓ Tier 3 — Live repository integration: ${resolution.count}/${resolution.total} repositories verified`
  );
});
