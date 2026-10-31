/** Registries the app follows (the dev-only TEST ecosystem aside), in display order. */
export const REGISTRY_ECOSYSTEMS = ['NPM', 'MAVEN', 'PYPI', 'GO', 'CARGO'] as const;

export type Ecosystem = (typeof REGISTRY_ECOSYSTEMS)[number] | 'TEST';

const LABELS: Record<Ecosystem, string> = {
  NPM: 'npm',
  MAVEN: 'Maven',
  PYPI: 'PyPI',
  GO: 'Go',
  CARGO: 'Cargo',
  TEST: 'TEST',
};

export function ecoLabel(e: string): string {
  return LABELS[e as Ecosystem] ?? e;
}
