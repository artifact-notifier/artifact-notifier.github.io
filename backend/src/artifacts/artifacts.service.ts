import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Ecosystem } from '@prisma/client';
import { fetchAllVersions } from './version-sources';
import { pickCurrentVersion } from './versions';

@Injectable()
export class ArtifactsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  isTestEnabled(): boolean {
    const nodeEnv = this.config.get<string>('NODE_ENV') || process.env.NODE_ENV;
    const flag = this.config.get<string>('ENABLE_TEST_MODE') || process.env.ENABLE_TEST_MODE;
    return nodeEnv !== 'production' || flag === 'true';
  }

  getAvailableEcosystems(): Ecosystem[] {
    const base: Ecosystem[] = [Ecosystem.NPM, Ecosystem.MAVEN, Ecosystem.PYPI];
    return this.isTestEnabled() ? [...base, Ecosystem.TEST] : base;
  }

  async follow(userId: string, ecosystem: Ecosystem, coordinates: string) {
    if (ecosystem === Ecosystem.TEST && !this.isTestEnabled()) {
      throw new BadRequestException('TEST ecosystem disabled in production');
    }
    const existing = await this.prisma.followedArtifact.findUnique({
      where: { userId_ecosystem_coordinates: { userId, ecosystem, coordinates } },
    });
    if (existing) return existing;

    const version = await this.resolveCurrentVersion(userId, ecosystem, coordinates);
    return this.prisma.followedArtifact.create({
      data: { userId, ecosystem, coordinates, currentVersion: version },
    });
  }

  async unfollow(userId: string, id: string) {
    const fa = await this.prisma.followedArtifact.findFirst({ where: { id, userId } });
    if (!fa) throw new NotFoundException('Followed artifact not found');
    return this.prisma.followedArtifact.delete({ where: { id } });
  }

  async list(userId: string) {
    return this.prisma.followedArtifact.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        events: {
          orderBy: { publishedAt: 'desc' },
          take: 5,
          include: { deliveries: { where: { userId }, orderBy: { sentAt: 'desc' } } },
        },
      },
    });
  }

  async search(ecosystem: Ecosystem, q: string) {
    if (!q || q.length < 2) return [];
    if (ecosystem === Ecosystem.TEST && !this.isTestEnabled()) return [];
    switch (ecosystem) {
      case 'NPM':
        return this.searchNpm(q);
      case 'MAVEN':
        return this.searchMaven(q);
      case 'PYPI':
        return this.searchPypi(q);
      case 'TEST':
        // Dev only: returns the input as-is to create a fake local artifact
        return [{ coordinates: q.trim(), description: 'TEST — artifact local (dev only)' }];
      default:
        return [];
    }
  }

  private async searchNpm(q: string): Promise<{ coordinates: string; description?: string }[]> {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    return (json.objects || []).map((o: any) => ({
      coordinates: o.package.name,
      description: o.package.description,
    }));
  }

  private async searchMaven(q: string): Promise<{ coordinates: string; description?: string }[]> {
    const res = await fetch('https://central.sonatype.com/api/internal/browse/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 0, size: 10, searchTerm: q, filter: [] }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    const components = json?.components || [];
    return components.map((c: any) => ({
      coordinates: `${c.namespace}:${c.name}`,
      description: c.description ?? c.latestVersionInfo?.version,
    }));
  }

  private async searchPypi(q: string): Promise<{ coordinates: string; description?: string }[]> {
    // PyPI JSON simple index search is not official; use the XML-RPC search as a fallback
    const url = `https://pypi.org/pypi/${encodeURIComponent(q)}/json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];
      const json = await res.json();
      return [{ coordinates: json.info.name, description: json.info.summary }];
    } catch {
      return [];
    }
  }

  /**
   * Highest version (stable unless the user wants prereleases). Also records every
   * existing version as known, so that only later publications trigger notifications.
   */
  private async resolveCurrentVersion(
    userId: string,
    ecosystem: Ecosystem,
    coordinates: string,
  ): Promise<string | null> {
    if (ecosystem === Ecosystem.TEST) return '1.0.0';
    try {
      const versions = (await fetchAllVersions(ecosystem, coordinates))?.map((v) => v.version) ?? [];
      await this.addKnownVersions(ecosystem, coordinates, versions);
      const prefs = await this.prisma.userPreferences.findUnique({ where: { userId } });
      return pickCurrentVersion(versions, prefs?.includePrereleases ?? false);
    } catch {
      return null;
    }
  }

  // ---- Used by listeners ----

  async getFollowedCoordinates(ecosystem: Ecosystem): Promise<Map<string, string[]>> {
    // coordinates -> list of followedArtifact ids (one per user)
    const rows = await this.prisma.followedArtifact.findMany({
      where: { ecosystem },
      select: {
        id: true,
        coordinates: true,
        currentVersion: true,
        userId: true,
        user: { select: { preferences: { select: { includePrereleases: true } } } },
      },
    });
    const map = new Map<
      string,
      { followedArtifactId: string; userId: string; currentVersion: string | null; includePrereleases: boolean }[]
    >();
    for (const r of rows) {
      const arr = map.get(r.coordinates) || [];
      arr.push({
        followedArtifactId: r.id,
        userId: r.userId,
        currentVersion: r.currentVersion,
        includePrereleases: r.user.preferences?.includePrereleases ?? false,
      });
      map.set(r.coordinates, arr);
    }
    return map as any;
  }

  async getKnownVersions(ecosystem: Ecosystem, coordinates: string): Promise<Set<string>> {
    const rows = await this.prisma.knownVersion.findMany({
      where: { ecosystem, coordinates },
      select: { version: true },
    });
    return new Set(rows.map((r) => r.version));
  }

  async addKnownVersions(ecosystem: Ecosystem, coordinates: string, versions: string[]) {
    if (!versions.length) return;
    // SQLite has no createMany skipDuplicates: upsert in one transaction
    await this.prisma.$transaction(
      [...new Set(versions)].map((version) =>
        this.prisma.knownVersion.upsert({
          where: { ecosystem_coordinates_version: { ecosystem, coordinates, version } },
          create: { ecosystem, coordinates, version },
          update: {},
        }),
      ),
    );
  }

  async markNewVersion(followedArtifactId: string, version: string) {
    return this.prisma.followedArtifact.update({
      where: { id: followedArtifactId },
      data: { currentVersion: version },
    });
  }

  async getSyncStatus() {
    const rows = await this.prisma.listenerSequence.findMany();
    const map: Record<string, string> = {};
    for (const r of rows) map[r.id] = r.value;
    // id = listenerName (e.g. MavenArtifactListener, NpmArtifactListener, PypiArtifactListener)
    const toIso = (v?: string) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isNaN(n) && n > 0) return new Date(n).toISOString();
      const d = Date.parse(v);
      return Number.isNaN(d) ? null : new Date(d).toISOString();
    };
    const npmTs = map['NpmArtifactListenerTimestamp'];
    const mavenTs = map['MavenArtifactListenerTimestamp'];
    const pypiTs = map['PypiArtifactListenerTimestamp'];
    return {
      NPM: { lastSync: toIso(npmTs), lastSeq: map['NpmArtifactListener'] ?? null },
      MAVEN: { lastSync: toIso(mavenTs) ?? toIso(map['MavenArtifactListener']), lastSeq: null as string | null },
      PYPI: { lastSync: toIso(pypiTs) ?? toIso(map['PypiArtifactListener']), lastSeq: null as string | null },
    };
  }
}
