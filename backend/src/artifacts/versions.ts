/**
 * Version ordering shared by all ecosystems (Maven ComparableVersion-like,
 * also correct for semver and the common PEP 440 forms).
 */

// Qualifier ranks, relative to a plain release (RELEASE_RANK).
const RELEASE_RANK = 6;
const QUALIFIER_RANKS: Record<string, number> = {
  dev: 0,
  snapshot: 0.5,
  nightly: 0.5,
  canary: 0.5,
  next: 0.5,
  ea: 0.5,
  alpha: 1,
  a: 1,
  beta: 2,
  b: 2,
  milestone: 3,
  m: 3,
  rc: 4,
  cr: 4,
  pre: 4,
  preview: 4,
  '': RELEASE_RANK,
  ga: RELEASE_RANK,
  final: RELEASE_RANK,
  release: RELEASE_RANK,
  sp: 7,
};
// Unknown qualifiers (post, jre, android…) sort after releases, lexically among themselves.
const UNKNOWN_RANK = 8;

const PRERELEASE_RE =
  /(?:^|[\d.\-_])(?:alpha|beta|milestone|rc|cr|pre|preview|snapshot|dev|ea|nightly|canary|next|incubating|m|a|b)(?:[.\-_]?\d+)?(?=$|[.\-_+])/;

type Token = number | string;

function tokenize(version: string): Token[] {
  return version
    .toLowerCase()
    .replace(/^v/, '')
    .split('+')[0]
    .split(/[.\-_]|(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/)
    .filter((t) => t !== '')
    .map((t) => (/^\d+$/.test(t) ? Number(t) : t));
}

function rank(q: string): number {
  return QUALIFIER_RANKS[q] ?? UNKNOWN_RANK;
}

function compareTokens(a: Token | undefined, b: Token | undefined): number {
  // A missing token is 0 next to a number, a plain release next to a qualifier.
  if (a === undefined) a = typeof b === 'number' ? 0 : '';
  if (b === undefined) b = typeof a === 'number' ? 0 : '';
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return 1;
  if (typeof b === 'number') return -1;
  const diff = rank(a) - rank(b);
  if (diff !== 0) return diff;
  return rank(a) === UNKNOWN_RANK ? a.localeCompare(b) : 0;
}

/** Negative if a < b, positive if a > b, 0 if equivalent. */
export function compareVersions(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const c = compareTokens(ta[i], tb[i]);
    if (c !== 0) return Math.sign(c);
  }
  return 0;
}

/** alpha, beta, milestone (M1), RC/CR, preview, SNAPSHOT, dev… */
export function isPrerelease(version: string): boolean {
  return PRERELEASE_RE.test(version.toLowerCase().split('+')[0]);
}

/** Highest version, stable first: prereleases only count if allowed or if nothing else exists. */
export function pickCurrentVersion(versions: string[], includePrereleases: boolean): string | null {
  const stable = includePrereleases ? versions : versions.filter((v) => !isPrerelease(v));
  const pool = stable.length ? stable : versions;
  if (!pool.length) return null;
  return pool.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
}
