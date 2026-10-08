import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPyproject, pythonFloor } from '../scripts/lib/io.mjs';

const withPyproject = (text, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-py-'));
  try {
    const file = join(dir, 'pyproject.toml');
    writeFileSync(file, text, 'utf8');
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('readPyproject reads [project] when it is the last section', () => {
  const py = withPyproject(
    '[build-system]\nrequires = ["hatchling"]\n\n[project]\nname = "demo"\nversion = "1.0.0"\nrequires-python = ">=3.10"\n',
    readPyproject,
  );
  assert.equal(py.name, 'demo');
  assert.equal(py.version, '1.0.0');
  assert.equal(py.requiresPython, '>=3.10');
});

test('readPyproject does not stop a section at a literal Z', () => {
  const py = withPyproject(
    '[project]\nname = "demo"\ndescription = "Zero config"\nlicense = "MIT"\n\n[project.urls]\nHomepage = "https://example.com"\n',
    readPyproject,
  );
  assert.equal(py.name, 'demo');
  assert.equal(py.license, 'MIT');
  assert.equal(py.homepage, 'https://example.com');
});

test('readPyproject reads CRLF files the same as LF', () => {
  const py = withPyproject('[project]\r\nname = "demo"\r\nrequires-python = ">=3.11"\r\n', readPyproject);
  assert.equal(py.name, 'demo');
  assert.equal(py.requiresPython, '>=3.11');
});

test('pythonFloor compares major and minor', () => {
  assert.notEqual(pythonFloor('>=3.10'), pythonFloor('>=3.12'));
  assert.equal(pythonFloor('>=3.10'), '3.10');
  assert.equal(pythonFloor('>=3.10,<4'), '3.10');
});

test('pythonFloor treats a missing minor as 0', () => {
  assert.equal(pythonFloor('>=3'), pythonFloor('>=3.0'));
});

test('pythonFloor returns null for anything unreadable', () => {
  assert.equal(pythonFloor(undefined), null);
  assert.equal(pythonFloor(3.1), null);
  assert.equal(pythonFloor('any'), null);
});
