import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import Parser from 'rss-parser';
import { Ecosystem } from '@prisma/client';
import { ArtifactListener } from './artifact-listener.base';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCoordinates } from '../artifacts/coordinates';
import { CRATES_USER_AGENT, fetchCargoVersions } from '../artifacts/version-sources';

// static file on the crates.io CDN: the versions published during the last hour
const FEED_URL = 'https://static.crates.io/rss/updates.xml';
const POLLING_TIME_IN_MS = 60 * 1000;
// safety net (feed missed for over an hour, e.g. downtime): diff followed crates against the index
const SWEEP_TIME_IN_MS = 30 * 60 * 1000;
const TIMESTAMP_KEY = 'CargoArtifactListenerTimestamp';

type FeedItem = { pubDate?: string; name?: string; version?: string };

/** crates.io, from its RSS feed of recent publications. The sequence is the last pubDate read (ms). */
@Injectable()
export class CargoArtifactListener extends ArtifactListener<number> implements OnModuleInit, OnModuleDestroy {
  readonly ecosystem = Ecosystem.CARGO;
  defaultSequence = Date.now();
  private etag?: string;
  private running = false;
  private sweeping = false;
  private parser = new Parser<object, FeedItem>({
    customFields: { item: [['crates:name', 'name'] as any, ['crates:version', 'version'] as any] },
  });

  constructor(artifacts: ArtifactsService, notifications: NotificationsService, prisma: PrismaService) {
    super(artifacts, notifications, prisma);
  }

  async onModuleInit() {
    await this.start();
  }

  onModuleDestroy() {
    this.running = false;
  }

  async sync(): Promise<void> {
    // polled by @Interval below
  }

  @Interval(POLLING_TIME_IN_MS)
  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      const latest = this.sequence;
      const headers: Record<string, string> = { 'User-Agent': CRATES_USER_AGENT };
      if (this.etag) headers['if-none-match'] = this.etag;
      const res = await fetch(FEED_URL, { headers, signal: AbortSignal.timeout(15000) });
      if (res.status === 304) return void (await this.markPolled());
      if (!res.ok) throw new Error(`feed ${res.status} ${res.statusText}`);
      this.etag = res.headers.get('etag') ?? undefined;

      const items = (await this.parser.parseString(await res.text())).items ?? [];
      let maxTs = latest;
      let fresh = 0;
      // oldest first, so that several versions of a crate come in order
      for (const item of [...items].reverse()) {
        const ts = item.pubDate ? new Date(item.pubDate).getTime() : Number.NaN;
        if (!item.name || !item.version || !(ts > latest)) continue;
        fresh++;
        maxTs = Math.max(maxTs, ts);
        await this.handleArtifact(normalizeCoordinates(Ecosystem.CARGO, item.name), item.version, new Date(ts));
      }
      // every item newer than the last poll: part of the history is out of the feed
      if (items.length && fresh === items.length) {
        this.logger.warn(`[Cargo] feed truncated (${fresh} items newer than ${latest}), sweeping followed crates`);
        void this.sweep();
      }
      this.logger.debug(`[Cargo] poll done fresh=${fresh}/${items.length}`);
      await this.updateSequence(maxTs);
      await this.markPolled();
    } catch (e) {
      this.logger.error(`[Cargo] poll error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  @Interval(SWEEP_TIME_IN_MS)
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const crates = [...this.followedMap.keys()];
      this.logger.log(`[Cargo] sweep start: ${crates.length} followed crates`);
      for (const c of crates) {
        try {
          const versions = await fetchCargoVersions(c);
          if (versions) await this.handleVersions(c, versions, true);
        } catch (e) {
          this.logger.warn(`[Cargo] sweep failed for ${c}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async markPolled() {
    await this.prisma.listenerSequence.upsert({
      where: { id: TIMESTAMP_KEY },
      create: { id: TIMESTAMP_KEY, value: '' + Date.now() },
      update: { value: '' + Date.now() },
    });
  }
}
