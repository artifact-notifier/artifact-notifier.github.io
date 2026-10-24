import { DepScope, LockResult, ManifestResult, ParsedDependency, clean } from './model';

const GROUPS: [string, DepScope][] = [
  ['dependencies', 'prod'],
  ['devDependencies', 'dev'],
  ['peerDependencies', 'peer'],
  ['optionalDependencies', 'optional'],
];

// workspace/file/git/url/tarball specs: not a registry package
const NON_REGISTRY =
  /^(workspace:|file:|link:|portal:|patch:|exec:|git\+|git:|github:|gitlab:|bitbucket:|https?:|ssh:|\.{0,2}\/)/;
const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+(#.*)?$/;
const EXACT = /^v?\d+\.\d+\.\d+([-+][\w.-]+)?$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Reads the name/spec maps of a package.json-like object. */
function directDeps(pkg: Record<string, unknown>, file: string): ManifestResult {
  const dependencies: ParsedDependency[] = [];
  const warnings: string[] = [];
  for (const [field, scope] of GROUPS) {
    for (const [name, rawSpec] of Object.entries(asRecord(pkg[field]))) {
      let coordinates = name;
      let spec = String(rawSpec).trim();
      // "alias": "npm:real-name@^1.0.0"
      const alias = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@(.*))?$/.exec(spec);
      if (alias) {
        coordinates = alias[1];
        spec = alias[2] ?? '*';
      }
      if (NON_REGISTRY.test(spec) || GITHUB_SHORTHAND.test(spec)) {
        warnings.push(`${file}: ${name} is not a registry package (${spec}), skipped`);
        continue;
      }
      dependencies.push({
        ecosystem: 'NPM',
        coordinates,
        declared: spec || '*',
        ...(EXACT.test(spec) ? { version: spec.replace(/^v/, '') } : {}),
        scope,
      });
    }
  }
  return { dependencies, warnings };
}

export function parsePackageJson(content: string, file: string): ManifestResult {
  return directDeps(asRecord(JSON.parse(clean(content))), file);
}

/** package-lock.json / npm-shrinkwrap.json (v1 versions only; v2/v3 also know the direct deps). */
export function parsePackageLock(content: string, file: string): LockResult {
  const lock = asRecord(JSON.parse(clean(content)));
  const packages = asRecord(lock['packages']);
  if (Object.keys(packages).length) {
    const versionFor = (dep: ParsedDependency) => {
      const entry = asRecord(packages[`node_modules/${dep.coordinates}`]);
      return typeof entry['version'] === 'string' ? entry['version'] : undefined;
    };
    const root = directDeps(asRecord(packages['']), file);
    // the lock is authoritative for the installed version, and for aliases' real names
    for (const d of root.dependencies) d.version = versionFor(d) ?? d.version;
    return { versionFor, standalone: root };
  }
  const deps = asRecord(lock['dependencies']);
  return {
    versionFor: (dep) => {
      const version = asRecord(deps[dep.coordinates])['version'];
      return typeof version === 'string' ? version : undefined;
    },
  };
}

/** yarn.lock, classic (v1) and berry: versions only, matched on "name@range" keys. */
export function parseYarnLock(content: string): LockResult {
  const bySpec = new Map<string, string>();
  const byName = new Map<string, Set<string>>();
  let keys: string[] = [];
  for (const line of clean(content).split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line) && line.trimEnd().endsWith(':')) {
      keys = line
        .trimEnd()
        .slice(0, -1)
        .split(',')
        .map((k) => k.trim().replace(/^"|"$/g, ''))
        .filter((k) => k && k !== '__metadata');
      continue;
    }
    const version = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (!version) continue;
    for (const key of keys) {
      const at = key.lastIndexOf('@');
      if (at <= 0) continue;
      const name = key.slice(0, at);
      const range = key.slice(at + 1).replace(/^npm:/, '');
      bySpec.set(`${name}@${range}`, version[1]);
      byName.set(name, (byName.get(name) ?? new Set()).add(version[1]));
    }
    keys = [];
  }
  return {
    versionFor: (dep) => {
      const exact = bySpec.get(`${dep.coordinates}@${dep.declared ?? ''}`);
      if (exact) return exact;
      const versions = byName.get(dep.coordinates);
      return versions?.size === 1 ? [...versions][0] : undefined;
    },
  };
}

/** pnpm-lock.yaml (v5 to v9): the root importer gives the direct deps and their versions. */
export async function parsePnpmLock(content: string, file: string): Promise<LockResult> {
  const { parse } = await import('yaml');
  const doc = asRecord(parse(clean(content)));
  const root = asRecord(asRecord(doc['importers'])['.'] ?? doc);
  const specifiers = asRecord(root['specifiers']);
  const versions = new Map<string, string>();
  const dependencies: ParsedDependency[] = [];
  const warnings: string[] = [];
  for (const [field, scope] of GROUPS) {
    for (const [name, raw] of Object.entries(asRecord(root[field]))) {
      const entry = asRecord(raw);
      const rawVersion = String(typeof raw === 'string' ? raw : (entry['version'] ?? ''));
      const declared = String(entry['specifier'] ?? specifiers[name] ?? '') || undefined;
      if (/^(link:|file:|workspace:)/.test(rawVersion)) {
        warnings.push(`${file}: ${name} is not a registry package (${rawVersion}), skipped`);
        continue;
      }
      // "1.2.3(react@18.2.0)" (v6+) / "1.2.3_react@18.2.0" (v5)
      const version = rawVersion.split('(')[0].split('_')[0] || undefined;
      if (version) versions.set(name, version);
      dependencies.push({ ecosystem: 'NPM', coordinates: name, declared, version, scope });
    }
  }
  return { versionFor: (dep) => versions.get(dep.coordinates), standalone: { dependencies, warnings } };
}
