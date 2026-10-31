import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import request from 'supertest';
import { bearer, createTestApp } from './app';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
let app: INestApplication;
let token: string;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(async () => {
  await resetDb(prisma);
  const user = await createUser(prisma, 'u1', { notificationChannel: 'email', notificationMode: 'DIGEST' });
  token = bearer(app, user).Authorization.slice('Bearer '.length);
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const api = () => request(app.getHttpServer());
const auth = () => ({ Authorization: `Bearer ${token}` });

describe('authentication', () => {
  it('rejects anonymous calls to protected routes', async () => {
    expect((await api().get('/api/artifacts')).status).toBe(401);
    expect((await api().get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = app.get(JwtService).sign({ sub: 'u1' }, { secret: 'not-the-secret' });
    expect((await api().get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  it('returns the current user', async () => {
    const res = await api().get('/api/auth/me').set(auth()).expect(200);
    expect(res.body).toMatchObject({ id: 'u1', email: 'u1@example.test' });
  });

  it('lists providers publicly', async () => {
    const res = await api().get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('account linking', () => {
  it('refuses to confirm a link the session did not request', async () => {
    expect((await api().post('/api/auth/link/confirm').set(auth()).send({ token: 'forged' })).status).toBe(401);
  });

  it('redirects an unknown link token back to the preferences', async () => {
    const res = await api().get('/api/auth/google/link?token=nope').expect(302);
    expect(res.headers.location).toContain('/preferences?error=invalid_link_token');
  });
});

describe('artifacts', () => {
  it('validates the follow payload', async () => {
    expect(
      (await api().post('/api/artifacts/follow').set(auth()).send({ ecosystem: 'FOO', coordinates: 'x' })).status,
    ).toBe(400);
    expect(
      (await api().post('/api/artifacts/follow').set(auth()).send({ ecosystem: 'TEST', coordinates: '<script>' }))
        .status,
    ).toBe(400);
    expect((await api().get('/api/artifacts/search?ecosystem=FOO&q=react').set(auth())).status).toBe(400);
  });

  it('follows, lists and unfollows', async () => {
    const created = await api()
      .post('/api/artifacts/follow')
      .set(auth())
      .send({ ecosystem: 'TEST', coordinates: 'my/pkg' })
      .expect(201);
    const list = await api().get('/api/artifacts').set(auth()).expect(200);
    expect(list.body.map((a: any) => a.coordinates)).toEqual(['my/pkg']);
    expect((await api().delete(`/api/artifacts/${created.body.id}`).set(auth())).status).toBe(200);
  });

  it("cannot unfollow someone else's artifact", async () => {
    await createUser(prisma, 'other');
    const fa = await prisma.followedArtifact.create({ data: { userId: 'other', ecosystem: 'TEST', coordinates: 'x' } });
    expect((await api().delete(`/api/artifacts/${fa.id}`).set(auth())).status).toBe(404);
  });

  describe('version rules', () => {
    const C = 'org.example:lib';
    async function followed() {
      await prisma.knownVersions.create({
        data: {
          ecosystem: 'MAVEN',
          coordinates: C,
          versions: JSON.stringify(['5.2.0', '5.3.1', '6.0.0', '6.1.0-RC1']),
        },
      });
      return prisma.followedArtifact.create({
        data: { userId: 'u1', ecosystem: 'MAVEN', coordinates: C, currentVersion: '6.0.0' },
      });
    }

    it('saves the rules, realigns the current version and lists them', async () => {
      const fa = await followed();
      const res = await api()
        .put(`/api/artifacts/${fa.id}/rules`)
        .set(auth())
        .send({ rules: [{ type: 'include', pattern: '5.*' }], includePrereleases: null })
        .expect(200);
      expect(res.body).toMatchObject({
        currentVersion: '5.3.1',
        includePrereleases: null,
        versionRules: [{ type: 'include', pattern: '5.*' }],
      });
      const list = await api().get('/api/artifacts').set(auth()).expect(200);
      expect(list.body[0].versionRules).toEqual([{ type: 'include', pattern: '5.*' }]);

      const cleared = await api()
        .put(`/api/artifacts/${fa.id}/rules`)
        .set(auth())
        .send({ rules: [], includePrereleases: true })
        .expect(200);
      expect(cleared.body).toMatchObject({ currentVersion: '6.1.0-RC1', includePrereleases: true, versionRules: [] });
      expect((await prisma.followedArtifact.findUnique({ where: { id: fa.id } }))?.versionRules).toBeNull();
    });

    it('rejects invalid rules and other users', async () => {
      const fa = await followed();
      const put = (body: object) => api().put(`/api/artifacts/${fa.id}/rules`).set(auth()).send(body);
      expect((await put({ rules: [{ type: 'regex', pattern: '5.*' }] })).status).toBe(400);
      expect((await put({ rules: [{ type: 'include', pattern: '(a+)+$' }] })).status).toBe(400);
      expect((await put({ rules: [{ type: 'include', pattern: 'x'.repeat(65) }] })).status).toBe(400);
      expect((await put({ rules: Array(21).fill({ type: 'include', pattern: '1.*' }) })).status).toBe(400);

      await createUser(prisma, 'other');
      const theirs = await prisma.followedArtifact.create({
        data: { userId: 'other', ecosystem: 'MAVEN', coordinates: C },
      });
      expect((await api().put(`/api/artifacts/${theirs.id}/rules`).set(auth()).send({ rules: [] })).status).toBe(404);
      expect((await api().get(`/api/artifacts/${theirs.id}/versions`).set(auth())).status).toBe(404);
    });

    it('previews the latest known versions, highest first', async () => {
      const fa = await followed();
      const res = await api().get(`/api/artifacts/${fa.id}/versions`).set(auth()).expect(200);
      expect(res.body).toEqual({
        defaultIncludePrereleases: false,
        versions: [
          { version: '6.1.0-RC1', prerelease: true },
          { version: '6.0.0', prerelease: false },
          { version: '5.3.1', prerelease: false },
          { version: '5.2.0', prerelease: false },
        ],
      });
    });
  });
});

describe('public stats', () => {
  it('counts users and distinct followed artifacts without a session, naming none', async () => {
    await createUser(prisma, 'u2');
    for (const [userId, ecosystem, coordinates] of [
      ['u1', 'NPM', 'react'],
      ['u2', 'NPM', 'react'],
      ['u2', 'MAVEN', 'com.internal:secret'],
      ['u1', 'TEST', 'dev/only'],
    ] as const) {
      await prisma.followedArtifact.create({ data: { userId, ecosystem, coordinates } });
    }
    await prisma.listenerSequence.create({ data: { id: 'MavenArtifactListener', value: '1790000000000' } });

    const res = await api().get('/api/public/stats').expect(200);
    expect(res.body).toMatchObject({ users: 2, followedArtifacts: 2 });
    expect(res.body.listeners.MAVEN.lastSync).toBe(new Date(1790000000000).toISOString());
    expect(JSON.stringify(res.body)).not.toMatch(/react|secret|u1|u2/);
  });
});

describe('preferences', () => {
  it('ignores a Telegram chat id sent through the preferences', async () => {
    const res = await api()
      .put('/api/preferences')
      .set(auth())
      .send({ telegramChatId: '123', includePrereleases: true })
      .expect(200);
    expect(res.body).toMatchObject({ telegramChatId: null, includePrereleases: true });
  });
});

describe('Telegram login', () => {
  function signed(data: Record<string, string>) {
    const checkString = Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('\n');
    const secret = crypto.createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
    return { ...data, hash: crypto.createHmac('sha256', secret).update(checkString).digest('hex') };
  }

  it('opens a session and returns the token for the Bearer fallback', async () => {
    const payload = signed({ id: '777', username: 'tg', auth_date: String(Math.floor(Date.now() / 1000)) });
    const res = await api().post('/api/auth/telegram/verify').send(payload).expect(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.headers['set-cookie'][0]).toMatch(/^access_token=.*HttpOnly/);
    expect((await api().get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`)).status).toBe(200);
  });

  it('rejects a bad signature', async () => {
    const payload = { ...signed({ id: '777', auth_date: String(Math.floor(Date.now() / 1000)) }), id: '778' };
    expect((await api().post('/api/auth/telegram/verify').send(payload)).status).toBe(401);
  });
});
