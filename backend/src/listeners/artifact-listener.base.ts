import { Logger } from '@nestjs/common';
import { Ecosystem } from '@prisma/client';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublishedVersion } from '../artifacts/version-sources';
import { compareVersions, isPrerelease } from '../artifacts/versions';

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
  includePrereleases: boolean;
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

  /** Single publication event (PyPI feed): see handleVersions. */
  protected async handleArtifact(artifactId: string, version: string, publishedAt?: Date) {
    await this.handleVersions(artifactId, [{ version, publishedAt }], false);
  }

  /**
   * Notifies every version never seen before for this artifact, including patches
   * of older lines. `complete` means `versions` is the full list of the artifact:
   * when nothing is known yet, it is recorded silently as a baseline.
   */
  protected handleVersions(artifactId: string, versions: PublishedVersion[], complete: boolean): Promise<void> {
    // Serialized: the poll and the sweep may diff the same artifact concurrently.
    const run = this.queue.then(() => this.doHandleVersions(artifactId, versions, complete));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private queue: Promise<void> = Promise.resolve();

  private async doHandleVersions(artifactId: string, versions: PublishedVersion[], complete: boolean) {
    const followers = this.followedMap.get(artifactId);
    if (!followers || followers.length === 0) {
      this.logger.debug(`[${this.ecoLabel}] skip not-followed ${artifactId}`);
      return;
    }

    const known = await this.artifacts.getKnownVersions(this.ecosystem, artifactId);
    if (complete && known.size === 0) {
      this.logger.log(`[${this.ecoLabel}] baseline ${artifactId}: ${versions.length} versions recorded, no notification`);
      await this.artifacts.addKnownVersions(this.ecosystem, artifactId, versions.map((v) => v.version));
      return;
    }
    const fresh = [...new Map(versions.filter((v) => !known.has(v.version)).map((v) => [v.version, v])).values()]
      .sort((a, b) => compareVersions(a.version, b.version));
    if (fresh.length === 0) {
      this.logger.debug(`[${this.ecoLabel}] skip already-known ${artifactId}`);
      return;
    }
    // Versions become known only once every follower got them: on failure they stay
    // "fresh" and the next pass retries (events and deliveries are idempotent).
    let failed = false;
    for (const f of followers) {
      try {
        await this.notifyFollower(f, artifactId, fresh);
      } catch (e) {
        failed = true;
        this.logger.error(`[${this.ecoLabel}] notify ${artifactId} user=${f.userId} failed: ${(e as Error).message}`);
      }
    }
    if (failed) return;
    await this.artifacts.addKnownVersions(this.ecosystem, artifactId, fresh.map((v) => v.version));
  }

  private async notifyFollower(f: FollowedEntry, artifactId: string, fresh: PublishedVersion[]) {
    let current = f.currentVersion;
    for (const { version, publishedAt } of fresh) {
      if (isPrerelease(version) && !f.includePrereleases) {
        this.logger.debug(`[${this.ecoLabel}] skip prerelease ${artifactId}@${version} user=${f.userId}`);
        continue;
      }
      this.logger.log(`[${this.ecoLabel}] new artifact ${artifactId}@${version} user=${f.userId} (current ${current ?? 'none'})`);
      await this.notifications.onNewVersion(
        f.followedArtifactId,
        f.userId,
        this.ecosystem,
        artifactId,
        version,
        publishedAt,
      );
      // currentVersion stays the highest version, a patch of an older line doesn't lower it
      if (!current || compareVersions(version, current) > 0) current = version;
    }
    if (current && current !== f.currentVersion) {
      await this.artifacts.markNewVersion(f.followedArtifactId, current);
      f.currentVersion = current;
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

  abstract sync(): Promise<void>;
}
