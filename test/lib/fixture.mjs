/**
 * Disposable fixtures for the hardening suite.
 *
 * A fixture is a copy of the ecosystem tree and the product directories in a
 * temporary workspace. The copied scripts resolve their own ROOT from
 * import.meta.url, so running them from inside the copy validates and compiles
 * the copy - no source change, no parameterised root, no risk to the real tree.
 *
 * node_modules is junctioned rather than copied: it is large, identical for
 * every fixture, and only ever read.
 */
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../../scripts/lib/io.mjs';

export const ECOSYSTEM_ROOT = ROOT;
export const FIXTURES_ROOT = resolve(ROOT, 'test', 'fixtures', 'products');

export const ALL_PRODUCTS = [
  'agent-loop-guard', 'block-builder', 'code-comrades', 'edge-compat-check',
  'graphpowers', 'package-pilot', 'project-charter', 'registry-guard', 'repocode',
];

/* Never copied into a fixture: large, rebuilt, or irrelevant to every rule. */
const EXCLUDE = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.next', 'coverage',
  '__pycache__', '.venv', 'venv', 'graphify-out', '.pytest_cache', '.mypy_cache',
]);

const copyTree = (from, to) =>
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (src) => !EXCLUDE.has(src.split(/[\\/]/).pop()),
  });

export function makeWorkspace({ products = ALL_PRODUCTS, prefix = 'nb-fix-' } = {}) {
  if (!existsSync(FIXTURES_ROOT)) {
    throw new Error(`Fixtures root directory not found at ${FIXTURES_ROOT}`);
  }
  const root = mkdtempSync(join(tmpdir(), prefix));
  const eco = join(root, 'ecosystem');

  copyTree(ECOSYSTEM_ROOT, eco);
  for (const name of products) {
    const fixturePath = join(FIXTURES_ROOT, name);
    if (!existsSync(fixturePath)) {
      throw new Error(`Synthetic fixture not found for product: "${name}" at ${fixturePath}`);
    }
    copyTree(fixturePath, join(root, name));
  }

  // Link the dependencies rather than copying them.
  const modules = join(eco, 'node_modules');
  if (!existsSync(modules)) {
    symlinkSync(join(ECOSYSTEM_ROOT, 'node_modules'), modules,
      process.platform === 'win32' ? 'junction' : 'dir');
  }

  return {
    root,
    eco,
    repo: (name) => join(root, name),
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

export function run(ws, args, { cwd = ws.eco } = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export const readFixture = (ws, rel) => readFileSync(join(ws.eco, rel), 'utf8').replace(/\r\n/g, '\n');

export function writeFixture(ws, rel, text) {
  mkdirSync(dirname(join(ws.eco, rel)), { recursive: true });
  writeFileSync(join(ws.eco, rel), text, 'utf8');
}

export function patchProduct(ws, repo, rel, mutate) {
  const file = join(ws.repo(repo), rel);
  writeFileSync(file, mutate(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')), 'utf8');
}

export function patchJson(ws, repo, rel, mutate) {
  const file = join(ws.repo(repo), rel);
  const next = mutate(JSON.parse(readFileSync(file, 'utf8')));
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

export function gitInit(dir) {
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'fixture@nextbridge.invalid');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'fixture');
}

export const gitDiffStat = (dir) => git(dir, 'diff', '--stat').stdout ?? '';
