#!/usr/bin/env node
/**
 * Installs the compiled marketplace into a throwaway Claude configuration and
 * checks that every member plugin loads.
 *
 *   node scripts/verify-clean-env.mjs
 *
 * Uses CLAUDE_CONFIG_DIR so the developer's real configuration is never read
 * or written. Not part of `npm test`: it shells out to the claude CLI, which
 * is not a build dependency of this repository.
 *
 * Exit codes: 0 every plugin loaded, 1 claude unavailable, 2 a plugin failed.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths, readJson, ROOT } from './lib/io.mjs';

const cfg = mkdtempSync(join(tmpdir(), 'nb-claude-'));
const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_PLUGIN_PREFER_HTTPS: '1' };
// On Windows, shell:true concatenates args into a single command line without
// escaping them (Node DEP0190), so an arg containing a space (e.g. this
// repo's own ROOT path, "...mini projects...") gets split in two and the
// claude CLI never sees the path it was given. Quote such args ourselves.
const winQuote = (arg) => (process.platform === 'win32' && /\s/.test(arg) ? `"${arg}"` : arg);
const claude = (...args) =>
  spawnSync('claude', args.map(winQuote), { env, encoding: 'utf8', shell: process.platform === 'win32' });

const fail = (message, code) => {
  process.stderr.write(`verify-clean-env: ${message}\n`);
  rmSync(cfg, { recursive: true, force: true });
  process.exit(code);
};

try {
  const probe = claude('--version');
  if (probe.status !== 0) fail('the claude CLI is not available on PATH', 1);
  process.stdout.write(`claude ${probe.stdout.trim()}\n`);

  const empty = claude('plugin', 'marketplace', 'list');
  if (!/No marketplaces configured/.test(empty.stdout)) {
    fail(`CLAUDE_CONFIG_DIR did not isolate the configuration:\n${empty.stdout}`, 1);
  }

  const added = claude('plugin', 'marketplace', 'add', ROOT);
  if (added.status !== 0) fail(`could not add the marketplace:\n${added.stdout}${added.stderr}`, 2);

  const marketplace = readJson(paths.marketplace);
  const installed = [];
  let failed = 0;
  for (const plugin of marketplace.plugins) {
    const ref = `${plugin.name}@${marketplace.name}`;
    const install = claude('plugin', 'install', ref);
    if (install.status !== 0) {
      process.stderr.write(`FAIL  ${ref} did not install:\n${install.stdout}${install.stderr}\n`);
      failed += 1;
      continue;
    }
    installed.push(ref);
  }

  // `claude plugin list` is the source of truth for load status: it actually
  // loads every installed plugin's hooks/MCP/etc, whereas `plugin details`
  // only reports static manifest contents and stays silent about a plugin
  // that installed fine but failed to load (e.g. a hooks.json conflict) —
  // confirmed by hand against this repo's own graphpowers@nextbridge plugin.
  const listed = claude('plugin', 'list');
  const blockFor = (ref) => {
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = listed.stdout.match(new RegExp(`❯ ${escaped}[\\s\\S]*?(?=\\n\\s*❯|$)`));
    return m ? m[0] : '';
  };

  for (const ref of installed) {
    const listBlock = blockFor(ref);
    if (listBlock === '' || /failed to load/i.test(listBlock)) {
      process.stderr.write(`FAIL  ${ref} installed but did not load:\n${listBlock || listed.stdout}\n`);
      failed += 1;
      continue;
    }
    const details = claude('plugin', 'details', ref);
    process.stdout.write(`OK    ${ref}\n`);
    process.stdout.write(`${details.stdout.split('\n').filter((l) => /Skills|Agents|Commands|Hooks|MCP/.test(l)).join('\n')}\n`);
  }

  process.stdout.write(`\n${listed.stdout}\n`);

  if (failed > 0) fail(`${failed} plugin(s) failed in a clean environment`, 2);
  process.stdout.write(`\nAll ${marketplace.plugins.length} plugin(s) installed and loaded from a clean Claude environment.\n`);
} finally {
  rmSync(cfg, { recursive: true, force: true, maxRetries: 3 });
}
