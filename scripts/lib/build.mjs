/**
 * Pure builders for the two generated artifacts. No file I/O, so the shapes
 * they produce can be tested directly - including marketplace membership that
 * does not exist in the committed registry yet.
 */

const GENERATED = {
  by: 'scripts/compile.mjs',
  inputs: ['registry.yaml', 'taxonomy/capabilities.yaml', 'manifests/*.yaml'],
  warning: 'Generated file. Do not edit by hand - run `node scripts/compile.mjs`.',
};

export const repoUrl = (repo) => `https://github.com/${repo}`;

export const publishedPlugins = (doc) =>
  (doc?.plugins ?? []).filter((p) => p.host === 'claude-code' && p.status === 'published');

export function buildCatalog({ registry, taxonomy, manifests }) {
  const canonical = registry.marketplace.id;
  const resolve = (ids = []) =>
    ids.map((id) => ({ id, name: taxonomy.capabilities[id].name, category: taxonomy.capabilities[id].category }));

  const products = Object.entries(registry.products)
    .map(([id, entry]) => {
      const base = {
        id,
        repository: entry.repository,
        repository_url: repoUrl(entry.repository),
        family: entry.family,
        described: entry.manifest_status === 'present',
      };
      const doc = manifests[id]?.doc;
      if (!doc) return base;

      // Derived, never authored: one source of truth for plugin distribution.
      const generated = publishedPlugins(doc).length > 0
        ? [{ channel: 'claude-code-marketplace', marketplace: canonical, plugins: publishedPlugins(doc).map((p) => p.name) }]
        : [];

      return {
        ...base,
        name: doc.name,
        description: doc.description,
        problem: doc.problem,
        user: doc.user,
        capabilities: {
          core: resolve(doc.capabilities.core),
          secondary: resolve(doc.capabilities.secondary ?? []),
        },
        interfaces: doc.interfaces,
        distribution: [...doc.distribution, ...generated],
        runtime: doc.runtime,
        license: doc.license,
        maturity: doc.maturity,
        plugins: doc.plugins ?? [],
        integrations: doc.integrations ?? [],
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const productsWith = (capabilityId) =>
    products
      .filter((p) => [...(p.capabilities?.core ?? []), ...(p.capabilities?.secondary ?? [])]
        .some((c) => c.id === capabilityId))
      .map((p) => p.id);

  return {
    schema: 'nextbridge.dev/catalog/v1',
    _generated: GENERATED,
    marketplace: {
      id: canonical,
      name: registry.marketplace.name,
      description: registry.marketplace.description ?? null,
      owner: registry.marketplace.owner,
      members: registry.marketplace.members,
    },
    families: Object.fromEntries(Object.entries(registry.families).map(([id, f]) => [
      id, { ...f, products: products.filter((p) => p.family === id).map((p) => p.id) },
    ])),
    products,
    categories: Object.fromEntries(Object.entries(taxonomy.categories).map(([id, c]) => [
      id,
      {
        ...c,
        capabilities: Object.entries(taxonomy.capabilities)
          .filter(([, v]) => v.category === id).map(([k]) => k).sort(),
      },
    ])),
    capabilities: Object.fromEntries(Object.entries(taxonomy.capabilities).map(([id, c]) => [
      id, { ...c, products: productsWith(id) },
    ])),
    // Empty, and valid. See rules R-REF5 and R-REF6.
    integrations: registry.integrations,
    solutions: registry.solutions,
  };
}

/**
 * The canonical Claude Code marketplace.
 *
 * Field choices are verified against the official documentation; see
 * docs/CLAUDE-PLUGIN-SCHEMA-VERIFICATION.md. Deliberately omitted:
 *  - `version`: setting it pins the plugin, and plugin.json wins anyway (D1)
 *  - component path overrides: `strict` defaults to true, so plugin.json stays
 *    the authority for what a plugin contains (D3)
 *  - `displayName`: a marketplace displayName overrides the product's own
 */
export function buildMarketplace({ registry, manifests }) {
  const plugins = registry.marketplace.members.map(({ product, plugin }) => {
    const entry = registry.products[product];
    const doc = manifests[product].doc;
    const declared = (doc.plugins ?? []).find((p) => p.name === plugin);

    const source = declared.path === '.'
      ? { source: 'github', repo: entry.repository }
      : { source: 'git-subdir', url: entry.repository, path: declared.path.replace(/^\.\//, '') };

    return {
      name: plugin,
      source,
      description: doc.description.short.trim(),
      author: registry.marketplace.owner,
      homepage: `${repoUrl(entry.repository)}#readme`,
      repository: repoUrl(entry.repository),
      license: doc.license,
    };
  });

  return {
    name: registry.marketplace.id,
    owner: registry.marketplace.owner,
    description: registry.marketplace.description?.trim(),
    plugins,
  };
}
