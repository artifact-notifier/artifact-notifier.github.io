import { t } from '../i18n/notifications.i18n';

export interface DigestLine {
  ecosystem: string;
  coordinates: string;
  version: string;
}

/** `project` null: follows outside any project. */
export interface DigestGroup {
  project: string | null;
  items: DigestLine[];
}

const key = (ecosystem: string, coordinates: string) => `${ecosystem}:${coordinates}`;

/** Project names using each artifact ("ecosystem:coordinates"), for one user. */
export type ProjectsByArtifact = Map<string, string[]>;

export function projectsOf(projects: ProjectsByArtifact, line: { ecosystem: string; coordinates: string }): string[] {
  return projects.get(key(line.ecosystem, line.coordinates)) ?? [];
}

export function indexProjects(
  sources: { ecosystem: string; project: { name: string }; dependencies: { coordinates: string }[] }[],
): ProjectsByArtifact {
  const index: ProjectsByArtifact = new Map();
  for (const s of sources) {
    for (const d of s.dependencies) {
      const k = key(s.ecosystem, d.coordinates);
      const names = index.get(k) ?? [];
      if (!names.includes(s.project.name)) index.set(k, [...names, s.project.name]);
    }
  }
  return index;
}

/**
 * Lines grouped by project (sorted by name), each line under every project
 * using it, then the lines outside any project. Without projects: one group.
 */
export function groupByProject(lines: DigestLine[], projects: ProjectsByArtifact): DigestGroup[] {
  const groups = new Map<string, DigestLine[]>();
  const outside: DigestLine[] = [];
  for (const line of lines) {
    const names = projectsOf(projects, line);
    if (!names.length) outside.push(line);
    for (const name of names) groups.set(name, [...(groups.get(name) ?? []), line]);
  }
  return [
    ...[...groups.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((project) => ({ project, items: groups.get(project)! })),
    ...(outside.length ? [{ project: null, items: outside }] : []),
  ];
}

/** Group title, none when the digest has a single group outside projects (no projects at all). */
export function digestHeading(group: DigestGroup, groups: DigestGroup[], locale?: string): string | null {
  if (group.project) return `📁 ${group.project}`;
  return groups.length > 1 ? t(locale, 'digestNoProject') : null;
}
