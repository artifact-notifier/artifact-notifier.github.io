import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import request from 'supertest';
import { bearer, createTestApp } from './app';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
let app: INestApplication;
let auth: { Authorization: string };
const api = () => request(app.getHttpServer());

function routeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return jest.spyOn(global, 'fetch').mockImplementation((input, init) => Promise.resolve(handler(String(input), init)));
}

function signedTelegram(id: string) {
  const data: Record<string, string> = { id, username: 'tg', auth_date: String(Math.floor(Date.now() / 1000)) };
  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  return { ...data, hash: crypto.createHmac('sha256', secret).update(checkString).digest('hex') };
}

beforeAll(async () => {
  app = await createTestApp();
});
beforeEach(async () => {
  await resetDb(prisma);
  auth = bearer(app, await createUser(prisma, 'u1'));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('artifact search', () => {
  it('searches npm', async () => {
    const fetch = routeFetch(
      () => new Response(JSON.stringify({ objects: [{ package: { name: 'react', description: 'UI' } }] })),
    );
    const res = await api().get('/api/artifacts/search?ecosystem=NPM&q=react').set(auth);
    expect(res.body).toEqual([{ coordinates: 'react', description: 'UI' }]);
    expect(String(fetch.mock.calls[0][0])).toBe('https://registry.npmjs.org/-/v1/search?text=react&size=10');
  });

  it('searches Maven Central', async () => {
    routeFetch(
      () =>
        new Response(
          JSON.stringify({
            components: [
              { namespace: 'org.example', name: 'lib', description: 'A lib' },
              { namespace: 'org.example', name: 'other', latestVersionInfo: { version: '2.0' } },
            ],
          }),
        ),
    );
    const res = await api().get('/api/artifacts/search?ecosystem=MAVEN&q=example').set(auth);
    expect(res.body).toEqual([
      { coordinates: 'org.example:lib', description: 'A lib' },
      { coordinates: 'org.example:other', description: '2.0' },
    ]);
  });

  it('looks PyPI projects up by name', async () => {
    routeFetch((url) =>
      url.includes('/django/')
        ? new Response(JSON.stringify({ info: { name: 'Django', summary: 'Web framework' } }))
        : new Response('', { status: 404 }),
    );
    const found = await api().get('/api/artifacts/search?ecosystem=PYPI&q=django').set(auth);
    expect(found.body).toEqual([{ coordinates: 'Django', description: 'Web framework' }]);
    const missing = await api().get('/api/artifacts/search?ecosystem=PYPI&q=nope').set(auth);
    expect(missing.body).toEqual([]);
  });

  it('echoes TEST coordinates and ignores too short queries', async () => {
    const test = await api().get('/api/artifacts/search?ecosystem=TEST&q=my/pkg').set(auth);
    expect(test.body).toEqual([{ coordinates: 'my/pkg', description: expect.any(String) }]);
    const short = await api().get('/api/artifacts/search?ecosystem=NPM&q=r').set(auth);
    expect(short.body).toEqual([]);
  });
});

describe('following real ecosystems', () => {
  it('records the existing versions and the highest stable one', async () => {
    routeFetch(() => new Response(JSON.stringify({ versions: { '1.0.0': {}, '1.1.0': {}, '2.0.0-rc.1': {} } })));
    const res = await api().post('/api/artifacts/follow').set(auth).send({ ecosystem: 'NPM', coordinates: 'lib' });
    expect(res.body.currentVersion).toBe('1.1.0');
    expect(await prisma.knownVersion.count({ where: { coordinates: 'lib' } })).toBe(3);
    // following again returns the same row
    const again = await api().post('/api/artifacts/follow').set(auth).send({ ecosystem: 'NPM', coordinates: 'lib' });
    expect(again.body.id).toBe(res.body.id);
  });

  it('still follows when the registry is down', async () => {
    routeFetch(() => new Response('', { status: 503 }));
    const res = await api().post('/api/artifacts/follow').set(auth).send({ ecosystem: 'PYPI', coordinates: 'x' });
    expect(res.body.currentVersion).toBeNull();
  });

  it('caps the number of followed artifacts', async () => {
    await prisma.followedArtifact.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ userId: 'u1', ecosystem: 'TEST' as const, coordinates: `p${i}` })),
    });
    const res = await api()
      .post('/api/artifacts/follow')
      .set(auth)
      .send({ ecosystem: 'TEST', coordinates: 'one-more' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('500');
  });
});

describe('sync status and ecosystems', () => {
  it('reports the last synchronisation per ecosystem', async () => {
    await prisma.listenerSequence.createMany({
      data: [
        { id: 'NpmArtifactListener', value: '123' },
        { id: 'NpmArtifactListenerTimestamp', value: String(Date.parse('2026-10-23T10:00:00Z')) },
        { id: 'MavenArtifactListener', value: String(Date.parse('2026-10-23T11:00:00Z')) },
        { id: 'PypiArtifactListenerTimestamp', value: 'Thu, 23 Oct 2026 12:00:00 GMT' },
      ],
    });
    const res = await api().get('/api/artifacts/sync-status').set(auth);
    expect(res.body).toEqual({
      NPM: { lastSync: '2026-10-23T10:00:00.000Z', lastSeq: '123' },
      MAVEN: { lastSync: '2026-10-23T11:00:00.000Z', lastSeq: null },
      PYPI: { lastSync: '2026-10-23T12:00:00.000Z', lastSeq: null },
    });
  });

  it('exposes TEST outside production', async () => {
    const res = await api().get('/api/artifacts/ecosystems').set(auth);
    expect(res.body).toEqual(['NPM', 'MAVEN', 'PYPI', 'TEST']);
  });
});

describe('TEST ecosystem simulation', () => {
  it('creates the artifact, then notifies each new simulated version once', async () => {
    const first = await api()
      .post('/api/artifacts/test/simulate')
      .set(auth)
      .send({ coordinates: 'my/pkg', version: '1.0.0' });
    expect(first.body).toMatchObject({ coordinates: 'my/pkg', version: '1.0.0' });
    const dup = await api()
      .post('/api/artifacts/test/simulate')
      .set(auth)
      .send({ coordinates: 'my/pkg', version: '1.0.0' });
    expect(dup.body.id).toBe(first.body.id);

    const bump = await api()
      .post('/api/artifacts/test/bump')
      .set(auth)
      .send({ id: first.body.followedArtifactId, version: '1.1.0' });
    expect(bump.body.version).toBe('1.1.0');
    const fa = await prisma.followedArtifact.findUniqueOrThrow({ where: { id: first.body.followedArtifactId } });
    expect(fa.currentVersion).toBe('1.1.0');
    expect(await prisma.notificationDelivery.count()).toBe(2);
  });

  it('validates its inputs', async () => {
    const bad = await api()
      .post('/api/artifacts/test/simulate')
      .set(auth)
      .send({ coordinates: 'bad coords!', version: '1' });
    expect(bad.status).toBe(400);
    const notMine = await api().post('/api/artifacts/test/bump').set(auth).send({ id: 'nope', version: '1' });
    expect(notMine.status).toBe(403);
  });
});

describe('Telegram routes', () => {
  it('exposes the widget configuration', async () => {
    const res = await api().get('/api/auth/telegram/config');
    expect(res.body).toEqual({ enabled: true, botUsername: 'notifier_test_bot' });
  });

  it('links, reports and unlinks Telegram for the session', async () => {
    const link = await api().post('/api/auth/telegram/link').set(auth).send(signedTelegram('555'));
    expect(link.status).toBe(201);
    const status = await api().get('/api/auth/telegram/status').set(auth);
    expect(status.body).toEqual({ linked: true, telegramId: '555', telegramUsername: 'tg' });
    await api().delete('/api/auth/telegram/unlink').set(auth);
    const after = await api().get('/api/auth/telegram/status').set(auth);
    expect(after.body.linked).toBe(false);
  });

  it('refuses an unsigned link', async () => {
    const res = await api()
      .post('/api/auth/telegram/link')
      .set(auth)
      .send({ ...signedTelegram('555'), id: '556' });
    expect(res.status).toBe(401);
  });
});
