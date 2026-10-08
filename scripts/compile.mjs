#!/usr/bin/env node
/**
 * Compiles the ecosystem into its two generated artifacts.
 *
 *   node scripts/compile.mjs           write catalog.json and the marketplace
 *   node scripts/compile.mjs --check   report drift, write nothing
 *
 *   registry.yaml + taxonomy/capabilities.yaml + manifests/*.yaml
 *        -> catalog.json
 *        -> .claude-plugin/marketplace.json
 *
 * Both outputs are generated, committed, and never hand-edited. Committing them
 * is what makes the catalog readable and the marketplace installable without a
 * build step; --check in CI is what keeps the committed copy honest.
 *
 * Output is deterministic - keys sorted at every level, arrays in a defined
 * order, no timestamps - so two runs are byte-identical and any diff is a real
 * change.
 *
 * Exit codes: 0 clean, 1 usage/internal error, 2 validation errors or drift.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { paths, readYaml, readJson, loadManifests, stableStringify } from './lib/io.mjs';
import { layer1, layer2, ERROR } from './lib/rules.mjs';
import { buildCatalog, buildMarketplace } from './lib/build.mjs';

const check = process.argv.includes('--check');

let registry, taxonomy, manifests;
try {
  registry = readYaml(paths.registry);
  taxonomy = readYaml(paths.taxonomy);
  manifests = loadManifests();
} catch (error) {
  process.stderr.write(`compile: ${error.message}\n`);
  process.exit(1);
}

/* Never compile an ecosystem that does not validate: a catalog built from a
   broken registry is worse than no catalog at all. */
const findings = [...layer1({ registry, taxonomy, manifests })];
if (!findings.some((f) => f.severity === ERROR)) {
  findings.push(...layer2({ registry, taxonomy, manifests }));
}
const errors = findings.filter((f) => f.severity === ERROR);
if (errors.length > 0) {
  process.stderr.write('compile: refusing to compile - validation failed:\n');
  for (const e of errors) process.stderr.write(`  ${e.rule} ${e.subject}: ${e.message}\n`);
  process.exit(2);
}

const catalog = buildCatalog({ registry, taxonomy, manifests });
const marketplace = buildMarketplace({ registry, manifests });

/* Guard the compiler against itself: the catalog is a published contract, so a
   change that breaks its shape should fail here rather than reach a consumer. */
const validateCatalog = new Ajv({ strict: false, allErrors: true })
  .compile(readJson(join(paths.schema, 'catalog.v1.schema.json')));
if (!validateCatalog(catalog)) {
  process.stderr.write('compile: the generated catalog does not match catalog.v1.schema.json:\n');
  for (const e of validateCatalog.errors ?? []) {
    process.stderr.write(`  ${e.instancePath || '/'} ${e.message}\n`);
  }
  process.exit(2);
}

const artifacts = [
  { path: paths.catalog, label: 'catalog.json', text: stableStringify(catalog) },
  { path: paths.marketplace, label: '.claude-plugin/marketplace.json', text: stableStringify(marketplace) },
];

let drift = 0;
for (const { path, label, text } of artifacts) {
  const current = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === text) {
    process.stdout.write(`unchanged  ${label}\n`);
    continue;
  }
  drift += 1;
  if (check) {
    process.stdout.write(`DRIFT      ${label}\n`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    process.stdout.write(`${current === null ? 'created   ' : 'updated   '} ${label}\n`);
  }
}

if (check && drift > 0) {
  process.stderr.write('\ncompile --check: a generated artifact is out of date. Run `node scripts/compile.mjs`.\n');
  process.exit(2);
}

const described = catalog.products.filter((p) => p.described).length;
process.stdout.write(
  `\n${described} of ${catalog.products.length} products described, ` +
  `${marketplace.plugins.length} plugin(s) in the "${registry.marketplace.id}" marketplace.\n`,
);
