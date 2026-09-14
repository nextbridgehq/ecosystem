#!/usr/bin/env node
/**
 * Copies each product's .nextbridge/product.yaml into manifests/ as a snapshot.
 *
 *   node scripts/sync.mjs --repos ../          copy from local checkouts
 *   node scripts/sync.mjs --repos ../ --check  report drift, write nothing
 *
 * Why a snapshot rather than fetching at compile time: catalog.json must be
 * reproducible from the contents of this repository alone. Compiling from live
 * network state makes the output unverifiable and ties CI to GitHub's
 * availability. The cost is this step and a committed copy; rule R-SYNC1
 * catches the copy going stale.
 *
 * Exit codes: 0 clean, 1 usage/internal error, 2 drift found under --check.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { paths, readYaml, listDir } from './lib/io.mjs';

const argv = process.argv.slice(2);
const reposArg = argv[argv.indexOf('--repos') + 1];
const check = argv.includes('--check');

if (!argv.includes('--repos') || !reposArg) {
  process.stderr.write('usage: node scripts/sync.mjs --repos <dir> [--check]\n');
  process.exit(1);
}

const reposDir = resolve(reposArg);
const registry = readYaml(paths.registry);
mkdirSync(paths.manifests, { recursive: true });

const expected = new Set();
let changed = 0;

for (const [id, entry] of Object.entries(registry.products ?? {})) {
  if (entry.manifest_status !== 'present') continue;
  const repoName = entry.repository.split('/')[1];
  const source = join(reposDir, repoName, entry.manifest_path ?? '.nextbridge/product.yaml');
  const target = join(paths.manifests, `${id}.yaml`);
  expected.add(`${id}.yaml`);

  if (!existsSync(source)) {
    process.stderr.write(`sync: ${id}: missing ${source}\n`);
    process.exit(1);
  }

  const incoming = readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
  const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;

  if (current === incoming) {
    process.stdout.write(`unchanged  ${id}\n`);
    continue;
  }
  changed += 1;
  if (check) {
    process.stdout.write(`DRIFT      ${id}\n`);
  } else {
    writeFileSync(target, incoming, 'utf8');
    process.stdout.write(`${current === null ? 'added     ' : 'updated   '} ${id}\n`);
  }
}

// A manifest for a product that has gone back to "pending", or been removed,
// must not linger in the snapshot directory.
for (const file of listDir(paths.manifests)) {
  if (!file.endsWith('.yaml') || expected.has(file)) continue;
  changed += 1;
  if (check) {
    process.stdout.write(`ORPHAN     ${file}\n`);
  } else {
    rmSync(join(paths.manifests, file));
    process.stdout.write(`removed    ${file}\n`);
  }
}

process.stdout.write(`\n${changed} change(s).\n`);
process.exit(check && changed > 0 ? 2 : 0);
