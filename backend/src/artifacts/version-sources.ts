import { Ecosystem } from '@prisma/client';

export interface PublishedVersion {
  version: string;
  publishedAt?: Date;
}

const TIMEOUT_MS = 10000;
// crates.io asks API clients to identify themselves
export const CRATES_USER_AGENT = 'artifact-notifier (https://github.com/artifact-notifier)';

const GO_PROXY = 'https://proxy.golang.org';
const GO_PSEUDO_VERSION = /(?:^|[.-])\d{14}-[0-9a-f]{12}$/;

/** Pseudo-versions (v0.0.0-20230101120000-abcdef123456) are untagged commits, not releases. */
export function isGoPseudoVersion(version: string): boolean {
  return GO_PSEUDO_VERSION.test(version.split('+')[0]);
}

/** Module proxy path escaping: uppercase letters become "!" + lowercase. */
export function escapeGoModulePath(path: string): string {
  return path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

/** sparse index path: 1/a, 2/ab, 3/a/abc, ab/cd/abcd… (lowercase). */
export function crateIndexPath(name: string): string {
  const n = name.toLowerCase();
  if (n.length <= 2) return `${n.length}/${n}`;
  if (n.length === 3) return `3/${n[0]}/${n}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
}

/** Full version list from repo1 maven-metadata.xml (no per-version dates). Coordinates: `group:artifact`. */
export async function fetchMavenVersions(coordinates: string): Promise<PublishedVersion[] | null> {
  const [g, a] = coordinates.split(':');
  if (!g || !a) return null;
  const url = `https://repo1.maven.org/maven2/${g.replace(/\./g, '/')}/${encodeURIComponent(a)}/maven-metadata.xml`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`maven-metadata.xml ${res.status} ${res.statusText} for ${coordinates}`);
  const xml = await res.text();
  return [...xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)].map((m) => ({ version: m[1] }));
}

/**
 * Every published version of an npm package. Uses the abbreviated metadata
 * (install manifests only, no readme/time): the full packument of busy packages
 * weighs tens of MB. Publish dates are therefore unknown (detection time is used).
 */
export async function fetchNpmVersions(pkg: string): Promise<PublishedVersion[] | null> {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`npm registry ${res.status} ${res.statusText} for ${pkg}`);
  const json = await res.json();
  return Object.keys(json.versions ?? {}).map((version) => ({ version }));
}

export async function fetchPypiVersions(name: string): Promise<PublishedVersion[] | null> {
  const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`PyPI ${res.status} ${res.statusText} for ${name}`);
  const json = await res.json();
  return Object.entries<any[]>(json.releases ?? {}).map(([version, files]) => {
    const t = files?.[0]?.upload_time_iso_8601;
    return { version, publishedAt: t ? new Date(t) : undefined };
  });
}

/**
 * Tagged versions of a Go module: the proxy's list (no dates), plus @latest which
 * makes the proxy look the origin up again and carries the date of that version.
 */
export async function fetchGoVersions(modulePath: string): Promise<PublishedVersion[] | null> {
  const base = `${GO_PROXY}/${escapeGoModulePath(modulePath)}/@`;
  const [list, latest] = await Promise.all([
    fetch(`${base}v/list`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    fetch(`${base}latest`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
  ]);
  if (!list.ok) throw new Error(`Go proxy ${list.status} ${list.statusText} for ${modulePath}`);
  const versions: PublishedVersion[] = (await list.text())
    .split('\n')
    .map((v) => v.trim())
    .filter((v) => v && !isGoPseudoVersion(v))
    .map((version) => ({ version }));
  if (latest.ok) {
    // a bonus over the list: ignored when unreadable
    const info = ((await latest.json().catch(() => ({}))) ?? {}) as { Version?: string; Time?: string };
    if (info.Version && !isGoPseudoVersion(info.Version)) {
      const dated = { version: info.Version, publishedAt: info.Time ? new Date(info.Time) : undefined };
      return [...versions.filter((v) => v.version !== info.Version), dated];
    }
  }
  return versions;
}

/** Every non-yanked version of a crate, from the sparse index (a CDN, no rate limit). */
export async function fetchCargoVersions(name: string): Promise<PublishedVersion[] | null> {
  const res = await fetch(`https://index.crates.io/${crateIndexPath(name)}`, {
    headers: { 'User-Agent': CRATES_USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`crates.io index ${res.status} ${res.statusText} for ${name}`);
  return (await res.text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { vers: string; yanked?: boolean; pubtime?: string })
    .filter((v) => !v.yanked)
    .map((v) => ({ version: v.vers, publishedAt: v.pubtime ? new Date(v.pubtime) : undefined }));
}

export async function fetchAllVersions(ecosystem: Ecosystem, coordinates: string): Promise<PublishedVersion[] | null> {
  switch (ecosystem) {
    case Ecosystem.MAVEN:
      return fetchMavenVersions(coordinates);
    case Ecosystem.NPM:
      return fetchNpmVersions(coordinates);
    case Ecosystem.PYPI:
      return fetchPypiVersions(coordinates);
    case Ecosystem.GO:
      return fetchGoVersions(coordinates);
    case Ecosystem.CARGO:
      return fetchCargoVersions(coordinates);
    default:
      return null;
  }
}
