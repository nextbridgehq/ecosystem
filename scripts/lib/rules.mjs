import { join, resolve, relative, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  paths, readJson, readJsonIfExists, readTextIfExists, listDir, isDir,
  collectPackageJson, normalizeRepoRef, versionFloor, pythonFloor, readPyproject,
} from './io.mjs';

export const ERROR = 'error';
export const WARN = 'warning';
export const SKIP = 'skipped';

const finding = (rule, severity, subject, message) => ({ rule, severity, subject, message });

/* ────────────────────────────────────────────────────────────────────────
   Layer 1 — structural. JSON Schema only. Offline.
   ──────────────────────────────────────────────────────────────────────── */

export function layer1({ registry, taxonomy, manifests }) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const out = [];
  // Compile each schema once: Ajv registers by $id and rejects a second
  // compile of the same identifier, which the second product manifest hits.
  const compiled = new Map();
  const compile = (schemaFile) => {
    if (!compiled.has(schemaFile)) {
      compiled.set(schemaFile, ajv.compile(readJson(join(paths.schema, schemaFile))));
    }
    return compiled.get(schemaFile);
  };

  const check = (schemaFile, doc, subject) => {
    const validate = compile(schemaFile);
    if (validate(doc)) return;
    for (const e of validate.errors ?? []) {
      out.push(finding('R-SCHEMA', ERROR, subject, `${e.instancePath || '/'} ${e.message}`));
    }
  };

  check('registry.v1.schema.json', registry, 'registry.yaml');
  check('capabilities.v1.schema.json', taxonomy, 'taxonomy/capabilities.yaml');
  for (const [id, { file, doc, error }] of Object.entries(manifests)) {
    if (error) {
      out.push(finding('R-SCHEMA', ERROR, `manifests/${file}`, `cannot be parsed as YAML: ${error}`));
      continue;
    }
    check('product.v1.schema.json', doc, `manifests/${file}`);
    if (doc?.id !== id) {
      out.push(finding('R-SCHEMA', ERROR, `manifests/${file}`, `manifest id "${doc?.id}" does not match its filename`));
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
   Layer 2 — referential. Cross-artifact. Offline.
   ──────────────────────────────────────────────────────────────────────── */

export function layer2({ registry, taxonomy, manifests }) {
  const out = [];
  const capabilityIds = new Set(Object.keys(taxonomy.capabilities ?? {}));
  const categoryIds = new Set(Object.keys(taxonomy.categories ?? {}));
  const productIds = new Set(Object.keys(registry.products ?? {}));
  const canonical = registry.marketplace?.id;

  // R-TAX1 — every capability's category exists.
  for (const [id, cap] of Object.entries(taxonomy.capabilities ?? {})) {
    if (!categoryIds.has(cap.category)) {
      out.push(finding('R-TAX1', ERROR, `capability:${id}`, `unknown category "${cap.category}"`));
    }
  }

  // R-REF1 — every declared capability resolves to a taxonomy leaf.
  for (const [id, { doc }] of Object.entries(manifests)) {
    for (const key of ['core', 'secondary']) {
      for (const cap of doc.capabilities?.[key] ?? []) {
        if (!capabilityIds.has(cap)) {
          out.push(finding('R-REF1', ERROR, `product:${id}`, `capability "${cap}" is not in the taxonomy`));
        }
      }
    }
  }

  // R-REF2 — registry and manifests agree about which products are described.
  for (const [id, entry] of Object.entries(registry.products ?? {})) {
    const present = Boolean(manifests[id]);
    if (entry.manifest_status === 'present' && !present) {
      out.push(finding('R-REF2', ERROR, `product:${id}`, 'manifest_status is "present" but manifests/ has no manifest'));
    }
    if (entry.manifest_status === 'pending' && present) {
      out.push(finding('R-REF2', ERROR, `product:${id}`, 'a manifest is synced but manifest_status is still "pending"'));
    }
  }
  for (const id of Object.keys(manifests)) {
    if (!productIds.has(id)) {
      out.push(finding('R-REF2', ERROR, `product:${id}`, 'manifest exists but the product is not indexed in registry.yaml'));
    }
  }

  // R-REF3 / R-REF4 — integration targets resolve; verified implies verification.
  const integrations = [
    ...(registry.integrations ?? []).map((i) => ({ i, subject: 'registry.yaml' })),
    ...Object.entries(manifests).flatMap(([id, { doc }]) =>
      (doc.integrations ?? []).map((i) => ({ i: { ...i, from: id }, subject: `product:${id}` }))),
  ];
  for (const { i, subject } of integrations) {
    for (const end of ['from', 'to']) {
      const value = i[end];
      if (value === undefined) continue;
      const isExternal = end === 'to' && i.external === true;
      if (!isExternal && !productIds.has(value)) {
        out.push(finding('R-REF3', ERROR, subject, `integration ${end} "${value}" is neither a known product nor marked external`));
      }
    }
    if (i.status === 'verified' && !i.verification) {
      out.push(finding('R-REF4', ERROR, subject, `integration to "${i.to}" claims status "verified" without a verification block`));
    }
  }

  // R-REF5 — maturity "integrated" requires a verified internal integration.
  for (const [id, { doc }] of Object.entries(manifests)) {
    if (doc.maturity !== 'integrated') continue;
    const qualifies = [...(doc.integrations ?? []), ...(registry.integrations ?? []).filter((i) => i.from === id)]
      .some((i) => i.status === 'verified' && i.external !== true && productIds.has(i.to));
    if (!qualifies) {
      out.push(finding('R-REF5', ERROR, `product:${id}`,
        'maturity "integrated" requires at least one verified integration with another Nextbridge product'));
    }
  }

  // R-REF6 — a solution needs two products and a real integration behind it.
  for (const ref of registry.solutions ?? []) {
    const file = join(paths.solutions, (ref.$ref ?? '').replace(/^solutions\//, ''));
    if (!existsSync(file)) {
      out.push(finding('R-REF6', ERROR, 'registry.yaml', `solution reference "${ref.$ref}" does not resolve`));
    }
  }

  // R-REF7 — every referenced family exists.
  const familyIds = new Set(Object.keys(registry.families ?? {}));
  for (const [id, entry] of Object.entries(registry.products ?? {})) {
    if (!familyIds.has(entry.family)) {
      out.push(finding('R-REF7', ERROR, `product:${id}`, `unknown family "${entry.family}"`));
    }
  }

  // R-REF8 — orphaned capabilities. A warning while products remain unmanifested.
  const allPending = Object.values(registry.products ?? {}).some((p) => p.manifest_status === 'pending');
  const used = new Set(Object.values(manifests).flatMap(({ doc }) => [
    ...(doc.capabilities?.core ?? []), ...(doc.capabilities?.secondary ?? []),
  ]));
  for (const id of capabilityIds) {
    if (used.has(id)) continue;
    out.push(finding('R-REF8', allPending ? WARN : ERROR, `capability:${id}`,
      allPending ? 'no manifested product claims this capability yet' : 'orphaned: no product claims this capability'));
  }

  // R-REF9 — a product must have at least one surface: an interface or a plugin.
  // Plugins are deliberately absent from the interface vocabulary (decision D4),
  // so a plugin-only product has an empty interfaces[] and is still complete.
  for (const [id, { doc }] of Object.entries(manifests)) {
    const surfaces = (doc.interfaces ?? []).length + (doc.plugins ?? []).length;
    if (surfaces === 0) {
      out.push(finding('R-REF9', ERROR, `product:${id}`,
        'declares no surface: at least one interfaces[] entry or one plugins[] entry is required'));
    }
  }

  // R-MK4 — plugin names are unique across the whole ecosystem.
  const seen = new Map();
  for (const [id, { doc }] of Object.entries(manifests)) {
    for (const p of doc.plugins ?? []) {
      if (seen.has(p.name)) {
        out.push(finding('R-MK4', ERROR, `product:${id}`, `plugin name "${p.name}" is already used by "${seen.get(p.name)}"`));
      }
      seen.set(p.name, id);
    }
  }

  // R-MK6 — a product may not invent its own marketplace. The anti-fragmentation rule.
  for (const [id, { doc }] of Object.entries(manifests)) {
    for (const p of doc.plugins ?? []) {
      if (p.host !== 'claude-code') continue;
      if (p.marketplace !== canonical) {
        out.push(finding('R-MK6', ERROR, `product:${id}`,
          `plugin "${p.name}" declares marketplace "${p.marketplace}"; the only permitted value is "${canonical}"`));
      }
    }
  }

  // R-MK3 — bidirectional closure between manifests and marketplace membership.
  const declared = new Map();
  for (const [id, { doc }] of Object.entries(manifests)) {
    for (const p of doc.plugins ?? []) {
      if (p.host === 'claude-code' && p.status === 'published') declared.set(`${id}/${p.name}`, p);
    }
  }
  const members = new Set((registry.marketplace?.members ?? []).map((m) => `${m.product}/${m.plugin}`));
  for (const key of declared.keys()) {
    if (!members.has(key)) {
      out.push(finding('R-MK3', ERROR, 'registry.yaml', `published plugin "${key}" is not a member of the canonical marketplace`));
    }
  }
  for (const key of members) {
    const [productId, pluginName] = key.split('/');
    if (!declared.has(key)) {
      const why = manifests[productId]
        ? `product "${productId}" declares no published claude-code plugin named "${pluginName}"`
        : `product "${productId}" has no synced manifest`;
      out.push(finding('R-MK3', ERROR, 'registry.yaml', `marketplace member "${key}" does not resolve: ${why}`));
    }
  }

  // R-MK1 — exactly one marketplace file in this repository, matching the registry.
  const generated = readJsonIfExists(paths.marketplace);
  if (generated === null) {
    out.push(finding('R-MK1', SKIP, '.claude-plugin/marketplace.json', 'not generated yet - run scripts/compile.mjs'));
  } else if (generated.name !== canonical) {
    out.push(finding('R-MK1', ERROR, '.claude-plugin/marketplace.json',
      `marketplace name "${generated.name}" does not match registry marketplace id "${canonical}"`));
  }

  return out;
}

/* ────────────────────────────────────────────────────────────────────────
   Layer 3 — repository consistency. Needs the product repositories on disk.
   ──────────────────────────────────────────────────────────────────────── */

const COMPONENT_DIRS = { skills: 'skills', agents: 'agents', commands: 'commands' };

export function layer3({ registry, manifests, reposDir }) {
  const out = [];

  for (const [id, entry] of Object.entries(registry.products ?? {})) {
    const repoName = entry.repository.split('/')[1];
    const repoDir = join(reposDir, repoName);
    const subject = `product:${id}`;

    if (!isDir(repoDir)) {
      out.push(finding('R-REPO', SKIP, subject, `repository not available at ${repoDir}`));
      continue;
    }

    const pkgs = collectPackageJson(repoDir);
    const py = readPyproject(join(repoDir, 'pyproject.toml'));
    const manifest = manifests[id]?.doc ?? null;

    /* R-MK2 — no competing Nextbridge marketplace in a product repository.
       Escalates from warning to error the moment the product joins the model,
       which makes Phase 1.5 consolidation self-enforcing. */
    const stray = join(repoDir, '.claude-plugin', 'marketplace.json');
    if (existsSync(stray)) {
      const name = readJsonIfExists(stray)?.name ?? '(unnamed)';
      out.push(finding('R-MK2', manifest ? ERROR : WARN, subject,
        `repository declares its own marketplace "${name}"; the canonical marketplace is "${registry.marketplace?.id}"`));
    }

    if (!manifest) continue; // remaining rules describe a manifest against its repository

    // Declared npm packages (G1): when a manifest names specific packages under
    // distribution[channel=npm], those packages become the sole authority for
    // R-META1/R-META3/R-META4(node) — each checked independently, no any-of
    // collapsing across siblings. A manifest declaring none falls back to the
    // original tree-wide any-of behaviour, unchanged.
    const declaredNpm = new Set(
      (manifest.distribution ?? [])
        .filter((d) => d.channel === 'npm')
        .flatMap((d) => d.packages ?? []),
    );

    // R-META1 — declared repository matches the repository's own metadata.
    if (declaredNpm.size > 0) {
      const refs = pkgs
        .filter((p) => declaredNpm.has(p.json?.name))
        .map((p) => ({ name: p.json.name, ref: normalizeRepoRef(p.json?.repository?.url ?? p.json?.repository) }))
        .filter((r) => r.ref);
      if (refs.length === 0) {
        out.push(finding('R-META1', SKIP, subject, 'repository declares no repository URL anywhere'));
      } else {
        for (const { name, ref } of refs) {
          if (ref !== entry.repository) {
            out.push(finding('R-META1', ERROR, subject,
              `registry says "${entry.repository}" but declared package "${name}" declares "${ref}"`));
          }
        }
      }
    } else {
      const candidates = [
        ...pkgs.map((p) => p.json?.repository?.url ?? p.json?.repository),
        py?.repository, py?.homepage,
        readJsonIfExists(join(repoDir, '.claude-plugin', 'plugin.json'))?.repository,
      ].map(normalizeRepoRef).filter(Boolean);
      if (candidates.length === 0) {
        out.push(finding('R-META1', SKIP, subject, 'repository declares no repository URL anywhere'));
      } else if (!candidates.includes(entry.repository)) {
        out.push(finding('R-META1', ERROR, subject,
          `registry says "${entry.repository}" but the repository declares ${[...new Set(candidates)].map((c) => `"${c}"`).join(', ')}`));
      }
    }

    // R-META2 — every declared npm package exists and is publishable.
    for (const dist of manifest.distribution ?? []) {
      if (dist.channel !== 'npm') continue;
      for (const name of dist.packages ?? []) {
        const hit = pkgs.find((p) => p.json?.name === name);
        if (!hit) {
          out.push(finding('R-META2', ERROR, subject, `npm package "${name}" is declared but no package.json in the repository is named that`));
        } else if (hit.json.private === true) {
          out.push(finding('R-META2', ERROR, subject, `npm package "${name}" is declared as distribution but is marked "private": true`));
        }
      }
      if (dist.channel === 'pypi') continue;
    }
    for (const dist of manifest.distribution ?? []) {
      if (dist.channel !== 'pypi') continue;
      for (const name of dist.packages ?? []) {
        if (py?.name !== name) {
          out.push(finding('R-META2', ERROR, subject, `PyPI package "${name}" is declared but pyproject.toml names "${py?.name ?? '(none)'}"`));
        }
      }
    }

    // R-META3 — licence agrees, and a LICENSE file exists.
    if (declaredNpm.size > 0) {
      for (const p of pkgs) {
        if (!declaredNpm.has(p.json?.name)) continue;
        const license = p.json?.license;
        if (license && license !== manifest.license) {
          out.push(finding('R-META3', ERROR, subject,
            `manifest licence "${manifest.license}" does not match declared package "${p.json.name}"'s licence "${license}"`));
        }
      }
    } else {
      const licences = new Set([...pkgs.map((p) => p.json?.license), py?.license].filter(Boolean));
      if (licences.size > 0 && !licences.has(manifest.license)) {
        out.push(finding('R-META3', ERROR, subject,
          `manifest licence "${manifest.license}" does not match the repository's ${[...licences].join(', ')}`));
      }
    }
    if (!existsSync(join(repoDir, 'LICENSE')) && !existsSync(join(repoDir, 'LICENSE.md'))) {
      out.push(finding('R-META3', WARN, subject, 'no LICENSE file found'));
    }

    // R-META4 — declared runtime floor matches the repository's declared floor.
    if (manifest.runtime?.node) {
      const declared = versionFloor(manifest.runtime.node);
      if (declaredNpm.size > 0) {
        const found = pkgs
          .filter((p) => declaredNpm.has(p.json?.name))
          .map((p) => ({ name: p.json.name, floor: versionFloor(p.json?.engines?.node) }))
          .filter((f) => f.floor !== null);
        if (found.length === 0) {
          out.push(finding('R-META4', SKIP, subject, 'no engines.node declared anywhere in the repository'));
        } else {
          for (const { name, floor } of found) {
            if (floor !== declared) {
              out.push(finding('R-META4', ERROR, subject,
                `manifest node floor ${declared} does not match declared package "${name}"'s engines.node floor ${floor}`));
            }
          }
        }
      } else {
        const found = pkgs.map((p) => versionFloor(p.json?.engines?.node)).filter((v) => v !== null);
        if (found.length === 0) {
          out.push(finding('R-META4', SKIP, subject, 'no engines.node declared anywhere in the repository'));
        } else if (!found.includes(declared)) {
          out.push(finding('R-META4', ERROR, subject,
            `manifest node floor ${declared} does not match engines.node ${[...new Set(found)].join(', ')}`));
        }
      }
    }
    if (manifest.runtime?.python) {
      const declared = pythonFloor(manifest.runtime.python);
      const found = pythonFloor(py?.requiresPython);
      if (found === null) {
        out.push(finding('R-META4', SKIP, subject, 'no requires-python declared'));
      } else if (found !== declared) {
        out.push(finding('R-META4', ERROR, subject, `manifest python floor ${declared} does not match requires-python ${found}`));
      }
    }

    // R-META5 — "stable" is a claim about process, so require observable CI.
    const workflows = listDir(join(repoDir, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f));
    if (manifest.maturity === 'stable' && workflows.length === 0) {
      out.push(finding('R-META5', ERROR, subject, 'maturity "stable" requires at least one CI workflow, and none was found'));
    }

    // R-MK5 / R-MK7 — plugin manifests exist, agree, and carry what they claim.
    for (const plugin of manifest.plugins ?? []) {
      const pluginRoot = plugin.path === '.' ? repoDir : join(repoDir, plugin.path.replace(/^\.\//, ''));
      const pluginManifest = resolve(repoDir, plugin.manifest);
      const inside = relative(repoDir, pluginManifest);
      if (isAbsolute(inside) || inside.split(/[\\/]/)[0] === '..') {
        out.push(finding('R-MK5', ERROR, subject, `plugin "${plugin.name}" declares manifest ${plugin.manifest}, which is outside the repository`));
        continue;
      }
      if (!existsSync(pluginManifest)) {
        out.push(finding('R-MK5', ERROR, subject, `plugin "${plugin.name}" declares manifest ${plugin.manifest}, which does not exist`));
        continue;
      }
      const declaredName = readJson(pluginManifest)?.name;
      if (declaredName !== plugin.name) {
        out.push(finding('R-MK5', ERROR, subject, `plugin "${plugin.name}" does not match ${plugin.manifest} name "${declaredName}"`));
      }

      const overrides = readJson(pluginManifest);
      const componentOverridden = ['skills', 'agents', 'commands'].some((k) => overrides?.[k] !== undefined);
      if (componentOverridden) {
        out.push(finding('R-MK7', SKIP, subject, `plugin "${plugin.name}" overrides component paths in its manifest; count verification does not apply`));
      } else {
        for (const [key, dir] of Object.entries(COMPONENT_DIRS)) {
          const declared = plugin.components?.[key];
          if (declared === undefined) continue;
          const actual = key === 'skills'
            ? listDir(join(pluginRoot, dir)).filter((e) => existsSync(join(pluginRoot, dir, e, 'SKILL.md'))).length
            : listDir(join(pluginRoot, dir)).filter((e) => e.endsWith('.md')).length;
          if (actual !== declared) {
            out.push(finding('R-MK7', ERROR, subject, `plugin "${plugin.name}" declares ${declared} ${key} but the repository has ${actual}`));
          }
        }
        const hooksActual = existsSync(join(pluginRoot, 'hooks', 'hooks.json')) || overrides?.hooks !== undefined;
        if (plugin.components?.hooks !== undefined && plugin.components.hooks !== hooksActual) {
          out.push(finding('R-MK7', ERROR, subject, `plugin "${plugin.name}" declares hooks=${plugin.components.hooks} but the repository says ${hooksActual}`));
        }
        const mcpActual = existsSync(join(pluginRoot, '.mcp.json')) || overrides?.mcpServers !== undefined;
        if (plugin.components?.mcp !== undefined && plugin.components.mcp !== mcpActual) {
          out.push(finding('R-MK7', ERROR, subject, `plugin "${plugin.name}" declares mcp=${plugin.components.mcp} but the repository says ${mcpActual}`));
        }
      }
    }

    // R-SYNC1 — the synced snapshot still matches the product's own manifest.
    const source = join(repoDir, entry.manifest_path ?? '.nextbridge/product.yaml');
    const sourceText = readTextIfExists(source);
    if (sourceText === null) {
      out.push(finding('R-SYNC1', ERROR, subject, `manifest_status is "present" but ${entry.manifest_path ?? '.nextbridge/product.yaml'} is missing from the repository`));
    } else {
      const snapshot = readTextIfExists(join(paths.manifests, manifests[id].file));
      if (snapshot !== null && snapshot.replace(/\r\n/g, '\n') !== sourceText.replace(/\r\n/g, '\n')) {
        out.push(finding('R-SYNC1', ERROR, subject, 'the synced snapshot in manifests/ differs from the product repository - run scripts/sync.mjs'));
      }
    }
  }

  return out;
}
