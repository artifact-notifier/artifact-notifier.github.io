import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ArtifactsService } from '../src/artifacts/artifacts.service';
import { MavenArtifactListener } from '../src/listeners/maven-artifact.listener';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
const artifacts = new ArtifactsService(prisma as any, new ConfigService({}));
const notifications = { onNewVersion: jest.fn() };
const C = 'org.springframework.boot:spring-boot';
const BROWSE = 'https://central.sonatype.com/api/internal/browse/components';
const METADATA = 'https://repo1.maven.org/maven2/org/springframework/boot/spring-boot/maven-metadata.xml';

const component = (namespace: string, name: string, version: string, ts: number) => ({
  namespace,
  name,
  latestVersionInfo: { version, timestampUnixWithMS: ts },
});
const metadata = (...versions: string[]) =>
  `<metadata><versioning><versions>${versions.map((v) => `<version>${v}</version>`).join('')}</versions></versioning></metadata>`;

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function routeFetch(handler: Handler) {
  return jest.spyOn(global, 'fetch').mockImplementation((input, init) => Promise.resolve(handler(String(input), init)));
}

let listener: MavenArtifactListener;
const notified = () => notifications.onNewVersion.mock.calls.map(([, u, , , v]) => `${u}:${v}`);

beforeEach(async () => {
  await resetDb(prisma);
  notifications.onNewVersion.mockReset();
  await createUser(prisma, 'u1');
  await prisma.followedArtifact.create({
    data: { userId: 'u1', ecosystem: 'MAVEN', coordinates: C, currentVersion: '4.1.1' },
  });
  await artifacts.addKnownVersions('MAVEN', C, ['4.0.8', '4.1.1']);
  listener = new MavenArtifactListener(artifacts, notifications as any, prisma as any);
  jest.spyOn(listener as any, 'sleep').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe('MavenArtifactListener', () => {
  it('starts with a stored sequence or initializes it', async () => {
    jest.spyOn(listener, 'sync').mockResolvedValue();
    await listener.onModuleInit();
    const row = await prisma.listenerSequence.findUnique({ where: { id: 'MavenArtifactListener' } });
    expect(Number(row!.value)).toBe(listener.sequence);

    await prisma.listenerSequence.update({ where: { id: 'MavenArtifactListener' }, data: { value: '1234' } });
    const again = new MavenArtifactListener(artifacts, notifications as any, prisma as any);
    await again.start();
    expect(again.sequence).toBe(1234);
  });

  it('polls the browse API, diffs maven-metadata.xml and advances the sequence', async () => {
    await listener.start();
    listener.sequence = 1000;
    const fetch = routeFetch((url) => {
      if (url === BROWSE)
        return new Response(
          JSON.stringify({
            components: [
              component('org.springframework.boot', 'spring-boot', '4.2.0-RC1', 3000),
              component('com.other', 'lib', '1.0', 2500),
              { namespace: 'no', name: 'version', latestVersionInfo: null },
              component('old', 'stuff', '1.0', 900),
            ],
          }),
        );
      if (url === METADATA) return new Response(metadata('4.0.8', '4.0.9', '4.1.1', '4.1.2'));
      throw new Error(`unexpected ${url}`);
    });

    await listener.poll();

    expect(fetch.mock.calls.filter(([u]) => u === BROWSE)).toHaveLength(1);
    // RC1 comes from the feed, the patches from the metadata; the user wants stable only
    expect(notified()).toEqual(['u1:4.0.9', 'u1:4.1.2']);
    expect(listener.sequence).toBe(3000);
    const alias = await prisma.listenerSequence.findUnique({ where: { id: 'MavenArtifactListenerTimestamp' } });
    expect(Number(alias!.value)).toBeGreaterThan(0);
  });

  it('keeps the sequence when nothing new was published', async () => {
    await listener.start();
    listener.sequence = 5000;
    routeFetch(() => new Response(JSON.stringify({ components: [component('a', 'b', '1', 4000)] })));
    await listener.poll();
    expect(listener.sequence).toBe(5000);
    expect(notified()).toEqual([]);
  });

  it('paginates until lastSync and retries the same page on 429', async () => {
    await listener.start();
    listener.sequence = 100;
    const pages: number[] = [];
    let rateLimited = false;
    routeFetch((url, init) => {
      if (url === METADATA) return new Response(metadata('4.1.1', '4.1.2'));
      const page = JSON.parse(String(init!.body)).page as number;
      pages.push(page);
      if (page === 1 && !rateLimited) {
        rateLimited = true;
        return new Response('', { status: 429, headers: { 'retry-after': '1' } });
      }
      const ts = page === 0 ? 300 : 50; // page 1 reaches lastSync
      const components = Array.from({ length: 20 }, (_, i) => component('g', `a${page}-${i}`, '1', ts - i));
      if (page === 0) components[0] = component('org.springframework.boot', 'spring-boot', '4.1.2', 400);
      return new Response(JSON.stringify({ components }));
    });

    await listener.poll();

    expect(pages).toEqual([0, 1, 1]);
    expect((listener as any).sleep).toHaveBeenCalledWith(1000);
    expect(notified()).toEqual(['u1:4.1.2']);
  });

  it('falls back to the feed version when the metadata is unavailable', async () => {
    await listener.start();
    listener.sequence = 10;
    routeFetch((url) => {
      if (url === METADATA) return new Response('down', { status: 503 });
      return new Response(
        JSON.stringify({ components: [component('org.springframework.boot', 'spring-boot', '4.1.3', 20)] }),
      );
    });
    await listener.poll();
    expect(notified()).toEqual(['u1:4.1.3']);
  });

  it('logs and survives an API failure', async () => {
    await listener.start();
    listener.sequence = 10;
    routeFetch(() => new Response('boom', { status: 502, statusText: 'Bad Gateway' }));
    const error = jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    await listener.poll();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('502'));
    expect(listener.sequence).toBe(10);
  });

  it('sweeps every followed artifact', async () => {
    await listener.start();
    routeFetch(() => new Response(metadata('4.0.8', '4.1.1', '4.1.4')));
    await listener.sweep();
    expect(notified()).toEqual(['u1:4.1.4']);
  });

  it('parses Retry-After as seconds or HTTP date', () => {
    const parse = (h: string | null) => (listener as any).parseRetryAfter(h);
    expect(parse('3')).toBe(3000);
    expect(parse(null)).toBeNull();
    expect(parse('nonsense')).toBeNull();
    expect(parse(new Date(Date.now() + 60_000).toUTCString())).toBeGreaterThan(50_000);
  });
});
