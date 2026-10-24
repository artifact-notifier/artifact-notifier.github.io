export type ImportEcosystem = 'NPM' | 'MAVEN' | 'PYPI';

// prod/parent/bom are checked by default in the UI; the others unchecked
export type DepScope =
  | 'prod'
  | 'dev'
  | 'optional'
  | 'peer'
  | 'test'
  | 'provided'
  | 'plugin'
  | 'parent'
  | 'bom'
  // another module of the same multi-module (Maven reactor) project: not worth following
  | 'module';

export interface ParsedDependency {
  ecosystem: ImportEcosystem;
  /** npm name | Maven "groupId:artifactId" | PyPI PEP 503 normalized name */
  coordinates: string;
  /** range/spec as written in the manifest */
  declared?: string;
  /** exact version used (lockfile, exact pin, Maven literal version) */
  version?: string;
  scope: DepScope;
}

export interface InputFile {
  path: string;
  content: string;
}

export interface ParsedSource {
  label: string;
  dir: string;
  kind: string;
  ecosystem: ImportEcosystem;
  files: string[];
  dependencies: ParsedDependency[];
  warnings: string[];
}

export interface ParseResult {
  sources: ParsedSource[];
  errors: { path: string; message: string }[];
  ignored: string[];
}

/** Direct dependencies read from a manifest (or a lockfile able to tell them). */
export interface ManifestResult {
  dependencies: ParsedDependency[];
  warnings: string[];
  /** coordinates of the artifact this manifest builds (Maven), to spot sibling modules */
  self?: string;
}

/** What a lockfile brings: exact versions, and the direct dependencies when it knows them. */
export interface LockResult {
  versionFor(dep: ParsedDependency): string | undefined;
  /** set only for lockfiles that can tell direct dependencies (usable without their manifest) */
  standalone?: ManifestResult;
}

const SCOPE_RANK: DepScope[] = [
  'prod',
  'parent',
  'bom',
  'peer',
  'optional',
  'provided',
  'dev',
  'test',
  'plugin',
  'module',
];

/** Splits "a/b/c.json" into ['a/b', 'c.json']. */
export function splitPath(path: string): { dir: string; name: string } {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const i = p.lastIndexOf('/');
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
}

/** Removes the BOM and normalizes line endings. */
export function clean(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** PEP 503 name normalization. */
export function normalizePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** Keeps one entry per coordinates, with the most important scope and the most precise versions. */
export function dedupe(deps: ParsedDependency[]): ParsedDependency[] {
  const byCoords = new Map<string, ParsedDependency>();
  for (const d of deps) {
    const prev = byCoords.get(d.coordinates);
    if (!prev) {
      byCoords.set(d.coordinates, { ...d });
      continue;
    }
    const [main, other] = SCOPE_RANK.indexOf(d.scope) < SCOPE_RANK.indexOf(prev.scope) ? [{ ...d }, prev] : [prev, d];
    main.declared ??= other.declared;
    main.version ??= other.version;
    byCoords.set(d.coordinates, main);
  }
  return [...byCoords.values()];
}

/** A short message for parse errors. */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0].slice(0, 200);
}
