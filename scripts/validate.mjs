#!/usr/bin/env node
/**
 * Validates the ecosystem.
 *
 *   node scripts/validate.mjs                 layers 1 and 2 (offline)
 *   node scripts/validate.mjs --repos ../     adds layer 3 against local checkouts
 *   node scripts/validate.mjs --json          machine-readable findings
 *
 * Exit codes are the API: 0 clean, 1 usage/internal error, 2 validation errors.
 */
import { resolve } from 'node:path';
import { paths, readYaml, loadManifests } from './lib/io.mjs';
import { layer1, layer2, layer3, ERROR, WARN, SKIP } from './lib/rules.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? '');
};
const has = (name) => argv.includes(name);

const reposDir = flag('--repos');
const asJson = has('--json');

let findings;
try {
  const registry = readYaml(paths.registry);
  const taxonomy = readYaml(paths.taxonomy);
  const manifests = loadManifests();

  findings = [...layer1({ registry, taxonomy, manifests })];
  // Layer 2 assumes layer 1 held; running it on a structurally broken document
  // produces noise rather than information.
  if (!findings.some((f) => f.severity === ERROR)) {
    findings.push(...layer2({ registry, taxonomy, manifests }));
  }
  if (reposDir !== null) {
    findings.push(...layer3({ registry, manifests, reposDir: resolve(reposDir) }));
  } else {
    findings.push({ rule: 'R-REPO', severity: SKIP, subject: 'layer 3', message: 'not run - pass --repos <dir> to check repository consistency' });
  }
} catch (error) {
  process.stderr.write(`validate: ${error.message}\n`);
  process.exit(1);
}

const errors = findings.filter((f) => f.severity === ERROR);
const warnings = findings.filter((f) => f.severity === WARN);
const skipped = findings.filter((f) => f.severity === SKIP);

if (asJson) {
  process.stdout.write(`${JSON.stringify({ errors, warnings, skipped }, null, 2)}\n`);
} else {
  const mark = { [ERROR]: 'ERROR  ', [WARN]: 'WARN   ', [SKIP]: 'SKIP   ' };
  for (const f of [...errors, ...warnings, ...skipped]) {
    process.stdout.write(`${mark[f.severity]}${f.rule.padEnd(9)} ${f.subject}\n         ${f.message}\n`);
  }
  process.stdout.write(
    `\n${errors.length} error(s), ${warnings.length} warning(s), ${skipped.length} skipped.\n`,
  );
}

process.exit(errors.length > 0 ? 2 : 0);
