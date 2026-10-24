import { parse as parseToml } from 'smol-toml';
import { DepScope, LockResult, ManifestResult, ParsedDependency, clean, normalizePypi } from './model';

type Table = Record<string, unknown>;

function table(value: unknown): Table {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Table) : {};
}

function exactPin(spec: string | undefined): string | undefined {
  const m = spec && /^===?\s*([^\s,*;]+)$/.exec(spec.trim());
  return m ? m[1] : undefined;
}

function dep(name: string, scope: DepScope, declared?: string, version?: string): ParsedDependency {
  return {
    ecosystem: 'PYPI',
    coordinates: normalizePypi(name),
    ...(declared ? { declared } : {}),
    ...(version ? { version } : {}),
    scope,
  };
}

/**
 * One PEP 508 requirement ("name[extra] >=1,<2 ; python_version < '3.11'").
 * Returns a warning string for direct URL references.
 */
function requirement(line: string, scope: DepScope, file: string): ParsedDependency | string | undefined {
  const req = line.split(';')[0].trim();
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(req);
  if (!m) return undefined;
  const [, name, , rest] = m;
  if (rest.startsWith('@')) return `${file}: ${name} is a direct URL reference, skipped`;
  const spec = rest.replace(/^\((.*)\)$/, '$1').trim();
  return dep(name, scope, spec || undefined, exactPin(spec));
}

function collect(lines: unknown, scope: DepScope, file: string, dependencies: ParsedDependency[], warnings: string[]) {
  if (!Array.isArray(lines)) return;
  for (const line of lines) {
    if (typeof line !== 'string') continue; // e.g. { include-group = "..." }
    const r = requirement(line, scope, file);
    if (typeof r === 'string') warnings.push(r);
    else if (r) dependencies.push(r);
  }
}

/** requirements*.txt (dev scope when the file name says dev/test). */
export function parseRequirements(content: string, file: string): ManifestResult {
  const scope: DepScope = /(dev|test)/i.test(file.split('/').pop() ?? '') ? 'dev' : 'prod';
  const dependencies: ParsedDependency[] = [];
  const warnings: string[] = [];
  const lines = clean(content).replace(/\\\n/g, ' ').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    if (/^(-r|-c|--requirement|--constraint)\b/.test(line)) {
      warnings.push(`${file}: included file not followed (${line})`);
      continue;
    }
    // editable installs, local paths, VCS and archive URLs
    if (/^(-e|--editable)\b/.test(line) || /^(\.|\/|[a-z][\w+.-]*:\/\/|git\+)/i.test(line)) {
      warnings.push(`${file}: ${line} is not a registry package, skipped`);
      continue;
    }
    if (line.startsWith('-')) continue; // --index-url and other options
    const r = requirement(line, scope, file);
    if (typeof r === 'string') warnings.push(r);
    else if (r) dependencies.push(r);
  }
  return { dependencies, warnings };
}

/** Poetry/Pipfile style table: { name = "^1.2" | { version = "...", git = ... } }. */
function specTable(
  entries: unknown,
  scope: DepScope,
  file: string,
  dependencies: ParsedDependency[],
  warnings: string[],
  { bareIsExact }: { bareIsExact: boolean },
) {
  for (const [name, raw] of Object.entries(table(entries))) {
    if (name.toLowerCase() === 'python') continue;
    const spec = typeof raw === 'string' ? raw : table(raw)['version'];
    if (typeof spec !== 'string') {
      const t = table(raw);
      if (t['git'] || t['path'] || t['url'] || t['file']) {
        warnings.push(`${file}: ${name} is not a registry package, skipped`);
        continue;
      }
      dependencies.push(dep(name, scope));
      continue;
    }
    // Poetry: a bare "1.2.3" means ==1.2.3
    const bare = bareIsExact && /^\d[\w.!+-]*$/.test(spec.trim()) ? spec.trim() : undefined;
    dependencies.push(dep(name, scope, spec.trim() === '*' ? '*' : spec.trim(), bare ?? exactPin(spec)));
  }
}

/** pyproject.toml: PEP 621 [project], PEP 735 [dependency-groups] and Poetry tables. */
export function parsePyproject(content: string, file: string): ManifestResult {
  const doc = parseToml(clean(content)) as Table;
  const dependencies: ParsedDependency[] = [];
  const warnings: string[] = [];
  const project = table(doc['project']);
  collect(project['dependencies'], 'prod', file, dependencies, warnings);
  for (const group of Object.values(table(project['optional-dependencies']))) {
    collect(group, 'optional', file, dependencies, warnings);
  }
  for (const group of Object.values(table(doc['dependency-groups']))) {
    collect(group, 'dev', file, dependencies, warnings);
  }
  const poetry = table(table(doc['tool'])['poetry']);
  specTable(poetry['dependencies'], 'prod', file, dependencies, warnings, { bareIsExact: true });
  specTable(poetry['dev-dependencies'], 'dev', file, dependencies, warnings, { bareIsExact: true });
  for (const group of Object.values(table(poetry['group']))) {
    specTable(table(group)['dependencies'], 'dev', file, dependencies, warnings, { bareIsExact: true });
  }
  return { dependencies, warnings };
}

/** Pipfile: [packages] and [dev-packages]. */
export function parsePipfile(content: string, file: string): ManifestResult {
  const doc = parseToml(clean(content)) as Table;
  const dependencies: ParsedDependency[] = [];
  const warnings: string[] = [];
  specTable(doc['packages'], 'prod', file, dependencies, warnings, { bareIsExact: false });
  specTable(doc['dev-packages'], 'dev', file, dependencies, warnings, { bareIsExact: false });
  return { dependencies, warnings };
}

function versionMap(entries: Iterable<[string, unknown]>): LockResult['versionFor'] {
  const versions = new Map<string, string>();
  for (const [name, version] of entries) {
    if (typeof version === 'string') versions.set(normalizePypi(name), version.replace(/^==/, ''));
  }
  return (d) => versions.get(d.coordinates);
}

/** poetry.lock: versions only. */
export function parsePoetryLock(content: string): LockResult {
  const packages = (parseToml(clean(content)) as Table)['package'];
  const list = Array.isArray(packages) ? packages.map(table) : [];
  return { versionFor: versionMap(list.map((p) => [String(p['name']), p['version']])) };
}

/** Pipfile.lock (JSON): versions only. */
export function parsePipfileLock(content: string): LockResult {
  const doc = table(JSON.parse(clean(content)));
  const entries = ['default', 'develop'].flatMap((g) =>
    Object.entries(table(doc[g])).map(([name, v]): [string, unknown] => [name, table(v)['version']]),
  );
  return { versionFor: versionMap(entries) };
}

/** uv.lock: versions, plus the direct deps of the root package (editable/virtual ".") when present. */
export function parseUvLock(content: string): LockResult {
  const packages = (parseToml(clean(content)) as Table)['package'];
  const list = Array.isArray(packages) ? packages.map(table) : [];
  const versionFor = versionMap(list.map((p) => [String(p['name']), p['version']]));
  const root = list.find((p) => {
    const source = table(p['source']);
    return source['editable'] === '.' || source['virtual'] === '.';
  });
  if (!root) return { versionFor };

  const dependencies: ParsedDependency[] = [];
  const add = (refs: unknown, scope: DepScope) => {
    for (const ref of Array.isArray(refs) ? refs.map(table) : []) {
      if (typeof ref['name'] !== 'string') continue;
      const d = dep(ref['name'], scope);
      d.version = versionFor(d);
      dependencies.push(d);
    }
  };
  add(root['dependencies'], 'prod');
  for (const group of Object.values(table(root['optional-dependencies']))) add(group, 'optional');
  for (const group of Object.values(table(root['dev-dependencies']))) add(group, 'dev');
  return { versionFor, standalone: { dependencies, warnings: [] } };
}
