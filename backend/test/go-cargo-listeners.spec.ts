import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ArtifactsService } from '../src/artifacts/artifacts.service';
import { CargoArtifactListener } from '../src/listeners/cargo-artifact.listener';
import { GoArtifactListener, parseIndex } from '../src/listeners/go-artifact.listener';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
const artifacts = new ArtifactsService(prisma as any, new ConfigService({}));
const notifications = { onNewVersion: jest.fn() };
const notified = () => notifications.onNewVersion.mock.calls.map(([, u, , c, v]) => `${u}:${c}@${v}`);

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function routeFetch(handler: Handler) {
  return jest.spyOn(global, 'fetch').mockImplementation((input, init) => Promise.resolve(handler(String(input), init)));
}
const seq = async (id: string) => (await prisma.listenerSequence.findUnique({ where: { id } }))?.value;

async function follow(ecosystem: 'GO' | 'CARGO', coordinates: string, known: string[]) {
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

describe('GoArtifactListener', () => {
  const line = (Path: string, Version: string, Timestamp: string) => JSON.stringify({ Path, Version, Timestamp });
  const GIN = 'github.com/gin-gonic/gin';

  it('parses the index, skipping broken lines', () => {
    expect(parseIndex(`${line('a.com/x', 'v1.0.0', '2026-10-31T10:00:00Z')}\n{oops\n\n`)).toEqual([
      { Path: 'a.com/x', Version: 'v1.0.0', Timestamp: '2026-10-31T10:00:00Z' },
    ]);
  });

  it('starts from now, then notifies followed modules from the index, without pseudo-versions', async () => {
    await follow('GO', GIN, ['v1.10.0']);
    const listener = new GoArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.onModuleInit();
    // stored as an ISO timestamp and read back as such (not cut to its year)
    expect(listener.sequence).toMatch(/^\d{4}-\d\d-\d\dT/);
    await prisma.listenerSequence.update({
      where: { id: 'GoArtifactListener' },
      data: { value: '2026-10-31T10:00:00Z' },
    });
    await listener.start();
    expect(listener.sequence).toBe('2026-10-31T10:00:00Z');

    const fetch = routeFetch(
      () =>
        new Response(
          [
            line('other.com/mod', 'v2.0.0', '2026-10-31T10:00:01Z'),
            line(GIN, 'v0.0.0-20261031100002-abcdefabcdef', '2026-10-31T10:00:02Z'),
            line(GIN, 'v1.11.0', '2026-10-31T10:00:03Z'),
          ].join('\n'),
        ),
    );
    await listener.poll();

    expect(fetch.mock.calls[0][0]).toBe('https://index.golang.org/index?since=2026-10-31T10%3A00%3A00Z&limit=2000');
    expect(notified()).toEqual([`u1:${GIN}@v1.11.0`]);
    expect(await seq('GoArtifactListener')).toBe('2026-10-31T10:00:03Z');
    expect(await seq('GoArtifactListenerTimestamp')).toMatch(/^\d+$/);
  });

  it('pages through a full index page', async () => {
    const listener = new GoArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.onModuleInit();
    const full = Array.from({ length: 2000 }, (_, i) => line('a.com/x', `v1.0.${i}`, '2026-10-31T10:00:01Z')).join(
      '\n',
    );
    const fetch = routeFetch(
      (url) => new Response(url.includes('10%3A00%3A01Z') ? line('a.com/x', 'v1.1.0', '2026-10-31T10:00:02Z') : full),
    );
    await listener.poll();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(listener.sequence).toBe('2026-10-31T10:00:02Z');
  });

  it('keeps its position when the index fails', async () => {
    const listener = new GoArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.onModuleInit();
    const before = listener.sequence;
    routeFetch(() => new Response('down', { status: 503 }));
    jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    await listener.poll();
    expect(listener.sequence).toBe(before);
  });

  it('sweeps followed modules through the proxy', async () => {
    await follow('GO', GIN, ['v1.10.0']);
    const listener = new GoArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.onModuleInit();
    routeFetch((url) =>
      url.endsWith('/@v/list')
        ? new Response('v1.10.0\nv1.10.1\n')
        : new Response(JSON.stringify({ Version: 'v1.10.1' })),
    );
    await listener.sweep();
    expect(notified()).toEqual([`u1:${GIN}@v1.10.1`]);
  });
});

describe('CargoArtifactListener', () => {
  const item = (name: string, version: string, date: string) => `
    <item>
      <title>New crate version published: ${name} v${version}</title>
      <pubDate>${new Date(date).toUTCString()}</pubDate>
      <crates:name>${name}</crates:name>
      <crates:version>${version}</crates:version>
    </item>`;
  const feed = (...items: string[]) =>
    `<?xml version="1.0"?><rss version="2.0" xmlns:crates="https://crates.io/"><channel><title>t</title>${items.join('')}</channel></rss>`;

  async function listenerAt(ts: string) {
    await prisma.listenerSequence.create({ data: { id: 'CargoArtifactListener', value: '' + Date.parse(ts) } });
    const listener = new CargoArtifactListener(artifacts, notifications as any, prisma as any);
    await listener.onModuleInit();
    return listener;
  }

  it('notifies followed crates newer than the last poll, oldest first, and remembers the ETag', async () => {
    await follow('CARGO', 'serde', ['1.0.228']);
    const listener = await listenerAt('2026-10-31T10:00:00Z');
    const fetch = routeFetch(
      () =>
        new Response(
          feed(
            item('Serde', '1.0.230', '2026-10-31T10:02:00Z'),
            item('tokio', '1.50.0', '2026-10-31T10:01:30Z'),
            item('serde', '1.0.229', '2026-10-31T10:01:00Z'),
            item('serde', '1.0.227', '2026-10-31T09:59:00Z'),
          ),
          { headers: { etag: '"abc"' } },
        ),
    );
    await listener.poll();
    expect(notified()).toEqual(['u1:serde@1.0.229', 'u1:serde@1.0.230']);
    expect(listener.sequence).toBe(Date.parse('2026-10-31T10:02:00Z'));
    expect((fetch.mock.calls[0][1]?.headers as Record<string, string>)['User-Agent']).toMatch(/^artifact-notifier/);

    fetch.mockResolvedValue(new Response(null, { status: 304 }));
    await listener.poll();
    expect((fetch.mock.calls[1][1]?.headers as Record<string, string>)['if-none-match']).toBe('"abc"');
    expect(await seq('CargoArtifactListenerTimestamp')).toMatch(/^\d+$/);
  });

  it('sweeps followed crates when the whole feed is newer than the last poll', async () => {
    await follow('CARGO', 'serde', ['1.0.228']);
    const listener = await listenerAt('2026-10-31T10:00:00Z');
    jest.spyOn((listener as any).logger, 'warn').mockImplementation(() => undefined);
    const index = jest.fn(
      () => new Response(['1.0.228', '1.0.229'].map((vers) => JSON.stringify({ name: 'serde', vers })).join('\n')),
    );
    routeFetch((url) =>
      url.startsWith('https://index.crates.io/')
        ? index()
        : new Response(feed(item('x', '1.0.0', '2026-10-31T10:05:00Z'))),
    );
    await listener.poll();
    await new Promise((r) => setTimeout(r, 50));
    expect(index).toHaveBeenCalled();
    expect(notified()).toEqual(['u1:serde@1.0.229']);
  });
});
