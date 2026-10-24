import { Injectable, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { ApiConfigService } from '../core/api-config.service';
import { AuthService } from '../core/auth.service';
import { valueOrUndefined } from '../shared/resource-value';

type ProjectEcosystem = 'NPM' | 'MAVEN' | 'PYPI';

export interface ProjectDependency {
  coordinates: string;
  declared: string | null;
  version: string | null;
  scope: string;
  followedArtifactId: string | null;
  latestVersion: string | null;
  /** an exact used version older than the latest one */
  outdated: boolean;
}
export interface ProjectSource {
  id: string;
  label: string;
  kind: string;
  ecosystem: ProjectEcosystem;
  updatedAt: string;
  dependencies: ProjectDependency[];
}
export interface Project {
  id: string;
  name: string;
  notifyNewerOnly: boolean;
  createdAt: string;
  sources: ProjectSource[];
}

export interface ImportRequest {
  projectId?: string;
  projectName?: string;
  sources: {
    label: string;
    kind: string;
    ecosystem: ProjectEcosystem;
    dependencies: { coordinates: string; declared?: string; version?: string; scope: string }[];
  }[];
  follow: { ecosystem: ProjectEcosystem; coordinates: string }[];
}
/** Follows no project uses any more after a change: offered for unfollowing. */
export interface Orphan {
  followedArtifactId: string;
  ecosystem: ProjectEcosystem;
  coordinates: string;
}
export interface ImportResult {
  projectId: string;
  followed: number;
  failed: { ecosystem: ProjectEcosystem; coordinates: string; reason: string }[];
  orphans: Orphan[];
}

/** "ecosystem:coordinates", the identity shared by follows and project dependencies. */
export const artifactKey = (ecosystem: string, coordinates: string) => `${ecosystem}:${coordinates}`;

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly api = inject(ApiConfigService);
  private readonly auth = inject(AuthService);

  readonly resource = httpResource<Project[]>(() =>
    this.auth.user() ? { url: this.api.apiUrl('/api/projects') } : undefined,
  );
  readonly projects = computed(() => valueOrUndefined(this.resource) ?? []);

  /** Artifact keys of each project (followed or not). */
  readonly keysByProject = computed(
    () =>
      new Map(
        this.projects().map((p) => [
          p.id,
          new Set(p.sources.flatMap((s) => s.dependencies.map((d) => artifactKey(s.ecosystem, d.coordinates)))),
        ]),
      ),
  );

  importProject(body: ImportRequest): Promise<ImportResult> {
    return this.send('POST', '/api/projects/import', body);
  }

  update(id: string, changes: { name?: string; notifyNewerOnly?: boolean }): Promise<Project> {
    return this.send('PATCH', `/api/projects/${id}`, changes);
  }

  remove(id: string): Promise<{ orphans: Orphan[] }> {
    return this.send('DELETE', `/api/projects/${id}`);
  }

  removeSource(id: string, sourceId: string): Promise<{ orphans: Orphan[] }> {
    return this.send('DELETE', `/api/projects/${id}/sources/${sourceId}`);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.api.apiUrl(path), {
      method,
      credentials: 'include',
      headers: { ...this.auth.authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: res.statusText }));
    this.resource.reload();
    return res.json();
  }
}
