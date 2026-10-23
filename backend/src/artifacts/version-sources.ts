import { Ecosystem } from '@prisma/client';

export interface PublishedVersion {
  version: string;
  publishedAt?: Date;
}

const TIMEOUT_MS = 10000;

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

export async function fetchAllVersions(
  ecosystem: Ecosystem,
  coordinates: string,
): Promise<PublishedVersion[] | null> {
  switch (ecosystem) {
    case Ecosystem.MAVEN:
      return fetchMavenVersions(coordinates);
    case Ecosystem.NPM:
      return fetchNpmVersions(coordinates);
    case Ecosystem.PYPI:
      return fetchPypiVersions(coordinates);
    default:
      return null;
  }
}
