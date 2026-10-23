import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ArtifactsService } from '../src/artifacts/artifacts.service';
import { NpmArtifactListener } from '../src/listeners/npm-artifact.listener';
import { PypiArtifactListener } from '../src/listeners/pypi-artifact.listener';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
const artifacts = new ArtifactsService(prisma as any, new ConfigService({}));
const notifications = { onNewVersion: jest.fn() };
const notified = () => notifications.onNewVersion.mock.calls.map(([, u, , , v]) => `${u}:${v}`);

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function routeFetch(handler: Handler) {
  return jest.spyOn(global, 'fetch').mockImplementation((input, init) => Promise.resolve(handler(String(input), init)));
}
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const seq = async (id: string) => (await prisma.listenerSequence.findUnique({ where: { id } }))?.value;

async function follow(ecosystem: 'NPM' | 'PYPI', coordinates: string, known: string[]) {
  await prisma.followedArtifact.create({
    data: { userId: 'u1', ecosystem, coordinates, currentVersion: known.at(-1) },
  });
  await artifacts.addKnownVersions(ecosystem, coordinates, known);
}

beforeEach(async () => {
  await resetDb(prisma);
  notifications.onNewVersion.mockReset();
  await createUser(prisma, 'u1');
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe('NpmArtifactListener', () => {
  const CHANGES = /^https:\/\/replicate\.npmjs\.com\/_changes\?since=(\d+)&limit=500$/;

  it('starts from the current update_seq on a fresh database (no replay)', async () => {
    routeFetch((url) => (url === 'https://replicate.npmjs.com/' ? json({ update_seq: 4242 }) : json({})));
    const listener = new NpmArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.onModuleInit();
    expect(listener.sequence).toBe(4242);
    expect(await seq('NpmArtifactListener')).toBe('4242');
  });

  it('migrates a legacy "now" sequence', async () => {
    await prisma.listenerSequence.create({ data: { id: 'NpmArtifactListener', value: 'now' } });
    routeFetch(() => json({ update_seq: 77 }));
    const listener = new NpmArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.onModuleInit();
    expect(listener.sequence).toBe(77);
  });

  it('only resolves followed packages from the changes feed and paginates the backlog', async () => {
    await follow('NPM', '@angular/core', ['22.2.2', '22.2.3']);
    const listener = new NpmArtifactListener(artifacts, notifications as any, prisma as any);
    await prisma.listenerSequence.create({ data: { id: 'NpmArtifactListener', value: '100' } });
    await listener.start();

    const registry = jest.fn(() =>
      json({ versions: { '22.2.2': {}, '22.2.3': {}, '22.2.4': {}, '23.0.0-next.0': {} } }),
    );
    routeFetch((url) => {
      const m = CHANGES.exec(url);
      if (m && m[1] === '100') {
        // a full page: the listener must ask for the next one
        const results = Array.from({ length: 500 }, (_, i) => ({ seq: 101 + i, id: `pkg-${i}` }));
        results[3] = { seq: 104, id: '@angular/core' };
        results[4] = { seq: 105, id: 'gone', deleted: true } as any;
        return json({ results, last_seq: 600 });
      }
      if (m && m[1] === '600') return json({ results: [{ seq: 601, id: 'other' }], last_seq: 601 });
      if (url === 'https://registry.npmjs.org/%40angular%2Fcore') return registry();
      throw new Error(`unexpected ${url}`);
    });

    await listener.poll();

    expect(registry).toHaveBeenCalledTimes(1);
    expect(notified()).toEqual(['u1:22.2.4']);
    expect(listener.sequence).toBe(601);
    expect(await seq('NpmArtifactListenerTimestamp')).toBeDefined();
  });

  it('advances to last_seq when there are no changes', async () => {
    await prisma.listenerSequence.create({ data: { id: 'NpmArtifactListener', value: '10' } });
    const listener = new NpmArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.start();
    routeFetch(() => json({ results: [], last_seq: '15' }));
    await listener.poll();
    expect(listener.sequence).toBe(15);
  });

  it('survives a registry error for a followed package and a feed failure', async () => {
    await follow('NPM', 'left-pad', ['1.0.0']);
    await prisma.listenerSequence.create({ data: { id: 'NpmArtifactListener', value: '1' } });
    const listener = new NpmArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.start();
    routeFetch((url) =>
      CHANGES.test(url)
        ? json({ results: [{ seq: 2, id: 'left-pad' }], last_seq: 2 })
        : new Response('', { status: 500 }),
    );
    await listener.poll();
    expect(notified()).toEqual([]);
    expect(listener.sequence).toBe(2);

    routeFetch(() => new Response('', { status: 503, statusText: 'Unavailable' }));
    const error = jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    await listener.poll();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('503'));
  });
});

describe('PypiArtifactListener', () => {
  const RSS = 'https://pypi.org/rss/updates.xml';
  const XMLRPC = 'https://pypi.org/pypi';
  const rss = (items: [string, string][]) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>PyPI</title>${items
      .map(([title, date]) => `<item><title>${title}</title><pubDate>${date}</pubDate></item>`)
      .join('')}</channel></rss>`;
  const serial = (n: number) =>
    `<?xml version="1.0"?><methodResponse><params><param><value><int>${n}</int></value></param></params></methodResponse>`;
  const changelog = (events: [string, string, number, string, number][]) =>
    `<?xml version="1.0"?><methodResponse><params><param><value><array><data>${events
      .map(
        ([n, v, ts, a, s]) =>
          `<value><array><data><value><string>${n}</string></value><value><string>${v}</string></value><value><int>${ts}</int></value><value><string>${a}</string></value><value><int>${s}</int></value></data></array></value>`,
      )
      .join('')}</data></array></value></param></params></methodResponse>`;

  let listener: PypiArtifactListener;
  beforeEach(async () => {
    await follow('PYPI', 'django', ['6.1.1']);
    listener = new PypiArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.onModuleInit();
    listener.sequence = Date.parse('2026-10-23T10:00:00Z');
  });

  it('notifies feed entries newer than the last sync and remembers the ETag', async () => {
    const seen: (string | undefined)[] = [];
    routeFetch((url, init) => {
      if (url === RSS) {
        seen.push((init?.headers as Record<string, string>)['if-none-match']);
        if (seen.length > 1) return new Response(null, { status: 304 });
        return new Response(
          rss([
            ['django 6.1.2', 'Thu, 23 Oct 2026 12:00:00 GMT'],
            ['flask 4.0.0', 'Thu, 23 Oct 2026 11:00:00 GMT'],
            ['broken', 'Thu, 23 Oct 2026 11:00:00 GMT'],
            ['django 6.1.0', 'Thu, 23 Oct 2026 08:00:00 GMT'],
          ]),
          { headers: { etag: '"v1"' } },
        );
      }
      if (url === XMLRPC) return new Response(serial(900));
      throw new Error(`unexpected ${url}`);
    });

    await listener.poll();
    expect(notified()).toEqual(['u1:6.1.2']);
    expect(listener.sequence).toBe(Date.parse('2026-10-23T12:00:00Z'));
    expect(await seq('PypiArtifactListenerSerial')).toBe('900');

    await listener.poll(); // 304: nothing re-processed
    expect(seen).toEqual([undefined, '"v1"']);
    expect(notified()).toEqual(['u1:6.1.2']);
  });

  it('catches up through XML-RPC when the whole feed is newer than the last sync', async () => {
    await prisma.listenerSequence.create({ data: { id: 'PypiArtifactListenerSerial', value: '500' } });
    const calls: string[] = [];
    routeFetch((url, init) => {
      if (url === RSS) return new Response(rss([['flask 4.0.0', 'Thu, 23 Oct 2026 11:00:00 GMT']]));
      const body = String(init?.body);
      calls.push(/<methodName>(\w+)/.exec(body)![1]);
      if (body.includes('changelog_since_serial'))
        return new Response(
          changelog([
            ['django', '6.1.3', Date.parse('2026-10-23T10:30:00Z') / 1000, 'new release', 510],
            ['django', '6.1.0', Date.parse('2026-10-22T10:30:00Z') / 1000, 'new release', 505],
            ['django', '6.1.4', Date.parse('2026-10-23T10:40:00Z') / 1000, 'remove', 511],
          ]),
        );
      return new Response(serial(512));
    });

    await listener.poll();

    expect(calls).toEqual(['changelog_since_serial', 'changelog_last_serial']);
    expect(notified()).toEqual(['u1:6.1.3']);
    expect(await seq('PypiArtifactListenerSerial')).toBe('512');
  });

  it('initializes the serial and survives XML-RPC faults', async () => {
    routeFetch((url) => {
      if (url === RSS) return new Response(rss([['flask 4.0.0', 'Thu, 23 Oct 2026 11:00:00 GMT']]));
      return new Response(
        '<methodResponse><fault><value><struct><member><name>faultString</name><value><string>rate limited</string></value></member></struct></value></fault></methodResponse>',
      );
    });
    const error = jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    await listener.poll();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
    // the RSS sequence still advances
    expect(listener.sequence).toBe(Date.parse('2026-10-23T11:00:00Z'));
  });

  it('logs feed fetch errors', async () => {
    routeFetch(() => {
      throw new Error('network down');
    });
    const error = jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    await listener.poll();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });
});
