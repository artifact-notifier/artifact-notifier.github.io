import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import Parser from 'rss-parser';
import { ArtifactListener } from './artifact-listener.base';
import { Ecosystem } from '@prisma/client';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const URL = 'https://pypi.org/rss/updates.xml';
const XMLRPC_URL = 'https://pypi.org/pypi';
const POLLING_TIME_IN_MS = 30 * 1000;
const SERIAL_KEY = 'PypiArtifactListenerSerial';

@Injectable()
export class PypiArtifactListener
  extends ArtifactListener<number>
  implements OnModuleInit, OnModuleDestroy
{
  readonly ecosystem = Ecosystem.PYPI;
  defaultSequence = 0;
  private etag?: string;
  private running = false;
  private parser = new Parser();

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

  async sync(): Promise<void> {}

  @Interval(POLLING_TIME_IN_MS)
  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      const latest = this.sequence as number;
      const headers: Record<string, string> = this.etag
        ? { 'if-none-match': this.etag }
        : {};
      const res = await fetch(URL, { signal: AbortSignal.timeout(10000), headers });
      this.etag = res.headers.get('etag') || this.etag;
      if (res.status !== 200) return;

      const feed = await this.parser.parseString(await res.text());
      const items = feed.items || [];
      this.logger.debug(`[PyPI] feed got ${items.length} items`);
      let maxTs = latest;
      let newCount = 0;
      let skippedOld = 0;
      for (const entry of items) {
        const m = entry.title?.match(/^(.+?)\s+([^\s]+)$/);
        if (!m) {
          this.logger.debug(`[PyPI] skip unparseable title: ${entry.title}`);
          continue;
        }
        const [, name, version] = m;
        const published = entry.pubDate ? new Date(entry.pubDate) : new Date();
        if (published.getTime() > latest) {
          this.logger.debug(`[PyPI] checking ${name}@${version} published=${published.toISOString()}`);
          maxTs = Math.max(maxTs, published.getTime());
          await this.handleArtifact(name, version, published);
          newCount++;
        } else {
          skippedOld++;
        }
      }
      // The RSS feed only contains the ~100 latest publications, without pagination:
      // if the whole feed is newer than lastSync, we missed some history -> XML-RPC fallback.
      const truncated = items.length > 0 && skippedOld === 0 && newCount === items.length;
      if (truncated) {
        this.logger.warn(`[PyPI] feed truncated: all ${items.length} items newer than lastSync=${latest}, trying XML-RPC catch-up`);
        try {
          await this.catchUpViaXmlRpc(latest);
        } catch (e) {
          this.logger.error(`[PyPI] XML-RPC catch-up failed: ${(e as Error).message} — advancing anyway`);
        }
      }
      this.logger.log(`[PyPI] poll done new=${newCount} skippedOld=${skippedOld} maxTs=${maxTs} (${new Date(maxTs).toISOString()})${truncated ? ' (TRUNCATED, xmlrpc attempted)' : ''}`);
      await this.updateSequence(maxTs);
      await this.updateTimestampAlias(Date.now());
      await this.refreshSerial();
    } catch (e) {
      this.logger.error(`[PyPI] poll error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Catch-up via XML-RPC (occasional fallback only): fetches
   * events since the last known serial. Stores the serial under a
   * separate key so it does not interfere with the RSS timestamp sequence.
   */
  private async catchUpViaXmlRpc(lastSync: number): Promise<void> {
    const sinceSerial = await this.getStoredSerial();
    this.logger.log(`[PyPI] XML-RPC catch-up since serial=${sinceSerial}`);
    const events = await this.xmlRpcCall<[string, string, number, string, number][]>(
      'changelog_since_serial',
      [sinceSerial],
    );
    // filter on release additions newer than lastSync
    const fresh = events.filter(
      ([, , ts, action]) => action !== 'remove' && ts * 1000 > lastSync,
    );
    this.logger.log(`[PyPI] XML-RPC got ${events.length} events, ${fresh.length} fresh since lastSync`);
    // process from oldest to newest
    fresh.sort((a, b) => a[4] - b[4]);
    for (const [name, version, ts] of fresh) {
      const published = new Date(ts * 1000);
      this.logger.debug(`[PyPI] catch-up ${name}@${version} published=${published.toISOString()}`);
      await this.handleArtifact(name, version, published);
    }
    const maxSerial = events.reduce((m, [, , , , s]) => Math.max(m, s), sinceSerial);
    await this.storeSerial(maxSerial);
  }

  private async getStoredSerial(): Promise<number> {
    const row = await this.prisma.listenerSequence.findUnique({ where: { id: SERIAL_KEY } });
    const n = row ? Number(row.value) : NaN;
    if (!row || isNaN(n) || n <= 0) {
      // initialization: current serial, do not replay the whole history
      const current = await this.xmlRpcCall<number>('changelog_last_serial', []);
      await this.storeSerial(current);
      return current;
    }
    return n;
  }

  private async storeSerial(serial: number): Promise<void> {
    await this.prisma.listenerSequence.upsert({
      where: { id: SERIAL_KEY },
      create: { id: SERIAL_KEY, value: '' + serial },
      update: { value: '' + serial },
    });
  }

  private async updateTimestampAlias(ts: number) {
    await this.prisma.listenerSequence.upsert({
      where: { id: 'PypiArtifactListenerTimestamp' },
      create: { id: 'PypiArtifactListenerTimestamp', value: '' + ts },
      update: { value: '' + ts },
    });
  }

  private async refreshSerial(): Promise<void> {
    try {
      const current = await this.xmlRpcCall<number>('changelog_last_serial', []);
      await this.storeSerial(current);
      this.logger.debug(`[PyPI] serial refreshed to ${current}`);
    } catch (e) {
      this.logger.debug(`[PyPI] serial refresh failed: ${(e as Error).message}`);
    }
  }

  private async xmlRpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const body =
      `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>` +
      params.map((p) => `<param><value><int>${p}</int></value></param>`).join('') +
      `</params></methodCall>`;
    const res = await fetch(XMLRPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'User-Agent': 'artifact-notifier/1.0 (xmlrpc-catchup-only)',
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`XML-RPC ${res.status} ${res.statusText}`);
    const text = await res.text();
    const fault = text.match(/<fault>[\s\S]*?<string>([\s\S]*?)<\/string>/);
    if (fault) throw new Error(`XML-RPC fault: ${fault[1]}`);
    if (method === 'changelog_last_serial') {
      const m = text.match(/<int>(\d+)<\/int>/);
      if (!m) throw new Error('XML-RPC: cannot parse serial');
      return Number(m[1]) as T;
    }
    // changelog_since_serial -> array of [name, version, timestamp, action, serial]
    const events: [string, string, number, string, number][] = [];
    for (const m of text.matchAll(/<array><data>([\s\S]*?)<\/data><\/array>/g)) {
      const values = [...m[1].matchAll(/<string>([\s\S]*?)<\/string>|<int>(\d+)<\/int>/g)].map(
        (x) => x[1] ?? Number(x[2]),
      );
      // each entry = 5 grouped values; the outer array also contains wrappers,
      // only keep groups of 5 [string, string, int, string, int]
      for (let i = 0; i + 4 < values.length; i += 5) {
        const [name, version, ts, action, serial] = values.slice(i, i + 5);
        if (typeof name === 'string' && typeof version === 'string' && typeof ts === 'number') {
          events.push([name, version, ts, String(action), Number(serial)]);
        }
      }
    }
    return events as T;
  }
}
