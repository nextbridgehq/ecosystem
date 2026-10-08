import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = {
  registry: join(ROOT, 'registry.yaml'),
  taxonomy: join(ROOT, 'taxonomy', 'capabilities.yaml'),
  manifests: join(ROOT, 'manifests'),
  schema: join(ROOT, 'schema'),
  catalog: join(ROOT, 'catalog.json'),
  marketplace: join(ROOT, '.claude-plugin', 'marketplace.json'),
  solutions: join(ROOT, 'solutions'),
};

export function readYaml(file) {
  return yaml.load(readFileSync(file, 'utf8'));
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readJsonIfExists(file) {
  return existsSync(file) ? readJson(file) : null;
}

export function readTextIfExists(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function isDir(p) {
  return existsSync(p) && statSync(p).isDirectory();
}

export function listDir(p) {
  return isDir(p) ? readdirSync(p).sort() : [];
}

/** Every product manifest currently synced into manifests/, keyed by product id. */
export function loadManifests() {
  const out = {};
  for (const file of listDir(paths.manifests)) {
    if (!file.endsWith('.yaml')) continue;
    const doc = readYaml(join(paths.manifests, file));
    out[doc?.id ?? file.replace(/\.yaml$/, '')] = { file, doc };
  }
  return out;
}

/**
 * Recursively collect every package.json in a repository, skipping directories
 * that never carry first-party metadata. Monorepos (RepoCode) declare their
 * repository URL and package names in workspace packages, not at the root.
 */
export function collectPackageJson(repoDir, depth = 4) {
  const skip = new Set([
    'node_modules', '.git', 'dist', 'build', 'target', '.next',
    'coverage', '__pycache__', '.venv', 'venv', 'graphify-out',
  ]);
  const found = [];
  const walk = (dir, left) => {
    if (left < 0 || !isDir(dir)) return;
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        found.push({ path: pkg, json: readJson(pkg) });
      } catch {
        /* an unparseable package.json is reported by the caller, not here */
      }
    }
    for (const entry of listDir(dir)) {
      if (skip.has(entry) || entry.startsWith('.')) continue;
      walk(join(dir, entry), left - 1);
    }
  };
  walk(repoDir, depth);
  return found;
}

/** Normalise any git/HTTPS/SSH remote form to `owner/repo`, or null. */
export function normalizeRepoRef(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  let s = value.trim();
  s = s.replace(/^git\+/, '').replace(/\.git$/, '');
  const m =
    s.match(/github\.com[/:]([^/]+)\/([^/#?]+)/) ||
    s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Lowest major version a range admits. Deliberately crude: it exists so
 * ">=20" and ">=20.0.0" compare equal (rule R-META4). Anything it cannot
 * read returns null and the rule reports `skipped` rather than passing.
 */
export function versionFloor(range) {
  if (typeof range !== 'string') return null;
  const m = range.match(/(\d+)(?:\.(\d+))?/);
  return m ? Number(m[1]) : null;
}

/**
 * Lowest "major.minor" a Python range admits, so ">=3.10" and ">=3.12" differ
 * and ">=3" equals ">=3.0" (rule R-META4). Unreadable input returns null.
 */
export function pythonFloor(range) {
  if (typeof range !== 'string') return null;
  const m = range.match(/(\d+)(?:\.(\d+))?/);
  return m ? `${Number(m[1])}.${Number(m[2] ?? 0)}` : null;
}

/** Minimal `[project]` reader for pyproject.toml. Only the fields the rules need. */
export function readPyproject(file) {
  const text = readTextIfExists(file);
  if (text === null) return null;
  const section = (name) => {
    const re = new RegExp(`^\\[${name.replace(/[.[\]]/g, '\\$&')}\\]([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm');
    return text.match(re)?.[1] ?? '';
  };
  const scalar = (body, key) =>
    body.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm'))?.[1] ?? null;
  const project = section('project');
  const urls = section('project.urls');
  return {
    name: scalar(project, 'name'),
    version: scalar(project, 'version'),
    license: scalar(project, 'license'),
    requiresPython: scalar(project, 'requires-python'),
    homepage: scalar(urls, 'Homepage'),
    repository: scalar(urls, 'Repository'),
  };
}

/** Deterministic JSON: keys sorted at every level, arrays left in authored order. */
export function stableStringify(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
