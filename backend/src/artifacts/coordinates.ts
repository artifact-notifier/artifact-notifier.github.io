import { Ecosystem } from '@prisma/client';

/**
 * Canonical artifact coordinates. PyPI names are case-insensitive and treat
 * "-", "_" and "." alike (PEP 503): "Django", "django" and "zope.interface" vs
 * "zope_interface" must map to one follow and match the RSS feed's display names.
 * Crate names are case-insensitive (the sparse index is keyed by the lowercase
 * name); Go module paths are case-sensitive.
 */
export function normalizeCoordinates(ecosystem: Ecosystem, coordinates: string): string {
  const c = coordinates.trim();
  if (ecosystem === Ecosystem.PYPI) return c.toLowerCase().replace(/[-_.]+/g, '-');
  if (ecosystem === Ecosystem.CARGO) return c.toLowerCase();
  return c;
}
