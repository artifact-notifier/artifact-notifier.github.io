/**
 * Dependency scopes, most relevant first (internal modules last). Kept out of
 * the import page's lazy chunk: the project page sorts with it too.
 */
export const SCOPE_ORDER = [
  'parent',
  'bom',
  'prod',
  'peer',
  'optional',
  'provided',
  'dev',
  'test',
  'plugin',
  'module',
] as const;

export function scopeRank(scope: string): number {
  const i = (SCOPE_ORDER as readonly string[]).indexOf(scope);
  return i < 0 ? SCOPE_ORDER.length : i;
}
