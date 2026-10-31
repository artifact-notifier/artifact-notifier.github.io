import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Ecosystem } from '@prisma/client';
import { ArtifactListener } from './artifact-listener.base';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { fetchGoVersions, isGoPseudoVersion } from '../artifacts/version-sources';

const INDEX_URL = 'https://index.golang.org/index';
const PAGE_SIZE = 2000; // index maximum
// one poll catches up at most this many pages (40k versions, a few hours of history)
const MAX_PAGES = 20;
const POLLING_TIME_IN_MS = 60 * 1000;
// The index only lists versions the proxy has fetched: a new tag nobody asked for
// yet appears late. The sweep asks the proxy for followed modules' @latest.
const SWEEP_TIME_IN_MS = 30 * 60 * 1000;
const TIMESTAMP_KEY = 'GoArtifactListenerTimestamp';

interface IndexEntry {
  Path: string;
  Version: string;
  Timestamp: string;
}

/** One JSON object per line; unreadable lines are skipped. */
export function parseIndex(body: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as IndexEntry;
      if (e.Path && e.Version && e.Timestamp) entries.push(e);
    } catch {
      // partial line
    }
  }
  return entries;
}

/**
 * Go modules, from the module index (index.golang.org): a feed of every version
 * the proxy caches, paginated by timestamp. The sequence is the last timestamp read.
 */
@Injectable()
export class GoArtifactListener extends ArtifactListener<string> implements OnModuleInit, OnModuleDestroy {
  readonly ecosystem = Ecosystem.GO;
  // start from now: never replay the whole history
  defaultSequence = new Date().toISOString();
  private running = false;
  private sweeping = false;

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
      let since = this.sequence;
      let read = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(`${INDEX_URL}?since=${encodeURIComponent(since)}&limit=${PAGE_SIZE}`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`index ${res.status} ${res.statusText}`);
        const entries = parseIndex(await res.text());
        for (const e of entries) {
          if (!isGoPseudoVersion(e.Version)) await this.handleArtifact(e.Path, e.Version, new Date(e.Timestamp));
        }
        read += entries.length;
        // `since` is inclusive: the last entry comes back first on the next page (known versions dedupe it)
        if (entries.length) since = entries[entries.length - 1].Timestamp;
        if (entries.length < PAGE_SIZE) break;
      }
      this.logger.debug(`[Go] poll done read=${read} since=${since}`);
      await this.updateSequence(since);
      await this.prisma.listenerSequence.upsert({
        where: { id: TIMESTAMP_KEY },
        create: { id: TIMESTAMP_KEY, value: '' + Date.now() },
        update: { value: '' + Date.now() },
      });
    } catch (e) {
      this.logger.error(`[Go] poll error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  @Interval(SWEEP_TIME_IN_MS)
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const modules = [...this.followedMap.keys()];
      this.logger.log(`[Go] sweep start: ${modules.length} followed modules`);
      for (const m of modules) {
        try {
          const versions = await fetchGoVersions(m);
          if (versions) await this.handleVersions(m, versions, true);
        } catch (e) {
          this.logger.warn(`[Go] sweep failed for ${m}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
}
