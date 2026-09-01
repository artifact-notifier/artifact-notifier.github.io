import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ArtifactListener } from './artifact-listener.base';
import { Ecosystem } from '@prisma/client';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const NB_ROWS_PER_PAGE = 20;
const POLLING_TIME_IN_MS = 60 * 1000;
const CENTRAL_BROWSE_URL = 'https://central.sonatype.com/api/internal/browse/components';
const MAX_PAGE = 499; // page 500 (size 20 = 10000 artifacts) returns 500, API limit

interface MavenDoc {
  id: string;
  g: string;
  a: string;
  latestVersion: string;
  timestamp: number;
}

interface CentralComponent {
  namespace: string;
  name: string;
  latestVersionInfo?: { version: string; timestampUnixWithMS: number } | null;
}

@Injectable()
export class MavenArtifactListener
  extends ArtifactListener<number>
  implements OnModuleInit, OnModuleDestroy
{
  readonly ecosystem = Ecosystem.MAVEN;
  defaultSequence = Date.now();
  private running = false;

  constructor(
    artifacts: ArtifactsService,
    notifications: NotificationsService,
    prisma: PrismaService,
  ) {
    super(artifacts, notifications, prisma);
  }

  async onModuleInit() {
    await this.start();
  }

  onModuleDestroy() {
    this.running = false;
  }

  async sync(): Promise<void> {
    // initial sync is kicked by @Interval below
  }

  @Interval(POLLING_TIME_IN_MS)
  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      await this.getSince();
    } catch (e) {
      this.logger.error(`Error while querying Maven API: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async getSince(): Promise<void> {
    const lastSync = this.sequence as number;
    this.logger.log(`[Maven] sync start lastSync=${lastSync} (${new Date(lastSync).toISOString()})`);
    const artifacts: MavenDoc[] = [];
    let maxTs = lastSync;
    let page = 0;
    let reachedSync = false;
    let pagesFetched = 0;
    const RETRY_429_MS = 30000;

    let truncated = false;
    do {
      if (page > MAX_PAGE) {
        this.logger.error(`[Maven] pagination truncated at page=${MAX_PAGE} (API limit 10000 artifacts) — lastSync=${lastSync} not reached, history incomplete`);
        truncated = true;
        break;
      }
      this.logger.log(`[Maven] fetching page=${page} size=${NB_ROWS_PER_PAGE}`);
      const t0 = Date.now();
      let docs: MavenDoc[];
      try {
        docs = await this.getPageSortedDesc(page);
      } catch (e) {
        const msg = (e as Error).message;
        const is429 = msg.includes('429');
        if (is429) {
          const retryAfter = this.parseRetryAfter((e as any).retryAfter);
          // Observed window ~4min30, wait a fixed 30s (or Retry-After if provided)
          const waitMs = retryAfter ?? RETRY_429_MS;
          this.logger.warn(`[Maven] 429 rate-limited page=${page} after ${Date.now() - t0}ms, retrying same page in ${waitMs}ms`);
          await this.sleep(waitMs);
          continue; // retry same page, do not restart from 0
        }
        // page 500+ returns 500 API-side even without 429, truncate cleanly
        if (msg.includes(' 500') && page >= MAX_PAGE) {
          this.logger.error(`[Maven] API 500 at page=${page} (limit 10000), truncating pagination`);
          truncated = true;
          break;
        }
        this.logger.error(`[Maven] fetch failed page=${page} after ${Date.now() - t0}ms: ${msg}`);
        throw e;
      }
      const elapsed = Date.now() - t0;
      this.logger.log(`[Maven] page=${page} got ${docs.length} docs in ${elapsed}ms`);
      pagesFetched++;
      if (docs.length === 0) {
        this.logger.log(`[Maven] empty page, stopping`);
        break;
      }

      if (maxTs === lastSync && page === 0 && docs.length > 0) {
        maxTs = Math.max(maxTs, docs[0].timestamp);
      } else {
        for (const d of docs) maxTs = Math.max(maxTs, d.timestamp);
      }

      for (const doc of docs) {
        if (doc.timestamp <= lastSync) {
          reachedSync = true;
          break;
        }
        artifacts.push(doc);
      }

      if (reachedSync) {
        this.logger.log(`[Maven] reached lastSync at page=${page}, stopping pagination`);
        break;
      }
      if (docs.length < NB_ROWS_PER_PAGE) {
        this.logger.log(`[Maven] last page incomplete, stopping`);
        break;
      }
      page++;
    } while (true);

    if (truncated) {
      this.logger.error(`[Maven] pagination done (TRUNCATED) pages=${pagesFetched} newArtifacts=${artifacts.length} maxTs=${maxTs} — full history not loaded, next sync will resume from updated sequence`);
    } else {
      this.logger.log(`[Maven] pagination done pages=${pagesFetched} newArtifacts=${artifacts.length} maxTs=${maxTs}`);
    }

    artifacts.reverse();
    for (const doc of artifacts) {
      const coordinates = `${doc.g}:${doc.a}`;
      await this.handleArtifact(coordinates, doc.latestVersion, new Date(doc.timestamp));
    }
    // Even when truncated, advance the sequence with what we have to avoid looping forever
    if (artifacts.length > 0) {
      await this.updateSequence(maxTs);
      this.logger.log(`[Maven] sequence updated to ${maxTs} (${new Date(maxTs).toISOString()})${truncated ? ' (truncated)' : ''}`);
    } else {
      this.logger.log(`[Maven] no new artifacts, sequence unchanged`);
    }
    // Display alias: time of the successful poll (even without new artifacts), like NPM
    await this.updateTimestampAlias(Date.now());
  }

  private async getPageSortedDesc(page: number): Promise<MavenDoc[]> {
    const body = JSON.stringify({
      page,
      size: NB_ROWS_PER_PAGE,
      searchTerm: '',
      sortField: 'publishedDate',
      sortDirection: 'desc',
      filter: [],
    });
    this.logger.debug(`[Maven] POST ${CENTRAL_BROWSE_URL} page=${page}`);
    const res = await fetch(CENTRAL_BROWSE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      const err: any = new Error(`Maven Central API 429 Too Many Requests`);
      err.retryAfter = retryAfter;
      throw err;
    }
    if (!res.ok) throw new Error(`Maven Central API ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { components?: CentralComponent[] };
    const components = json.components ?? [];
    return components
      .filter((c) => c.latestVersionInfo?.timestampUnixWithMS && c.latestVersionInfo?.version)
      .map((c) => ({
        id: `${c.namespace}:${c.name}`,
        g: c.namespace,
        a: c.name,
        latestVersion: c.latestVersionInfo!.version,
        timestamp: c.latestVersionInfo!.timestampUnixWithMS,
      }));
  }

  private async updateTimestampAlias(ts: number) {
    await this.prisma.listenerSequence.upsert({
      where: { id: 'MavenArtifactListenerTimestamp' },
      create: { id: 'MavenArtifactListenerTimestamp', value: '' + ts },
      update: { value: '' + ts },
    });
  }

  private parseRetryAfter(header: string | null | undefined): number | null {
    if (!header) return null;
    const secs = Number(header);
    if (!Number.isNaN(secs)) return secs * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
