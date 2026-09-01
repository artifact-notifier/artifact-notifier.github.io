import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '../core/api-config.service';
import { AuthService } from '../core/auth.service';

export interface Delivery { channel: string; status: string; sentAt: string | null; }
export interface FollowedArtifact {
  id: string;
  ecosystem: 'NPM' | 'MAVEN' | 'PYPI' | 'TEST';
  coordinates: string;
  currentVersion: string | null;
  events: { version: string; publishedAt: string; deliveries: Delivery[] }[];
}
export interface SearchResult { coordinates: string; description?: string; }
export type SyncStatus = Record<string, { lastSync: string | null; lastSeq?: string | null }>;

@Injectable({ providedIn: 'root' })
export class ArtifactsService {
  private readonly api = inject(ApiConfigService);
  private readonly auth = inject(AuthService);
  private url(path: string): string { return this.api.apiUrl(`/api/artifacts${path}`); }
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...this.auth.authHeaders(), ...extra };
  }

  async follow(ecosystem: string, coordinates: string): Promise<FollowedArtifact> {
    const res = await fetch(this.url('/follow'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ ecosystem, coordinates }),
    });
    if (!res.ok) throw { error: await res.json().catch(() => ({ message: res.statusText })) };
    return res.json();
  }

  async unfollow(id: string): Promise<void> {
    const res = await fetch(this.url(`/${id}`), { method: 'DELETE', credentials: 'include', headers: this.headers() });
    if (!res.ok) throw { error: await res.json().catch(() => ({ message: res.statusText })) };
  }

  // dev only: simulates a new version for a TEST artifact (full isolation)
  async simulateTestVersion(coordinates: string, version: string): Promise<any> {
    const res = await fetch(this.url('/test/simulate'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ coordinates, version }),
    });
    if (!res.ok) throw { error: await res.json().catch(() => ({ message: res.statusText })) };
    return res.json();
  }

  async bumpTestVersion(id: string, version: string): Promise<any> {
    const res = await fetch(this.url('/test/bump'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ id, version }),
    });
    if (!res.ok) throw { error: await res.json().catch(() => ({ message: res.statusText })) };
    return res.json();
  }
}
