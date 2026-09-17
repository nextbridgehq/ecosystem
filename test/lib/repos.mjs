import { resolve, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { paths, readYaml } from '../../scripts/lib/io.mjs';

/**
 * Parses CLI arguments to extract explicit --repos and --repos-dir options.
 */
export function parseRepoArgs(argv = process.argv.slice(2)) {
  const repos = [];
  let reposDir = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repos') {
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        repos.push(argv[i]);
        i++;
      }
      i--;
    } else if (argv[i] === '--repos-dir') {
      reposDir = argv[++i] ?? null;
    }
  }
  return { repos, reposDir };
}

/**
 * Discovers registered product repositories within a base directory.
 */
export function discoverSiblingRepos(registry, baseDir) {
  const discovered = new Map();
  const missing = [];
  const products = Object.entries(registry?.products ?? {});

  for (const [id, entry] of products) {
    const repoName = entry.repository?.split('/')[1] || id;
    const target = join(baseDir, repoName);
    if (existsSync(target) && statSync(target).isDirectory()) {
      discovered.set(id, target);
    } else {
      missing.push(id);
    }
  }

  return { discovered, missing, total: products.length };
}

/**
 * Resolves repository paths for Tier 3 testing with deterministic precedence:
 * 1. Explicit CLI arguments (--repos <path...> or --repos-dir <dir>)
 * 2. Environment variable (ECOSYSTEM_REPOS_DIR)
 * 3. Registry-driven sibling discovery (../<product>)
 * 4. Fallback: Graceful Skip (only when discovery was automatic)
 */
export function resolveLiveRepos({
  argv = process.argv.slice(2),
  env = process.env,
  baseDir = resolve(paths.registry, '..', '..'),
  registry = readYaml(paths.registry),
} = {}) {
  const { repos, reposDir } = parseRepoArgs(argv);

  // 1. Explicit --repos <paths...>
  if (repos.length > 0) {
    const resolved = new Map();
    for (const p of repos) {
      const abs = resolve(p);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        throw new Error(`Explicitly requested repository not found at: ${p}`);
      }
      const name = abs.split(/[\\/]/).pop();
      resolved.set(name, abs);
    }
    return {
      available: true,
      source: 'cli-repos',
      repos: resolved,
      count: resolved.size,
      total: resolved.size,
      reposDir: null,
      reason: null,
    };
  }

  // 2. Explicit --repos-dir or ECOSYSTEM_REPOS_DIR
  const explicitDir = reposDir || env.ECOSYSTEM_REPOS_DIR;
  if (explicitDir) {
    const absDir = resolve(explicitDir);
    if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
      throw new Error(`Configured repos directory not found at: ${explicitDir}`);
    }
    const { discovered, missing, total } = discoverSiblingRepos(registry, absDir);
    return {
      available: discovered.size > 0,
      source: reposDir ? 'cli-repos-dir' : 'env',
      repos: discovered,
      count: discovered.size,
      total,
      reposDir: absDir,
      reason: discovered.size === 0 ? 'no registered products found in configured directory' : null,
    };
  }

  // 3. Implicit sibling discovery
  const { discovered, missing, total } = discoverSiblingRepos(registry, baseDir);
  if (discovered.size > 0) {
    return {
      available: true,
      source: 'auto-sibling',
      repos: discovered,
      count: discovered.size,
      total,
      reposDir: baseDir,
      reason: null,
    };
  }

  // 4. Fallback: Graceful Skip
  return {
    available: false,
    source: 'none',
    repos: new Map(),
    count: 0,
    total,
    reposDir: null,
    reason: 'sibling repositories not available',
  };
}

/**
 * Formats a standardized skip notification for Tier 3.
 */
export function formatSkipMessage(reason) {
  return `○ Tier 3 — Live repository integration: SKIPPED (${reason})`;
}
