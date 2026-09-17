import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoArgs, resolveLiveRepos, formatSkipMessage, discoverSiblingRepos } from './lib/repos.mjs';

test('parseRepoArgs extracts --repos paths and --repos-dir', () => {
  const parsed = parseRepoArgs(['--repos', 'path/a', 'path/b', '--repos-dir', 'parent/dir']);
  assert.deepEqual(parsed.repos, ['path/a', 'path/b']);
  assert.equal(parsed.reposDir, 'parent/dir');
});

test('parseRepoArgs handles empty or missing flags', () => {
  const parsed = parseRepoArgs([]);
  assert.deepEqual(parsed.repos, []);
  assert.equal(parsed.reposDir, null);
});

test('resolveLiveRepos throws on non-existent explicit repo', () => {
  assert.throws(
    () => resolveLiveRepos({ argv: ['--repos', 'definitely/does/not/exist'] }),
    /Explicitly requested repository not found/
  );
});

test('resolveLiveRepos throws on non-existent ECOSYSTEM_REPOS_DIR', () => {
  assert.throws(
    () => resolveLiveRepos({ argv: [], env: { ECOSYSTEM_REPOS_DIR: 'definitely/does/not/exist' } }),
    /Configured repos directory not found/
  );
});

test('resolveLiveRepos throws on non-existent --repos-dir', () => {
  assert.throws(
    () => resolveLiveRepos({ argv: ['--repos-dir', 'definitely/does/not/exist'], env: {} }),
    /Configured repos directory not found/
  );
});

test('resolveLiveRepos falls back to graceful skip when automatic discovery finds nothing', () => {
  const res = resolveLiveRepos({ argv: [], env: {}, baseDir: 'nonexistent-empty-dir' });
  assert.equal(res.available, false);
  assert.match(res.reason, /sibling repositories not available/);
});

test('formatSkipMessage formats human-readable status', () => {
  const msg = formatSkipMessage('sibling repositories not available');
  assert.equal(msg, '○ Tier 3 — Live repository integration: SKIPPED (sibling repositories not available)');
});
