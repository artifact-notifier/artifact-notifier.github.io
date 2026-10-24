import {
  ImportEcosystem,
  InputFile,
  LockResult,
  ManifestResult,
  ParseResult,
  ParsedSource,
  dedupe,
  errorMessage,
  splitPath,
} from './model';
import { parsePom } from './maven';
import { parsePackageJson, parsePackageLock, parsePnpmLock, parseYarnLock } from './npm';
import {
  parsePipfile,
  parsePipfileLock,
  parsePoetryLock,
  parsePyproject,
  parseRequirements,
  parseUvLock,
} from './pypi';

export type { DepScope, InputFile, ParseResult, ParsedDependency, ParsedSource } from './model';

interface ManifestType {
  kind: string;
  ecosystem: ImportEcosystem;
  matches(name: string): boolean;
  parse(content: string, path: string): ManifestResult;
}

interface LockType {
  name: string;
  ecosystem: ImportEcosystem;
  /** manifest kind it belongs to (gives the list of direct deps) */
  manifest: string;
  parse(content: string, path: string): LockResult | Promise<LockResult>;
}

const MANIFESTS: ManifestType[] = [
  { kind: 'package.json', ecosystem: 'NPM', matches: (n) => n === 'package.json', parse: parsePackageJson },
  { kind: 'pom.xml', ecosystem: 'MAVEN', matches: (n) => n === 'pom.xml', parse: parsePom },
  {
    kind: 'requirements.txt',
    ecosystem: 'PYPI',
    matches: (n) => /^requirements.*\.txt$/i.test(n),
    parse: parseRequirements,
  },
  { kind: 'pyproject.toml', ecosystem: 'PYPI', matches: (n) => n === 'pyproject.toml', parse: parsePyproject },
  { kind: 'Pipfile', ecosystem: 'PYPI', matches: (n) => n === 'Pipfile', parse: parsePipfile },
];

const LOCKS: LockType[] = [
  { name: 'package-lock.json', ecosystem: 'NPM', manifest: 'package.json', parse: parsePackageLock },
  { name: 'npm-shrinkwrap.json', ecosystem: 'NPM', manifest: 'package.json', parse: parsePackageLock },
  { name: 'yarn.lock', ecosystem: 'NPM', manifest: 'package.json', parse: parseYarnLock },
  { name: 'pnpm-lock.yaml', ecosystem: 'NPM', manifest: 'package.json', parse: parsePnpmLock },
  { name: 'poetry.lock', ecosystem: 'PYPI', manifest: 'pyproject.toml', parse: parsePoetryLock },
  { name: 'uv.lock', ecosystem: 'PYPI', manifest: 'pyproject.toml', parse: parseUvLock },
  { name: 'Pipfile.lock', ecosystem: 'PYPI', manifest: 'Pipfile', parse: parsePipfileLock },
];

export function isSupportedFile(path: string): boolean {
  const { name } = splitPath(path);
  return MANIFESTS.some((m) => m.matches(name)) || LOCKS.some((l) => l.name === name);
}

interface ParsedManifest {
  path: string;
  dir: string;
  type: ManifestType;
  result: ManifestResult;
  locks: ParsedLock[];
}

interface ParsedLock {
  path: string;
  dir: string;
  type: LockType;
  result: LockResult;
}

/** Parses dropped manifests/lockfiles into sources of direct dependencies. Never throws. */
export async function parseProjectFiles(files: InputFile[]): Promise<ParseResult> {
  const result: ParseResult = { sources: [], errors: [], ignored: [] };
  const manifests: ParsedManifest[] = [];
  const locks: ParsedLock[] = [];

  await Promise.all(
    files.map(async ({ path, content }) => {
      const { dir, name } = splitPath(path);
      const manifest = MANIFESTS.find((m) => m.matches(name));
      const lock = LOCKS.find((l) => l.name === name);
      try {
        if (manifest) manifests.push({ path, dir, type: manifest, result: manifest.parse(content, path), locks: [] });
        else if (lock) locks.push({ path, dir, type: lock, result: await lock.parse(content, path) });
        else result.ignored.push(path);
      } catch (e) {
        result.errors.push({ path, message: errorMessage(e) });
      }
    }),
  );

  for (const lock of locks) {
    const candidates = manifests.filter((m) => m.dir === lock.dir && m.type.kind === lock.type.manifest);
    if (candidates.length === 1) {
      candidates[0].locks.push(lock);
    } else if (lock.result.standalone) {
      result.sources.push({
        label: lock.path,
        dir: lock.dir,
        kind: lock.type.name,
        ecosystem: lock.type.ecosystem,
        files: [lock.path],
        dependencies: dedupe(lock.result.standalone.dependencies),
        warnings: lock.result.standalone.warnings,
      });
    } else {
      result.errors.push({
        path: lock.path,
        message: candidates.length
          ? 'cannot tell which manifest this lockfile belongs to'
          : `${lock.type.name} only gives versions: add its ${lock.type.manifest} from the same folder`,
      });
    }
  }

  for (const m of manifests) result.sources.push(toSource(m));
  result.sources.sort((a, b) => a.label.localeCompare(b.label));
  result.errors.sort((a, b) => a.path.localeCompare(b.path));
  result.ignored.sort();
  return result;
}

/** A manifest's direct deps, with the versions of its paired lockfile(s). */
function toSource(m: ParsedManifest): ParsedSource {
  const warnings = [...m.result.warnings];
  const dependencies = dedupe(m.result.dependencies).map((d) => {
    const fromLock = m.locks.map((l) => l.result.versionFor(d)).find((v) => v !== undefined);
    if (fromLock) return { ...d, version: fromLock };
    if (m.locks.length && !d.version) {
      warnings.push(`${m.locks.map((l) => l.type.name).join(', ')}: no version found for ${d.coordinates}`);
    }
    return d;
  });
  return {
    label: m.path,
    dir: m.dir,
    kind: m.type.kind,
    ecosystem: m.type.ecosystem,
    files: [m.path, ...m.locks.map((l) => l.path)],
    dependencies,
    warnings,
  };
}
