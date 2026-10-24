import { Ecosystem } from '@prisma/client';

/**
 * Canonical artifact coordinates. PyPI names are case-insensitive and treat
 * "-", "_" and "." alike (PEP 503): "Django", "django" and "zope.interface" vs
 * "zope_interface" must map to one follow and match the RSS feed's display names.
 */
export function normalizeCoordinates(ecosystem: Ecosystem, coordinates: string): string {
  const c = coordinates.trim();
  return ecosystem === Ecosystem.PYPI ? c.toLowerCase().replace(/[-_.]+/g, '-') : c;
}
