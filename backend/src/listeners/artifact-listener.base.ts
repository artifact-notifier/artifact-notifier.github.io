import { Logger } from '@nestjs/common';
import { Ecosystem } from '@prisma/client';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ArtifactId {
  id: string;
}

export interface Artifact extends ArtifactId {
  version: string;
}

export interface FollowedEntry {
  followedArtifactId: string;
  userId: string;
  currentVersion: string | null;
}

/**
 * Port of the Deno ArtifactListener base. Listeners poll/stream their ecosystem,
 * filter by what users actually follow, and notify per user.
 */
export abstract class ArtifactListener<T extends string | number> {
  protected readonly logger = new Logger(this.listenerName);
  abstract readonly ecosystem: Ecosystem;
  abstract defaultSequence: T;
  sequence!: T;
  protected followedMap = new Map<string, FollowedEntry[]>();

  protected constructor(
    protected readonly artifacts: ArtifactsService,
    protected readonly notifications: NotificationsService,
    protected readonly prisma: PrismaService,
  ) {}

  get listenerName(): string {
    return this.constructor.name;
  }

  async start(): Promise<void> {
    const current = await this.getSequence();
    if (current !== undefined) {
      this.sequence = current;
      this.logger.log(`Resuming at sequence ${this.sequence}`);
    } else {
      this.sequence = this.defaultSequence;
      this.logger.log(`Initializing sequence to ${this.sequence}`);
      await this.prisma.listenerSequence.create({
        data: { id: this.listenerName, value: '' + this.sequence },
      });
    }
    await this.refreshFollowed();
    await this.sync();
  }

  async refreshFollowed(): Promise<void> {
    const rows = await this.artifacts.getFollowedCoordinates(this.ecosystem);
    this.followedMap = rows as unknown as Map<string, FollowedEntry[]>;
  }

  /** Display name for logs only (does not affect logic). */
  protected get ecoLabel(): string {
    switch (this.ecosystem) {
      case Ecosystem.NPM:
        return 'npm';
      case Ecosystem.MAVEN:
        return 'Maven';
      case Ecosystem.PYPI:
        return 'PyPI';
      default:
        return this.ecosystem;
    }
  }

  protected async handleArtifact(artifactId: string, version: string, publishedAt?: Date) {
    const followers = this.followedMap.get(artifactId);
    if (!followers || followers.length === 0) {
      this.logger.debug(`[${this.ecoLabel}] skip not-followed ${artifactId}@${version}`);
      return;
    }

    for (const f of followers) {
      if (f.currentVersion && f.currentVersion === version) {
        this.logger.debug(`[${this.ecoLabel}] skip already-known ${artifactId}@${version} user=${f.userId}`);
        continue;
      }
      if (f.currentVersion && this.isLower(version, f.currentVersion)) {
        this.logger.debug(`[${this.ecoLabel}] skip lower ${artifactId}@${version} < ${f.currentVersion} user=${f.userId}`);
        continue;
      }
      this.logger.log(`[${this.ecoLabel}] new artifact ${artifactId}@${version} user=${f.userId} (was ${f.currentVersion ?? 'none'})`);

      await this.artifacts.markNewVersion(f.followedArtifactId, version);

      await this.notifications.onNewVersion(
        f.followedArtifactId,
        f.userId,
        this.ecosystem,
        artifactId,
        version,
        publishedAt,
      );
    }
  }

  protected async updateSequence(seq: T) {
    this.sequence = seq;
    await this.prisma.listenerSequence.upsert({
      where: { id: this.listenerName },
      create: { id: this.listenerName, value: '' + seq },
      update: { value: '' + seq },
    });
  }

  private async getSequence(): Promise<T | undefined> {
    const row = await this.prisma.listenerSequence.findUnique({
      where: { id: this.listenerName },
    });
    if (!row) return undefined;
    const n = Number.parseInt(row.value, 10);
    return (isNaN(n) ? row.value : n) as T;
  }

  // best-effort semver-ish comparison; returns true if `a` < `b`
  private isLower(a: string, b: string): boolean {
    try {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x < y) return true;
        if (x > y) return false;
      }
      return false;
    } catch {
      return false;
    }
  }

  abstract sync(): Promise<void>;
}
