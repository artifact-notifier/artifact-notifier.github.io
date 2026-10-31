import { parse as parseToml } from 'smol-toml';
import { DepScope, LockResult, ManifestResult, ParsedDependency, clean } from './model';

type Table = Record<string, unknown>;

function table(value: unknown): Table {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Table) : {};
}

/** `name = "1.2"` or `name = { version, package, path, git, optional, workspace }`. */
function collect(
  entries: unknown,
  scope: DepScope,
  file: string,
  dependencies: ParsedDependency[],
  warnings: string[],
) {
  for (const [key, raw] of Object.entries(table(entries))) {
    const spec = typeof raw === 'string' ? { version: raw } : table(raw);
    const name = (typeof spec['package'] === 'string' ? spec['package'] : key).toLowerCase();
    if (spec['git']) {
      warnings.push(`${file}: ${key} comes from git, skipped`);
      continue;
    }
    const declared = typeof spec['version'] === 'string' ? spec['version'].trim() : undefined;
    // "=1.2.3" pins an exact version
    const exact = declared && /^=\s*\d/.test(declared) ? declared.replace(/^=\s*/, '') : undefined;
    dependencies.push({
      ecosystem: 'CARGO',
      coordinates: name,
      ...(declared ? { declared } : {}),
      ...(exact ? { version: exact } : {}),
      // a crate of the same workspace (path dependency) is internal
      scope: spec['path'] ? 'module' : spec['optional'] === true && scope === 'prod' ? 'optional' : scope,
    });
  }
}

/** One dependency group of a table: [dependencies], [dev-dependencies], [build-dependencies]. */
function groups(t: Table, file: string, dependencies: ParsedDependency[], warnings: string[]) {
  collect(t['dependencies'], 'prod', file, dependencies, warnings);
  collect(t['dev-dependencies'], 'dev', file, dependencies, warnings);
  collect(t['build-dependencies'], 'dev', file, dependencies, warnings);
}

/** Cargo.toml: package and per-target dependencies, plus [workspace.dependencies] of a workspace root. */
export function parseCargoToml(content: string, file: string): ManifestResult {
  const doc = parseToml(clean(content)) as Table;
  const dependencies: ParsedDependency[] = [];
  const warnings: string[] = [];
  groups(doc, file, dependencies, warnings);
  for (const target of Object.values(table(doc['target']))) groups(table(target), file, dependencies, warnings);
  collect(table(doc['workspace'])['dependencies'], 'prod', file, dependencies, warnings);
  const name = table(doc['package'])['name'];
  return { dependencies, warnings, self: typeof name === 'string' ? name.toLowerCase() : undefined };
}

/** Leading "major.minor" of a requirement ("^1.2", "~0.4.1", "1"), for caret compatibility. */
function compatible(declared: string | undefined, version: string): boolean {
  const req = /(\d+)(?:\.(\d+))?/.exec(declared ?? '');
  if (!req) return false;
  const [major, minor] = version.split('.');
  return req[1] === '0' ? major === '0' && req[2] === minor : major === req[1];
}

/**
 * Cargo.lock: registry packages. A crate may be locked at several versions (one
 * per semver-incompatible requirement): the one compatible with the declared requirement wins.
 */
export function parseCargoLock(content: string): LockResult {
  const packages = (parseToml(clean(content)) as Table)['package'];
  const versions = new Map<string, string[]>();
  for (const p of Array.isArray(packages) ? packages.map(table) : []) {
    const source = p['source'];
    if (typeof source !== 'string' || !/^(registry|sparse)\+/.test(source)) continue;
    const name = String(p['name']).toLowerCase();
    versions.set(name, [...(versions.get(name) ?? []), String(p['version'])]);
  }
  return {
    versionFor(dep) {
      const candidates = versions.get(dep.coordinates) ?? [];
      if (candidates.length <= 1) return candidates[0];
      const matching = candidates.filter((v) => compatible(dep.declared, v));
      return matching.length === 1 ? matching[0] : undefined;
    },
  };
}
