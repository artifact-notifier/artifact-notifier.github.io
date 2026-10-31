/** Same matching as the backend (backend/src/artifacts/version-rules.ts), for the live preview. */

export interface VersionRule {
  type: 'include' | 'exclude';
  pattern: string;
}

export const MAX_VERSION_RULES = 20;
export const PATTERN_RE = /^[\w.*?+~-]{1,64}$/;

/** `*` any run of characters, `?` one character, case-insensitive. */
export function globMatches(pattern: string, version: string): boolean {
  const p = pattern.toLowerCase();
  const v = version.toLowerCase();
  let pi = 0;
  let vi = 0;
  let star = -1;
  let resume = 0;
  while (vi < v.length) {
    if (pi < p.length && (p[pi] === '?' || p[pi] === v[vi])) {
      pi++;
      vi++;
    } else if (pi < p.length && p[pi] === '*') {
      star = pi++;
      resume = vi;
    } else if (star >= 0) {
      pi = star + 1;
      vi = ++resume;
    } else {
      return false;
    }
  }
  while (p[pi] === '*') pi++;
  return pi === p.length;
}

/** No exclude rule matches, and one include rule does when there are some. */
export function matchesRules(version: string, rules: VersionRule[]): boolean {
  if (rules.some((r) => r.type === 'exclude' && globMatches(r.pattern, version))) return false;
  const includes = rules.filter((r) => r.type === 'include');
  return !includes.length || includes.some((r) => globMatches(r.pattern, version));
}
