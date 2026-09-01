import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ArtifactListener } from './artifact-listener.base';
import { Ecosystem } from '@prisma/client';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const POLLING_TIME_IN_MS = 60 * 1000;
const CHANGES_LIMIT = 500;

interface NpmChangesResponse {
  results: { seq: number; id: string; deleted?: boolean }[];
  last_seq: number | string;
}

@Injectable()
export class NpmArtifactListener
  extends ArtifactListener<number>
  implements OnModuleInit, OnModuleDestroy
{
  readonly ecosystem = Ecosystem.NPM;
  defaultSequence = 0;
  private running = false;

  constructor(
    artifacts: ArtifactsService,
    notifications: NotificationsService,
    prisma: PrismaService,
  ) {
    super(artifacts, notifications, prisma);
  }

  async onModuleInit() {
    // Fresh DB (no stored sequence): start from current update_seq instead of 0
    // to avoid replaying the whole npm changes feed when nobody follows anything yet.
    const existing = await this.prisma.listenerSequence
      .findUnique({ where: { id: 'NpmArtifactListener' } })
      .catch(() => null);
    if (!existing) {
      const seq = await this.fetchUpdateSeq();
      if (seq) {
        await this.prisma.listenerSequence.create({
          data: { id: 'NpmArtifactListener', value: '' + seq },
        });
        this.logger.log(`Initialized npm sequence to current update_seq=${seq} (fresh DB, no replay)`);
      }
    }
    await this.start();
    // migrate legacy 'now' sequence if present
    if ((this.sequence as any) === 'now' || (typeof this.sequence === 'string' && isNaN(Number(this.sequence)))) {
      const seq = await this.fetchUpdateSeq();
      if (seq) {
        await this.updateSequence(seq);
        this.logger.log(`Migrated npm sequence 'now' -> ${seq}`);
      }
    }
  }

  onModuleDestroy() {
    this.running = false;
  }

  async sync(): Promise<void> {
    // polling is driven by @Interval
  }

  @Interval(POLLING_TIME_IN_MS)
  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      await this.pollChanges();
    } catch (e) {
      this.logger.error(`npm poll error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async pollChanges() {
    let seq = this.sequence as number;
    if (typeof seq === 'string') {
      const n = Number(seq);
      seq = isNaN(n) ? 0 : n;
      if (seq === 0) {
        const info = await this.fetchUpdateSeq();
        if (info) seq = info;
      }
    }
    const startSeq = seq;
    this.logger.log(`[NPM] poll since=${seq}`);
    let totalChanges = 0;
    let latestFollowedTime: number | null = null;
    let pages = 0;

    // catch-up if > CHANGES_LIMIT: loop until last_seq
    while (true) {
      const data = await this.fetchChanges(seq);
      pages++;
      if (!data.results.length) {
        const lastSeq = typeof data.last_seq === 'string' ? Number(data.last_seq) : (data.last_seq as number);
        if (lastSeq && lastSeq !== seq) {
          await this.updateSequence(lastSeq as number);
          this.logger.log(`[NPM] no changes, advance seq ${seq} -> ${lastSeq}`);
          seq = lastSeq as number;
        }
        break;
      }

      this.logger.log(`[NPM] page ${pages} got ${data.results.length} changes last_seq=${data.last_seq}`);
      totalChanges += data.results.length;

      for (const change of data.results) {
        if (change.deleted) {
          this.logger.debug(`[NPM] skip deleted ${change.id} seq=${change.seq}`);
          continue;
        }
        // only call the registry if the artifact is followed (edge case) — avoids N useless fetches
        if (!this.followedMap.has(change.id)) {
          this.logger.debug(`[NPM] skip not-followed ${change.id} seq=${change.seq}`);
          continue;
        }
        this.logger.debug(`[NPM] checking followed ${change.id} seq=${change.seq}`);
        const info = await this.resolveLatestWithTime(change.id);
        if (info) {
          this.logger.debug(`[NPM] resolved ${change.id}@${info.version}`);
          if (info.time) {
            const t = new Date(info.time).getTime();
            if (!isNaN(t) && (latestFollowedTime === null || t > latestFollowedTime)) latestFollowedTime = t;
          }
          await this.handleArtifact(change.id, info.version, info.time ? new Date(info.time) : undefined);
        } else {
          this.logger.debug(`[NPM] no version for ${change.id}`);
        }
      }

      const lastSeq = typeof data.last_seq === 'string' ? Number(data.last_seq) : (data.last_seq as number);
      const nextSeq = lastSeq || Math.max(...data.results.map((r) => r.seq), seq);
      await this.updateSequence(nextSeq);
      seq = nextSeq;

      // if the page is incomplete, we have caught up
      if (data.results.length < CHANGES_LIMIT) break;
      this.logger.log(`[NPM] backlog remaining, continuing from seq=${seq}`);
    }

    this.logger.log(`[NPM] poll done pages=${pages} totalChanges=${totalChanges} seq ${startSeq} -> ${seq}`);
    // display alias: date of the most recently followed item, otherwise Date.now() to reflect the sync
    const aliasTs = latestFollowedTime ?? Date.now();
    await this.updateTimestampAlias(aliasTs);
  }

  private async fetchChanges(since: number): Promise<NpmChangesResponse> {
    const url = `https://replicate.npmjs.com/_changes?since=${since}&limit=${CHANGES_LIMIT}`;
    this.logger.debug(`[NPM] GET ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`npm replicate ${res.status} ${res.statusText}`);
    return res.json();
  }

  private async fetchUpdateSeq(): Promise<number | null> {
    try {
      const res = await fetch('https://replicate.npmjs.com/', { signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      return json.update_seq ?? null;
    } catch {
      return null;
    }
  }

  private async resolveLatestWithTime(pkg: string): Promise<{ version: string; time: string | null } | null> {
    try {
      const encoded = encodeURIComponent(pkg);
      const res = await fetch(`https://registry.npmjs.org/${encoded}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const version = json['dist-tags']?.latest ?? null;
      if (!version) return null;
      const time = json.time?.[version] ?? null;
      return { version, time };
    } catch {
      return null;
    }
  }

  private async updateTimestampAlias(ts: number) {
    // dummy key for frontend display, does not affect sync (which uses NpmArtifactListener)
    await this.prisma.listenerSequence.upsert({
      where: { id: 'NpmArtifactListenerTimestamp' },
      create: { id: 'NpmArtifactListenerTimestamp', value: '' + ts },
      update: { value: '' + ts },
    });
    this.logger.debug(`[NPM] timestamp alias updated to ${ts} (${new Date(ts).toISOString()})`);
  }
}
