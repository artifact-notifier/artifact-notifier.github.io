/**
 * Per-follow version filters: glob patterns (`*` any run of characters, `?` one
 * character, case-insensitive) rather than user regexes, which would expose the
 * server to catastrophic backtracking.
 */

export type VersionRuleType = 'include' | 'exclude';

export interface VersionRule {
  type: VersionRuleType;
  pattern: string;
}

export const MAX_VERSION_RULES = 20;
export const MAX_PATTERN_LENGTH = 64;
export const PATTERN_RE = /^[\w.*?+~-]+$/;

/** Iterative wildcard match, O(pattern × version): backtracks only to the last `*`. */
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

/**
 * Excluded by any exclude rule: no. Otherwise, with include rules, the version
 * must match one of them. Without rules, everything passes.
 */
export function matchesRules(version: string, rules: VersionRule[]): boolean {
  if (rules.some((r) => r.type === 'exclude' && globMatches(r.pattern, version))) return false;
  const includes = rules.filter((r) => r.type === 'include');
  return !includes.length || includes.some((r) => globMatches(r.pattern, version));
}

/** Column value -> rules; anything unreadable counts as no rule. */
export function parseRules(json: string | null | undefined): VersionRule[] {
  if (!json) return [];
  try {
    const rules = JSON.parse(json);
    return Array.isArray(rules)
      ? rules.filter((r) => (r?.type === 'include' || r?.type === 'exclude') && typeof r.pattern === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Rules -> column value (null when empty). */
export function serializeRules(rules: VersionRule[]): string | null {
  return rules.length ? JSON.stringify(rules.map(({ type, pattern }) => ({ type, pattern }))) : null;
}
